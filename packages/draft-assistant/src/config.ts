import { readFile, writeFile } from 'node:fs/promises';
import * as TOML from '@iarna/toml';
import { assistantErrorV1 } from './errors.js';

export type CallerLlmConfigV1 = TOML.JsonMap;
const FORBIDDEN = Object.freeze(['dir', 'dirs', 'output_dir', 'quiet', 'input', 'continue', 'tools_file', 'after_hook'] as const);

export async function readLlmConfigV1(configPath: string): Promise<CallerLlmConfigV1> {
  let text: string;
  try { text = await readFile(configPath, 'utf8'); }
  catch { throw assistantErrorV1('LLM_CONFIG_INVALID', `LLM config is unreadable: ${configPath}.`); }
  let parsed: TOML.JsonMap;
  try { parsed = TOML.parse(text); }
  catch (error) { throw assistantErrorV1('LLM_CONFIG_INVALID', error instanceof Error ? `LLM config TOML is invalid: ${error.message}` : 'LLM config TOML is invalid.'); }
  if ('promptpile-react' in parsed) throw assistantErrorV1('LLM_CONFIG_INVALID', 'Caller LLM config must not define [promptpile-react].');
  const promptpile = parsed.promptpile;
  if (promptpile !== undefined) {
    if (!promptpile || typeof promptpile !== 'object' || Array.isArray(promptpile) || promptpile instanceof Date) throw assistantErrorV1('LLM_CONFIG_INVALID', '[promptpile] must be a table.');
    for (const key of FORBIDDEN) if (key in promptpile) throw assistantErrorV1('LLM_CONFIG_INVALID', `Caller LLM config must not define [promptpile].${key}.`);
  }
  return parsed;
}

export async function writeDerivedReactConfigV1(input: {
  caller: CallerLlmConfigV1; target: string; thoughtPrompt: string; observePrompt: string;
  checkPrompt: string; finalPrompt: string; toolBinding: { toolsFile: string; afterHookPath: string | null };
}): Promise<void> {
  const runtimeFields: TOML.JsonMap = { tools_file: input.toolBinding.toolsFile };
  if (input.toolBinding.afterHookPath !== null) runtimeFields.after_hook = input.toolBinding.afterHookPath;
  const derived: TOML.JsonMap = {
    ...input.caller,
    'promptpile-react': {
      ...runtimeFields,
      thought_prompt: input.thoughtPrompt, observe_prompt: input.observePrompt,
      check_prompt: input.checkPrompt, final_prompt: input.finalPrompt,
      observe_llm_api_temperature: 0, check_llm_api_temperature: 0,
    },
  };
  await writeFile(input.target, TOML.stringify(derived), { encoding: 'utf8', mode: 0o600 });
}
