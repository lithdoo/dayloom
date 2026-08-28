import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeCliV1 } from './process.js';
import {
  assertToolCallPolicyV1,
  pairedResultPathV1,
  readCompleteToolResultsV1,
  readPromptpileToolCallsV1,
  sanitizeToolResultsV1,
  writeSyntheticToolResultsV1,
  type ToolArtifactPolicyV1,
} from './tool-artifacts.js';

export interface FileHookConfigV1 extends ToolArtifactPolicyV1 {
  version: 1;
  promptpileMcpBin: string;
  baseUrl: string;
  token: string;
  execRequestTimeoutMs: number;
}

const TOOL_ERROR = '[DAYLOOM_WORKSPACE_TOOL_ERROR]\nTool execution failed. Treat the requested read or write as unresolved.';

export function readFileHookConfigV1(configPath: string): FileHookConfigV1 {
  const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace hook config must be an object.');
  const config = value as FileHookConfigV1;
  if (
    config.version !== 1 ||
    typeof config.promptpileMcpBin !== 'string' || !path.isAbsolute(config.promptpileMcpBin) ||
    typeof config.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(config.baseUrl) ||
    typeof config.token !== 'string' || !/^[0-9a-f]{64}$/.test(config.token) ||
    !Number.isSafeInteger(config.execRequestTimeoutMs) || config.execRequestTimeoutMs <= 0 ||
    !Number.isSafeInteger(config.maxToolCallsPerThought) || config.maxToolCallsPerThought <= 0 ||
    !Number.isSafeInteger(config.maxToolResultLineBytes) || config.maxToolResultLineBytes <= 0 ||
    !Array.isArray(config.allowedToolNames) || config.allowedToolNames.length === 0 ||
    new Set(config.allowedToolNames).size !== config.allowedToolNames.length ||
    config.allowedToolNames.some((name) => typeof name !== 'string' || !/^mcp__(?:draft|workspace)__[a-z_]+$/.test(name))
  ) throw new Error('Workspace hook config is invalid.');
  return Object.freeze(config);
}

function callsPathV1(): string {
  const rawCalls = process.env.PROMPTPILE_ASSISTANT_CALL_FILE ?? process.env.PROMPTPILE_CALLS_FILE;
  const rawOutput = process.env.PROMPTPILE_OUTPUT_DIRECTORY ?? process.env.PROMPTPILE_SCAN_DIRECTORY;
  if (!rawCalls || !rawOutput || !path.isAbsolute(rawCalls) || !path.isAbsolute(rawOutput)) throw new Error('Promptpile tool artifact environment is incomplete.');
  const output = realpathSync(rawOutput);
  const calls = realpathSync(rawCalls);
  if (!lstatSync(calls).isFile() || !calls.endsWith('.calls.jsonl') || path.dirname(calls) !== output) throw new Error('Promptpile ToolCall path is outside the output boundary.');
  return calls;
}

export async function runFileHookV1(configPath: string): Promise<void> {
  if (process.env.PROMPTPILE_HAS_TOOL_CALLS !== '1') return;
  const config = readFileHookConfigV1(configPath);
  const callsPath = callsPathV1();
  const calls = readPromptpileToolCallsV1(callsPath);
  const resultPath = pairedResultPathV1(callsPath);
  try { assertToolCallPolicyV1(calls, config); }
  catch { writeSyntheticToolResultsV1(calls, resultPath, TOOL_ERROR, config); return; }

  let complete = false;
  try {
    const result = await runNodeCliV1(config.promptpileMcpBin, [
      'exec-calls',
      '--base-url', config.baseUrl,
      '--token', config.token,
      '--input', callsPath,
      '--timeout-ms', String(config.execRequestTimeoutMs),
      '--overwrite-results',
    ], { timeoutMs: config.execRequestTimeoutMs + 2_000 });
    if (result.code === 0) {
      sanitizeToolResultsV1(calls, resultPath, config);
      readCompleteToolResultsV1(calls, resultPath, config);
      complete = true;
    }
  } catch { /* converted to explicit tool-result evidence below */ }
  if (!complete) writeSyntheticToolResultsV1(calls, resultPath, TOOL_ERROR, config);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stderr.write('Workspace hook config path is required.\n');
    process.exitCode = 1;
  } else {
    runFileHookV1(configPath).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Workspace hook failed.'}\n`);
      process.exitCode = 1;
    });
  }
}
