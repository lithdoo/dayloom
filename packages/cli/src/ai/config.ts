import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { cliErrorV1 } from '../cli/errors.js';

export type CallerLlmConfigV1 = TOML.JsonMap;

const FORBIDDEN_PROMPTPILE_FIELDS = Object.freeze([
  'dir',
  'dirs',
  'output_dir',
  'quiet',
  'input',
  'continue',
  'tools_file',
  'after_hook',
] as const);

export async function resolveLlmConfigPathV1(explicitPath: string | null, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const raw = explicitPath ?? env.DAYLOOM_LLM_CONFIG ?? null;
  if (raw === null || raw.trim() === '') throw cliErrorV1('LLM_CONFIG_REQUIRED', 'Draft mutation requires --llm-config or DAYLOOM_LLM_CONFIG.');
  const resolved = path.resolve(raw);
  let stat;
  try { stat = await lstat(resolved); }
  catch { throw cliErrorV1('LLM_CONFIG_REQUIRED', `LLM config does not exist or is unreadable: ${raw}.`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw cliErrorV1('LLM_CONFIG_REQUIRED', `LLM config must be a regular file: ${raw}.`);
  return resolved;
}

export async function readCallerLlmConfigV1(configPath: string): Promise<CallerLlmConfigV1> {
  let text: string;
  try { text = await readFile(configPath, 'utf8'); }
  catch { throw cliErrorV1('LLM_CONFIG_REQUIRED', `LLM config is unreadable: ${configPath}.`); }

  let parsed: TOML.JsonMap;
  try { parsed = TOML.parse(text); }
  catch (error) { throw cliErrorV1('INVALID_ARGUMENT', error instanceof Error ? `LLM config TOML is invalid: ${error.message}` : 'LLM config TOML is invalid.'); }

  if ('promptpile-react' in parsed) throw cliErrorV1('INVALID_ARGUMENT', 'Caller LLM config must not define [promptpile-react].');
  const promptpile = parsed.promptpile;
  if (promptpile !== undefined) {
    if (!promptpile || typeof promptpile !== 'object' || Array.isArray(promptpile) || promptpile instanceof Date) {
      throw cliErrorV1('INVALID_ARGUMENT', '[promptpile] must be a table.');
    }
    for (const key of FORBIDDEN_PROMPTPILE_FIELDS) {
      if (key in promptpile) throw cliErrorV1('INVALID_ARGUMENT', `Caller LLM config must not define [promptpile].${key}.`);
    }
  }
  return parsed;
}

export async function writeReactConfigV1(input: {
  caller: CallerLlmConfigV1;
  target: string;
  thoughtPrompt: string;
  observePrompt: string;
  checkPrompt: string;
  finalPrompt: string;
  toolBinding: { toolsFile: string; afterHookPath: string | null } | null;
}): Promise<void> {
  const runtimeFields: TOML.JsonMap = {};
  if (input.toolBinding !== null) {
    runtimeFields.tools_file = input.toolBinding.toolsFile;
    if (input.toolBinding.afterHookPath !== null) runtimeFields.after_hook = input.toolBinding.afterHookPath;
  }
  const derived: TOML.JsonMap = {
    ...input.caller,
    'promptpile-react': {
      ...runtimeFields,
      thought_prompt: input.thoughtPrompt,
      observe_prompt: input.observePrompt,
      check_prompt: input.checkPrompt,
      final_prompt: input.finalPrompt,
      observe_llm_api_temperature: 0,
      check_llm_api_temperature: 0,
    },
  };
  await writeFile(input.target, TOML.stringify(derived), { encoding: 'utf8', mode: 0o600 });
}
