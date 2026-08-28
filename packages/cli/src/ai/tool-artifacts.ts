import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseToolCallV1, parseToolResultLineV1 } from 'promptpile-protocol';
import {
  isAiWorkspaceDirectoryAllowedV1,
  isAiWorkspaceWritePathAllowedV1,
  type AiDraftCommandV1,
} from '../world/write-policy.js';

export interface ToolArtifactPolicyV1 {
  allowedToolNames: readonly string[];
  maxToolCallsPerThought: number;
  maxToolResultLineBytes: number;
}

export interface ValidatedToolCallV1 {
  id: string;
  name: string;
  arguments: string;
  raw: Readonly<Record<string, unknown>>;
}

export interface WorkspaceMutationPolicyV1 {
  workspaceRoot: string;
  command: AiDraftCommandV1;
  targetDay: string | null;
}

export interface WorkspaceMutationTargetV1 {
  absolute: string;
  canonical: string;
  kind: 'create_directory' | 'delete_file' | 'write_file';
}

const CALL_SUFFIX = '.calls.jsonl';
const RESULT_SUFFIX = '.result.jsonl';
const TRUNCATION = '\n[DAYLOOM_TOOL_RESULT_TRUNCATED]\nResult exceeded the Dayloom tool-result limit. Narrow the request.';

function recordsV1(file: string): Record<string, unknown>[] {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => line.trim() === '')) throw new Error(`Tool Artifact is empty or malformed: ${path.basename(file)}.`);
  return lines.map((line, index) => {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Tool Artifact line ${index + 1} is not an object.`);
    return value as Record<string, unknown>;
  });
}

export function pairedResultPathV1(callsPath: string): string {
  const name = path.basename(callsPath);
  if (!name.endsWith(CALL_SUFFIX) || name.length === CALL_SUFFIX.length) throw new Error('ToolCall artifact name is invalid.');
  return path.join(path.dirname(callsPath), `${name.slice(0, -CALL_SUFFIX.length)}${RESULT_SUFFIX}`);
}

export function readPromptpileToolCallsV1(callsPath: string): ValidatedToolCallV1[] {
  const calls = recordsV1(callsPath).map((raw) => {
    const parsed = parseToolCallV1(raw);
    if (!parsed || parsed.id === '' || parsed.type !== 'function' || parsed.function.name === '') throw new Error('ToolCall artifact violates Promptpile ToolCall V1.');
    return Object.freeze({ id: parsed.id, name: parsed.function.name, arguments: parsed.function.arguments, raw: Object.freeze({ ...raw }) });
  });
  if (new Set(calls.map((call) => call.id)).size !== calls.length) throw new Error('ToolCall artifact contains duplicate ids.');
  return calls;
}

export function workspaceMutationTargetV1(call: ValidatedToolCallV1, policy: WorkspaceMutationPolicyV1): WorkspaceMutationTargetV1 | null {
  const kind = call.name === 'mcp__workspace__create_directory' ? 'create_directory'
    : call.name === 'mcp__workspace__delete_file' ? 'delete_file'
      : call.name === 'mcp__workspace__write_file' ? 'write_file'
        : null;
  if (kind === null) return null;
  const input: unknown = JSON.parse(call.arguments);
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as { path?: unknown }).path !== 'string') {
    throw new Error('Workspace mutation ToolCall arguments are invalid.');
  }
  const requested = (input as { path: string }).path;
  const absolute = path.resolve(policy.workspaceRoot, requested);
  const relative = path.relative(policy.workspaceRoot, absolute);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Workspace mutation path is outside the workspace boundary.');
  }
  const canonical = relative.split(path.sep).join('/');
  const allowed = kind === 'create_directory'
    ? isAiWorkspaceDirectoryAllowedV1(policy.command, policy.targetDay, canonical)
    : isAiWorkspaceWritePathAllowedV1(policy.command, policy.targetDay, canonical) && (kind !== 'delete_file' || policy.command === 'revise');
  if (!allowed) throw new Error(`${policy.command} cannot mutate ${canonical}.`);
  return Object.freeze({ absolute, canonical, kind });
}

export function assertWorkspaceMutationPolicyV1(calls: readonly ValidatedToolCallV1[], policy: WorkspaceMutationPolicyV1): void {
  for (const call of calls) {
    workspaceMutationTargetV1(call, policy);
  }
}

export function assertToolCallPolicyV1(calls: readonly ValidatedToolCallV1[], policy: ToolArtifactPolicyV1): void {
  if (calls.length > policy.maxToolCallsPerThought) throw new Error(`Thought emitted more than ${policy.maxToolCallsPerThought} ToolCalls.`);
  const allowed = new Set(policy.allowedToolNames);
  if (calls.some((call) => !allowed.has(call.name))) throw new Error('ToolCall artifact contains a non-allowed tool.');
}

export function readCompleteToolResultsV1(calls: readonly ValidatedToolCallV1[], resultPath: string, policy: ToolArtifactPolicyV1): void {
  const rows = recordsV1(resultPath);
  if (rows.length !== calls.length) throw new Error('ToolResult vector is incomplete.');
  rows.forEach((raw, index) => {
    const parsed = parseToolResultLineV1(raw);
    const call = calls[index]!;
    if (!parsed || parsed.tool_call_id !== call.id || (parsed.name !== undefined && parsed.name !== call.name)) throw new Error('ToolResult vector is malformed or out of order.');
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > policy.maxToolResultLineBytes) throw new Error('ToolResult line exceeds the byte bound.');
  });
}

function boundedRowV1(raw: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') <= maxBytes) return raw;
  const content = typeof raw.content === 'string' ? raw.content : '';
  let low = 0;
  let high = content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    raw.content = content.slice(0, middle) + TRUNCATION;
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  raw.content = content.slice(0, low) + TRUNCATION;
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > maxBytes) throw new Error('ToolResult structural fields exceed the byte bound.');
  return raw;
}

function writeRowsAtomicV1(target: string, rows: readonly Record<string, unknown>[]): void {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try { renameSync(temporary, target); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
}

export function writeSyntheticToolResultsV1(calls: readonly ValidatedToolCallV1[], resultPath: string, content: string, policy: ToolArtifactPolicyV1): void {
  writeRowsAtomicV1(resultPath, calls.map((call) => boundedRowV1({ tool_call_id: call.id, name: call.name, content }, policy.maxToolResultLineBytes)));
}

export function writeToolResultsV1(calls: readonly ValidatedToolCallV1[], resultPath: string, contents: readonly string[], policy: ToolArtifactPolicyV1): void {
  if (contents.length !== calls.length) throw new Error('ToolResult content vector is incomplete.');
  writeRowsAtomicV1(resultPath, calls.map((call, index) => boundedRowV1({
    tool_call_id: call.id,
    name: call.name,
    content: contents[index]!,
  }, policy.maxToolResultLineBytes)));
}

export function sanitizeToolResultsV1(calls: readonly ValidatedToolCallV1[], resultPath: string, policy: ToolArtifactPolicyV1): void {
  const rows = recordsV1(resultPath);
  if (rows.length !== calls.length) throw new Error('ToolResult vector is incomplete.');
  const bounded = rows.map((raw, index) => {
    const parsed = parseToolResultLineV1(raw);
    const call = calls[index]!;
    if (!parsed || parsed.tool_call_id !== call.id || (parsed.name !== undefined && parsed.name !== call.name)) throw new Error('ToolResult vector is malformed or out of order.');
    return boundedRowV1({ ...raw }, policy.maxToolResultLineBytes);
  });
  writeRowsAtomicV1(resultPath, bounded);
  readCompleteToolResultsV1(calls, resultPath, policy);
}
