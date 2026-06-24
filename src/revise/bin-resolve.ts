import fs from 'fs';
import path from 'path';

export interface SpawnConfig { command: string; argvPrefix: string[]; displayName: string; }

function nodeScript(script: string): SpawnConfig {
  return { command: process.execPath, argvPrefix: [script], displayName: `node "${script}"` };
}

export function getPromptpileSpawnConfig(): SpawnConfig {
  const override = process.env.PROMPTPILE_BIN?.trim();
  if (override) return { command: override, argvPrefix: [], displayName: override };
  try {
    const pkg = require.resolve('promptpile/package.json');
    const script = path.join(path.dirname(pkg), 'dist', 'index.js');
    if (fs.existsSync(script)) return nodeScript(script);
  } catch { /* fall through */ }
  return { command: 'promptpile', argvPrefix: [], displayName: 'promptpile' };
}

export function getPromptpileMcpSpawnConfig(): SpawnConfig {
  const override = process.env.PROMPTPILE_MCP_BIN?.trim();
  if (override) return { command: override, argvPrefix: [], displayName: override };
  try {
    const pkg = require.resolve('promptpile-mcp/package.json');
    const script = path.join(path.dirname(pkg), 'dist', 'src', 'index.js');
    if (fs.existsSync(script)) return nodeScript(script);
  } catch { /* fall through */ }
  const repoScript = path.resolve(__dirname, '../../../../promptpile/packages/promptpile-mcp/dist/src/index.js');
  if (fs.existsSync(repoScript)) return nodeScript(repoScript);
  return { command: 'promptpile-mcp', argvPrefix: [], displayName: 'promptpile-mcp' };
}
