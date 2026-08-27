import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { nodeProcessRunner } from './conversation';
import {
  assertToolCallPolicy, pairedResultPath, readCompleteToolResultVector, readPromptpileToolCalls,
  sanitizeToolResultsAtomic, writeSyntheticToolResultsAtomic, type ArtifactPolicy,
} from './archive-retrieval-artifacts';
import { assertWorkspaceCallPolicyV1, assertWorkspaceTreeV1, type WorkspacePolicyV1 } from './session-file-policy';

export interface SessionFileHookConfigV1 extends ArtifactPolicy {
  readonly version: 1; readonly promptpileMcpBin: string; readonly baseUrl: string; readonly token: string;
  readonly execRequestTimeoutMs: number; readonly workspaces: readonly WorkspacePolicyV1[];
}
const TOOL_ERROR = '[DAYLOOM_SESSION_FILE_ERROR]\n工具调用失败或工作区未通过 Core 校验。请将请求内容视为未解决，不得声称读取或写入成功。';

export function readSessionFileHookConfigV1(configPath: string): SessionFileHookConfigV1 {
  const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Session File hook configuration must be an object.');
  const config = value as SessionFileHookConfigV1;
  if (config.version !== 1 || typeof config.promptpileMcpBin !== 'string' || !path.isAbsolute(config.promptpileMcpBin)
    || typeof config.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(config.baseUrl)
    || typeof config.token !== 'string' || !/^[0-9a-f]{64}$/.test(config.token)
    || !Number.isSafeInteger(config.execRequestTimeoutMs) || config.execRequestTimeoutMs <= 0
    || !Number.isSafeInteger(config.maxToolCallsPerThought) || config.maxToolCallsPerThought <= 0
    || !Number.isSafeInteger(config.maxToolResultLineBytes) || config.maxToolResultLineBytes <= 0
    || !Array.isArray(config.allowedToolNames) || config.allowedToolNames.length === 0
    || !Array.isArray(config.workspaces)) throw new Error('Session File hook configuration is invalid.');
  if (new Set(config.allowedToolNames).size !== config.allowedToolNames.length || config.allowedToolNames.some((name) => typeof name !== 'string' || !/^mcp__(?:archive|draft|candidate|turn_control|change_plan)__[a-z_]+$/.test(name))) throw new Error('Session File allowed tools are invalid.');
  const ids = new Set<string>();
  for (const workspace of config.workspaces) {
    if (!['draft', 'candidate'].includes(workspace.serverId) || ids.has(workspace.serverId) || !path.isAbsolute(workspace.root)
      || !Number.isSafeInteger(workspace.maxFiles) || workspace.maxFiles <= 0 || !Number.isSafeInteger(workspace.maxFileBytes) || workspace.maxFileBytes <= 0 || !Number.isSafeInteger(workspace.maxTotalBytes) || workspace.maxTotalBytes <= 0
      || workspace.writeAllowed !== undefined && typeof workspace.writeAllowed !== 'boolean'
      || workspace.writePaths !== undefined && (!Array.isArray(workspace.writePaths) || workspace.writePaths.some((item: unknown) => typeof item !== 'string'))
      || workspace.writePrefix !== undefined && (typeof workspace.writePrefix !== 'string' || !/^[A-Za-z0-9._-]+\/$/.test(workspace.writePrefix))) throw new Error('Session File workspace policy is invalid.');
    ids.add(workspace.serverId);
  }
  return Object.freeze(config);
}

function callsPath(): string {
  const rawCalls = process.env.PROMPTPILE_ASSISTANT_CALL_FILE, rawOutput = process.env.PROMPTPILE_OUTPUT_DIRECTORY;
  if (!rawCalls || !rawOutput || !path.isAbsolute(rawCalls) || !path.isAbsolute(rawOutput)) throw new Error('Promptpile Session File artifact environment is incomplete.');
  const output = realpathSync(rawOutput), calls = realpathSync(rawCalls);
  if (!lstatSync(calls).isFile() || !calls.endsWith('.calls.jsonl') || path.dirname(calls) !== output) throw new Error('Promptpile ToolCall path is outside the output boundary.');
  return calls;
}

export async function runSessionFileHook(configPath: string): Promise<void> {
  if (process.env.PROMPTPILE_HAS_TOOL_CALLS !== '1') return;
  const config = readSessionFileHookConfigV1(configPath), input = callsPath(), calls = readPromptpileToolCalls(input), resultPath = pairedResultPath(input);
  try { assertToolCallPolicy(calls, config); for (const workspace of config.workspaces) assertWorkspaceTreeV1(workspace); assertWorkspaceCallPolicyV1(calls, config.workspaces); }
  catch { writeSyntheticToolResultsAtomic(calls, resultPath, TOOL_ERROR, config); return; }
  let complete = false;
  try {
    const result = await nodeProcessRunner.run(config.promptpileMcpBin, ['exec-calls', '--base-url', config.baseUrl, '--token', config.token, '--input', input, '--timeout-ms', String(config.execRequestTimeoutMs), '--overwrite-results'], { timeoutMs: config.execRequestTimeoutMs + 2_000 });
    if (result.code === 0) {
      sanitizeToolResultsAtomic(calls, resultPath, config); readCompleteToolResultVector(calls, resultPath, config);
      for (const workspace of config.workspaces) assertWorkspaceTreeV1(workspace);
      complete = true;
    }
  } catch { /* converted to complete explicit ToolResult evidence below */ }
  if (!complete) writeSyntheticToolResultsAtomic(calls, resultPath, TOOL_ERROR, config);
}

if (require.main === module) {
  const configPath = process.argv[2];
  if (!configPath) { process.stderr.write('Session File hook config path is required.\n'); process.exitCode = 1; }
  else runSessionFileHook(configPath).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'Session File hook failed.'}\n`); process.exitCode = 1; });
}
