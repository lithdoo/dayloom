import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseToolCallV1, parseToolResultLineV1 } from 'promptpile-protocol';
import { ArchiveRetrievalError } from '../errors';

export interface ArtifactPolicy {
  readonly allowedToolNames: readonly string[];
  readonly maxToolCallsPerThought: number;
  readonly maxToolResultLineBytes: number;
}
export interface ValidatedToolCall {
  readonly id: string;
  readonly name: string;
  readonly raw: Readonly<Record<string, unknown>>;
}
interface ValidatedToolResult { readonly raw: Record<string, unknown>; readonly content: string }
const CALL_SUFFIX = '.calls.jsonl', RESULT_SUFFIX = '.result.jsonl';
const TRUNCATION = '\n[DAYLOOM_TOOL_RESULT_TRUNCATED]\nResult exceeded the Dayloom tool-result limit. Narrow the path, query, glob, or requested line range.';

function artifactError(message: string, cause?: unknown): ArchiveRetrievalError {
  return new ArchiveRetrievalError('artifacts', message, cause === undefined ? undefined : { cause });
}
function records(file: string): Record<string, unknown>[] {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch (error) { throw artifactError(`Could not read Tool Artifact: ${path.basename(file)}`, error); }
  const lines = text.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => line.trim() === '')) throw artifactError(`Tool Artifact is empty or contains blank lines: ${path.basename(file)}`);
  return lines.map((line, index) => {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('line is not an object');
      return value as Record<string, unknown>;
    } catch (error) { throw artifactError(`Tool Artifact line ${index + 1} is malformed: ${path.basename(file)}`, error); }
  });
}
export function pairedResultPath(callsPath: string): string {
  const name = path.basename(callsPath);
  if (!name.endsWith(CALL_SUFFIX) || name.length === CALL_SUFFIX.length) throw artifactError('ToolCall artifact name is invalid.');
  return path.join(path.dirname(callsPath), `${name.slice(0, -CALL_SUFFIX.length)}${RESULT_SUFFIX}`);
}
export function readPromptpileToolCalls(callsPath: string): ValidatedToolCall[] {
  const calls = records(callsPath).map((raw) => {
    const parsed = parseToolCallV1(raw);
    if (!parsed || parsed.id === '' || parsed.type !== 'function' || parsed.function.name === '') throw artifactError(`ToolCall artifact violates Promptpile ToolCall V1: ${path.basename(callsPath)}`);
    return Object.freeze({ id: parsed.id, name: parsed.function.name, raw: Object.freeze({ ...raw }) });
  });
  if (new Set(calls.map((call) => call.id)).size !== calls.length) throw artifactError('ToolCall artifact contains duplicate ids.');
  return calls;
}
export function assertToolCallPolicy(calls: readonly ValidatedToolCall[], policy: ArtifactPolicy): void {
  if (calls.length > policy.maxToolCallsPerThought) throw artifactError(`Thought emitted more than ${policy.maxToolCallsPerThought} ToolCalls.`);
  const allowed = new Set(policy.allowedToolNames);
  if (calls.some((call) => !allowed.has(call.name))) throw artifactError('ToolCall artifact contains a non-allowed retrieval tool.');
}
export function readValidatedToolCalls(callsPath: string, policy: ArtifactPolicy): ValidatedToolCall[] {
  const calls = readPromptpileToolCalls(callsPath);
  assertToolCallPolicy(calls, policy);
  return calls;
}
function validatedResults(calls: readonly ValidatedToolCall[], resultPath: string, policy: ArtifactPolicy): ValidatedToolResult[] {
  const rows = records(resultPath);
  if (rows.length !== calls.length) throw artifactError('ToolResult vector is incomplete.');
  return rows.map((raw, index) => {
    const result = parseToolResultLineV1(raw), call = calls[index];
    if (!result || result.tool_call_id !== call.id || result.name !== undefined && result.name !== call.name) throw artifactError('ToolResult vector is malformed or out of order.');
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > policy.maxToolResultLineBytes) throw artifactError('ToolResult line exceeds the byte bound.');
    return { raw, content: result.content };
  });
}
export function readCompleteToolResultVector(calls: readonly ValidatedToolCall[], resultPath: string, policy: ArtifactPolicy): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(validatedResults(calls, resultPath, policy).map((result) => Object.freeze({ ...result.raw })));
}
function boundedRow(raw: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  const serialized = () => JSON.stringify(raw);
  if (Buffer.byteLength(serialized(), 'utf8') <= maxBytes) return raw;
  const content = typeof raw.content === 'string' ? raw.content : '';
  let low = 0, high = content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    raw.content = content.slice(0, middle) + TRUNCATION;
    if (Buffer.byteLength(serialized(), 'utf8') <= maxBytes) low = middle; else high = middle - 1;
  }
  raw.content = content.slice(0, low) + TRUNCATION;
  if (Buffer.byteLength(serialized(), 'utf8') > maxBytes) throw artifactError('ToolResult structural fields exceed the byte bound.');
  return raw;
}
function writeRowsAtomic(target: string, rows: readonly Record<string, unknown>[]): void {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8'); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temporary, target); } catch (error) { try { rmSync(temporary, { force: true }); } catch {} throw error; }
}
export function writeSyntheticToolResultsAtomic(calls: readonly ValidatedToolCall[], resultPath: string, content: string, policy: ArtifactPolicy): void {
  const rows = calls.map((call) => boundedRow({ tool_call_id: call.id, name: call.name, content }, policy.maxToolResultLineBytes));
  writeRowsAtomic(resultPath, rows);
}
export function sanitizeToolResultsAtomic(calls: readonly ValidatedToolCall[], resultPath: string, policy: ArtifactPolicy): void {
  const rows = records(resultPath);
  if (rows.length !== calls.length) throw artifactError('ToolResult vector is incomplete.');
  const bounded = rows.map((raw, index) => {
    const parsed = parseToolResultLineV1(raw);
    if (!parsed || parsed.tool_call_id !== calls[index].id || parsed.name !== undefined && parsed.name !== calls[index].name) throw artifactError('ToolResult vector is malformed or out of order.');
    return boundedRow({ ...raw }, policy.maxToolResultLineBytes);
  });
  writeRowsAtomic(resultPath, bounded);
  readCompleteToolResultVector(calls, resultPath, policy);
}
export function assertWorkRetrievalClosure(workPath: string, policy: ArtifactPolicy): void {
  let root: string;
  try { root = realpathSync(workPath); if (!lstatSync(root).isDirectory()) throw new Error('not a directory'); }
  catch (error) { throw artifactError('React work path is not a readable directory.', error); }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(CALL_SUFFIX)) continue;
    const callsPath = path.join(root, entry.name), calls = readValidatedToolCalls(callsPath, policy);
    readCompleteToolResultVector(calls, pairedResultPath(callsPath), policy);
  }
}
