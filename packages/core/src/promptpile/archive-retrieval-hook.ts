import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { nodeProcessRunner } from './conversation';
import {
  assertToolCallPolicy, pairedResultPath, readCompleteToolResultVector, readPromptpileToolCalls,
  sanitizeToolResultsAtomic, writeSyntheticToolResultsAtomic, type ArtifactPolicy,
} from './archive-retrieval-artifacts';

export interface ArchiveRetrievalHookConfigV1 extends ArtifactPolicy {
  readonly version: 1;
  readonly promptpileMcpBin: string;
  readonly baseUrl: string;
  readonly token: string;
  readonly execRequestTimeoutMs: number;
}
const RETRIEVAL_ERROR = '[DAYLOOM_RETRIEVAL_ERROR]\nArchive retrieval failed for this tool call. Treat the requested information as unresolved and do not invent it.';

function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Archive retrieval hook configuration must be an object.');
  return value as Record<string, unknown>;
}
export function readArchiveRetrievalHookConfig(configPath: string): ArchiveRetrievalHookConfigV1 {
  const value = exactRecord(JSON.parse(readFileSync(configPath, 'utf8')));
  const keys = ['version', 'promptpileMcpBin', 'baseUrl', 'token', 'execRequestTimeoutMs', 'maxToolCallsPerThought', 'maxToolResultLineBytes', 'allowedToolNames'];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value)) || value.version !== 1
    || typeof value.promptpileMcpBin !== 'string' || !path.isAbsolute(value.promptpileMcpBin)
    || typeof value.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(value.baseUrl)
    || typeof value.token !== 'string' || !/^[0-9a-f]{64}$/.test(value.token)
    || !Number.isSafeInteger(value.execRequestTimeoutMs) || (value.execRequestTimeoutMs as number) <= 0
    || !Number.isSafeInteger(value.maxToolCallsPerThought) || (value.maxToolCallsPerThought as number) <= 0
    || !Number.isSafeInteger(value.maxToolResultLineBytes) || (value.maxToolResultLineBytes as number) <= 0
    || !Array.isArray(value.allowedToolNames) || value.allowedToolNames.length === 0 || value.allowedToolNames.some((name) => typeof name !== 'string' || name === '')) throw new Error('Archive retrieval hook configuration is invalid.');
  return Object.freeze(value as unknown as ArchiveRetrievalHookConfigV1);
}
function exactCallsPath(): string {
  const rawCalls = process.env.PROMPTPILE_ASSISTANT_CALL_FILE, rawOutput = process.env.PROMPTPILE_OUTPUT_DIRECTORY;
  if (!rawCalls || !rawOutput || !path.isAbsolute(rawCalls) || !path.isAbsolute(rawOutput)) throw new Error('Promptpile retrieval artifact environment is incomplete.');
  const output = realpathSync(rawOutput), calls = realpathSync(rawCalls);
  if (!lstatSync(calls).isFile() || !calls.endsWith('.calls.jsonl') || path.dirname(calls) !== output) throw new Error('Promptpile ToolCall path is outside the exact output directory boundary.');
  return calls;
}
export async function runArchiveRetrievalHook(configPath: string): Promise<void> {
  if (process.env.PROMPTPILE_HAS_TOOL_CALLS !== '1') return;
  const config = readArchiveRetrievalHookConfig(configPath), callsPath = exactCallsPath();
  const calls = readPromptpileToolCalls(callsPath), resultPath = pairedResultPath(callsPath);
  try { assertToolCallPolicy(calls, config); }
  catch {
    writeSyntheticToolResultsAtomic(calls, resultPath, RETRIEVAL_ERROR, config);
    return;
  }
  let complete = false;
  try {
    const result = await nodeProcessRunner.run(config.promptpileMcpBin, [
      'exec-calls', '--base-url', config.baseUrl, '--token', config.token, '--input', callsPath,
      '--timeout-ms', String(config.execRequestTimeoutMs), '--overwrite-results',
    ], { timeoutMs: config.execRequestTimeoutMs + 2_000 });
    if (result.code === 0) {
      sanitizeToolResultsAtomic(calls, resultPath, config);
      readCompleteToolResultVector(calls, resultPath, config);
      complete = true;
    }
  } catch { /* converted to explicit evidence below */ }
  if (!complete) writeSyntheticToolResultsAtomic(calls, resultPath, RETRIEVAL_ERROR, config);
}

if (require.main === module) {
  const configPath = process.argv[2];
  if (!configPath) { process.stderr.write('Archive retrieval hook config path is required.\n'); process.exitCode = 1; }
  else runArchiveRetrievalHook(configPath).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Archive retrieval hook failed.'}\n`);
    process.exitCode = 1;
  });
}
