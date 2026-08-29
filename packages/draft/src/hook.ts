import { lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeCliV1 } from './process.js';
import {
  SYNTHETIC_TOOL_ERROR_V1,
  assertToolCallPolicyV1,
  pairedResultPathV1,
  readPromptpileToolCallsV1,
  sanitizeToolResultsV1,
  writeSyntheticToolResultsV1,
  writeToolResultsV1,
  type ToolArtifactPolicyV1,
} from './artifacts.js';
import { canonicalizeExistingPrefixV1, resolveRelativeInsideV1 } from './paths.js';
import { assertAuthorityPolicyV1, type DraftHookAuthorityV1 } from './policy.js';

export interface FileHookConfigV1 extends ToolArtifactPolicyV1 {
  version: 1;
  promptpileMcpBin: string;
  baseUrl: string;
  token: string;
  execRequestTimeoutMs: number;
  worldRoot: string | null;
  draft: DraftHookAuthorityV1;
}

export function readFileHookConfigV1(configPath: string): FileHookConfigV1 {
  const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Draft hook config must be an object.');
  const config = value as FileHookConfigV1;
  if (
    config.version !== 1 ||
    typeof config.promptpileMcpBin !== 'string' || !path.isAbsolute(config.promptpileMcpBin) ||
    typeof config.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(config.baseUrl) ||
    typeof config.token !== 'string' || !/^[0-9a-f]{64}$/.test(config.token) ||
    !(config.worldRoot === null || (typeof config.worldRoot === 'string' && path.isAbsolute(config.worldRoot))) ||
    !isDraftAuthorityV1(config.draft) ||
    !Number.isSafeInteger(config.execRequestTimeoutMs) || config.execRequestTimeoutMs <= 0 ||
    !Number.isSafeInteger(config.maxToolCallsPerThought) || config.maxToolCallsPerThought <= 0 ||
    !Number.isSafeInteger(config.maxToolResultLineBytes) || config.maxToolResultLineBytes <= 0 ||
    !Array.isArray(config.allowedToolNames) || config.allowedToolNames.length === 0 ||
    new Set(config.allowedToolNames).size !== config.allowedToolNames.length ||
    config.allowedToolNames.some((name) => typeof name !== 'string' || !/^mcp__(?:world|draft)__[a-z_]+$/.test(name))
  ) throw new Error('Draft hook config is invalid.');
  return Object.freeze({
    ...config,
    allowedToolNames: Object.freeze([...config.allowedToolNames]),
    draft: freezeDraftAuthorityV1(config.draft),
  });
}

export async function runFileHookV1(configPath: string): Promise<void> {
  if (process.env.PROMPTPILE_HAS_TOOL_CALLS !== '1') return;
  const config = readFileHookConfigV1(configPath);
  const callsPath = callsPathV1();
  const calls = readPromptpileToolCallsV1(callsPath);
  const resultPath = pairedResultPathV1(callsPath);
  try {
    assertToolCallPolicyV1(calls, config);
    assertAuthorityPolicyV1(calls, config);
  } catch {
    writeSyntheticToolResultsV1(calls, resultPath, SYNTHETIC_TOOL_ERROR_V1, config);
    return;
  }

  const deleteCalls = calls.filter((call) => call.name === 'mcp__draft__delete_file');
  if (deleteCalls.length > 0) {
    if (deleteCalls.length !== calls.length) {
      writeSyntheticToolResultsV1(calls, resultPath, `${SYNTHETIC_TOOL_ERROR_V1}\nSubmit delete_file calls in a separate tool batch.`, config);
      return;
    }
    const contents = calls.map((call) => {
      try {
        const requested = JSON.parse(call.arguments) as { path?: unknown };
        if (typeof requested.path !== 'string') throw new Error('delete_file requires a path.');
        const target = canonicalizeExistingPrefixV1(resolveRelativeInsideV1(config.draft.mcpRoot, requested.path));
        unlinkSync(target);
        return `[DAYLOOM_DELETE_FILE_OK]\nDeleted ${requested.path}.`;
      } catch (error) {
        return `${SYNTHETIC_TOOL_ERROR_V1}\n${error instanceof Error ? error.message : 'delete_file failed.'}`;
      }
    });
    writeToolResultsV1(calls, resultPath, contents, config);
    return;
  }

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
      complete = true;
    }
  } catch { /* converted to explicit tool-result evidence below */ }
  if (!complete) writeSyntheticToolResultsV1(calls, resultPath, SYNTHETIC_TOOL_ERROR_V1, config);
}

function callsPathV1(): string {
  const rawCalls = process.env.PROMPTPILE_ASSISTANT_CALL_FILE ?? process.env.PROMPTPILE_CALLS_FILE;
  const rawOutput = process.env.PROMPTPILE_OUTPUT_DIRECTORY ?? process.env.PROMPTPILE_SCAN_DIRECTORY;
  if (!rawCalls || !rawOutput || !path.isAbsolute(rawCalls) || !path.isAbsolute(rawOutput)) {
    throw new Error('Promptpile tool artifact environment is incomplete.');
  }
  const output = realpathSync(rawOutput);
  const calls = realpathSync(rawCalls);
  if (!lstatSync(calls).isFile() || !calls.endsWith('.calls.jsonl') || path.dirname(calls) !== output) {
    throw new Error('Promptpile ToolCall path is outside the output boundary.');
  }
  return calls;
}

function isDraftAuthorityV1(value: unknown): value is DraftHookAuthorityV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as DraftHookAuthorityV1;
  if (draft.mode === 'files') {
    return typeof draft.mcpRoot === 'string' && path.isAbsolute(draft.mcpRoot)
      && Array.isArray(draft.files)
      && draft.files.length > 0
      && draft.files.every((file) => typeof file === 'string' && path.isAbsolute(file));
  }
  if (draft.mode === 'directory') {
    return typeof draft.mcpRoot === 'string' && path.isAbsolute(draft.mcpRoot)
      && typeof draft.root === 'string' && path.isAbsolute(draft.root);
  }
  return false;
}

function freezeDraftAuthorityV1(draft: DraftHookAuthorityV1): DraftHookAuthorityV1 {
  if (draft.mode === 'files') {
    return Object.freeze({ mode: 'files', mcpRoot: draft.mcpRoot, files: Object.freeze([...draft.files]) });
  }
  return Object.freeze({ mode: 'directory', mcpRoot: draft.mcpRoot, root: draft.root });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stderr.write('Draft hook config path is required.\n');
    process.exitCode = 1;
  } else {
    runFileHookV1(configPath).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Draft hook failed.'}\n`);
      process.exitCode = 1;
    });
  }
}
