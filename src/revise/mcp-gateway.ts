import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { DEFAULT_GATEWAY_TIMEOUT_MS } from './constants';
import { getPromptpileMcpSpawnConfig } from './bin-resolve';
import { stopChild } from './process-run';
import type { GatewayHandle } from './types';

export async function connectOrStartGateway(sessionRoot: string, worldRoot: string, externalBaseUrl?: string, externalToken?: string): Promise<GatewayHandle> {
  if (externalBaseUrl) return { baseUrl: externalBaseUrl.replace(/\/$/, ''), token: externalToken, async stop() {} };
  const port = await pickFreePort();
  const token = crypto.randomBytes(24).toString('hex');
  const config = path.join(sessionRoot, 'mcp.toml');
  const filesystemServer = getFilesystemServerSpawnConfig(worldRoot);
  fs.writeFileSync(config, `version = 1\n\n[gateway]\nport = ${port}\ntoken = "${token}"\n\n[behavior]\nfailure_policy = "strict"\nflat_names = false\n\n[servers.world]\ncommand = ${JSON.stringify(filesystemServer.command)}\nargs = ${JSON.stringify(filesystemServer.args)}\n`, 'utf8');
  const spawnConfig = getPromptpileMcpSpawnConfig();
  const child = spawn(spawnConfig.command, [...spawnConfig.argvPrefix, 'launch', '--config', config], { cwd: sessionRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let spawnError: Error | undefined;
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => { spawnError = error; });
  const baseUrl = `http://127.0.0.1:${port}`;
  try { await waitForHealth(baseUrl, token, child, () => stderr, () => spawnError); }
  catch (err) { await stopChild(child); throw err; }
  return { baseUrl, token, stop: () => stopChild(child) };
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Failed to choose MCP gateway port'));
      server.close(err => err ? reject(err) : resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl: string, token: string, child: ReturnType<typeof spawn>, getStderr: () => string, getSpawnError: () => Error | undefined): Promise<void> {
  const deadline = Date.now() + DEFAULT_GATEWAY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw new Error(`Failed to start promptpile-mcp: ${spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`promptpile-mcp exited before health check: ${getStderr().trim().slice(-500)}`);
    try { const res = await fetch(`${baseUrl}/health`, { headers: { Authorization: `Bearer ${token}` } }); if (res.ok) return; } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for promptpile-mcp gateway. ${getStderr().trim().slice(-500)}`);
}

function getFilesystemServerSpawnConfig(worldRoot: string): { command: string; args: string[] } {
  const override = process.env.DAY_LOOM_FILESYSTEM_MCP_BIN?.trim();
  if (override) return { command: process.execPath, args: [override, worldRoot] };
  return { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', worldRoot] };
}
