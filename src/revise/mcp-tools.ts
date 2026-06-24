import fs from 'fs';
import path from 'path';
import { READONLY_MCP_TOOL_NAMES } from './constants';

interface ExportedTool { type: string; function: { name: string; description?: string; parameters?: Record<string, unknown> }; }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }

function headers(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function exportReadonlyTools(baseUrl: string, token: string | undefined, outputFile: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/tools/export`, { headers: { Accept: 'application/json', ...headers(token) } });
  if (!res.ok) throw new Error(`MCP export-tools failed: HTTP ${res.status}`);
  const body = await res.json() as { tools?: ExportedTool[] };
  if (!Array.isArray(body.tools)) throw new Error('MCP export-tools response missing tools array');
  const tools = body.tools.filter(tool => READONLY_MCP_TOOL_NAMES.has(tool.function.name));
  for (const required of READONLY_MCP_TOOL_NAMES) {
    if (!tools.some(tool => tool.function.name === required)) throw new Error(`MCP readonly tool missing: ${required}`);
  }
  fs.writeFileSync(outputFile, toolsToml(tools), 'utf8');
}

function toolsToml(tools: ExportedTool[]): string {
  return tools.map(tool => [
    '[[tools]]',
    `name = ${JSON.stringify(tool.function.name)}`,
    ...(tool.function.description ? [`description = ${JSON.stringify(tool.function.description)}`] : []),
    `parameters = ${JSON.stringify(JSON.stringify(tool.function.parameters ?? { type: 'object', properties: {} }))}`,
    '',
  ].join('\n')).join('\n');
}

export function parseAndAssertReadonlyCalls(callFile: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [index, line] of fs.readFileSync(callFile, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const call = JSON.parse(line) as ToolCall;
    if (!call || call.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') {
      throw new Error(`Invalid tool call on line ${index + 1}: ${path.basename(callFile)}`);
    }
    if (!READONLY_MCP_TOOL_NAMES.has(call.function.name)) throw new Error(`Refusing non-readonly MCP tool call: ${call.function.name}`);
    calls.push(call);
  }
  return calls;
}

export async function executeReadonlyCalls(baseUrl: string, token: string | undefined, callFile: string): Promise<string> {
  const calls = parseAndAssertReadonlyCalls(callFile);
  if (!calls.length) throw new Error(`No MCP calls found in ${callFile}`);
  const res = await fetch(`${baseUrl}/v1/calls/exec`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(token) }, body: JSON.stringify({ calls }),
  });
  if (!res.ok) throw new Error(`MCP exec-calls failed: HTTP ${res.status}`);
  const body = await res.json() as { results?: Array<{ toolCallId: string; ok: boolean; content?: unknown; error?: string }> };
  if (!Array.isArray(body.results)) throw new Error('MCP exec-calls response missing results array');
  const byId = new Map(body.results.map(result => [result.toolCallId, result]));
  const resultFile = callFile.replace(/\.calls\.jsonl$/i, '.result.jsonl');
  const lines = calls.map(call => {
    const result = byId.get(call.id);
    const content = result?.ok ? (typeof result.content === 'string' ? result.content : JSON.stringify(result.content ?? '')) : result?.error ?? 'MCP tool failed';
    return JSON.stringify({ tool_call_id: call.id, name: call.function.name, content });
  });
  fs.writeFileSync(resultFile, `${lines.join('\n')}\n`, 'utf8');
  return resultFile;
}

export async function assertAllowedWorldRoot(baseUrl: string, token: string | undefined, worldRoot: string, scratchDir: string): Promise<void> {
  const callFile = path.join(scratchDir, `.day-loom-allowed-${process.pid}.calls.jsonl`);
  const id = `allowed-${process.pid}`;
  fs.writeFileSync(callFile, `${JSON.stringify({ id, type: 'function', function: { name: 'mcp__world__list_allowed_directories', arguments: '{}' } })}\n`, 'utf8');
  try {
    const resultFile = await executeReadonlyCalls(baseUrl, token, callFile);
    const row = JSON.parse(fs.readFileSync(resultFile, 'utf8').trim()) as { content: string };
    const allowedText = row.content;
    if (!allowedText.includes(worldRoot)) throw new Error(`MCP allowed directories do not include World root: ${worldRoot}`);
    fs.rmSync(resultFile, { force: true });
  } finally {
    fs.rmSync(callFile, { force: true });
  }
}
