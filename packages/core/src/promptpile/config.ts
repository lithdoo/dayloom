import { readFile, writeFile } from 'node:fs/promises';
import * as TOML from '@iarna/toml';

export type CallerConfig = TOML.JsonMap;
const forbiddenPromptpile = ['dir', 'dirs', 'output_dir', 'quiet', 'input', 'continue', 'tools_file', 'after_hook'];
const summaryPromptpileFields = [
  'llm_api',
  'llm_api_key',
  'llm_api_key_env',
  'llm_api_model',
  'llm_api_base_url',
  'llm_api_temperature',
  'llm_api_extra_body',
] as const;

export async function readCallerConfig(configPath: string): Promise<CallerConfig> {
  const parsed = TOML.parse(await readFile(configPath, 'utf8'));
  if ('promptpile-react' in parsed) throw new Error('Caller config must not define [promptpile-react].');
  const promptpile = parsed.promptpile;
  if (promptpile !== undefined) {
    if (!promptpile || typeof promptpile !== 'object' || Array.isArray(promptpile)) throw new Error('[promptpile] must be a table.');
    for (const key of forbiddenPromptpile) if (key in promptpile) throw new Error(`Caller config must not define [promptpile].${key}.`);
  }
  return parsed;
}

export function deriveSummaryConfig(config: CallerConfig): CallerConfig {
  const derived: CallerConfig = {};
  if (config.llm_api !== undefined) derived.llm_api = config.llm_api;
  const source = config.promptpile;
  if (source && typeof source === 'object' && !Array.isArray(source) && !(source instanceof Date)) {
    const promptpile: TOML.JsonMap = {};
    for (const field of summaryPromptpileFields) {
      const value = source[field];
      if (value !== undefined) promptpile[field] = value;
    }
    if (Object.keys(promptpile).length > 0) derived.promptpile = promptpile;
  }
  return derived;
}

export interface DerivedReactPaths {
  thoughtPrompt: string; observePrompt: string; checkPrompt: string; toolsFile: string; afterHookPath?: string;
  sendFinalPrompt: string; submitFinalPrompt: string; sendConfig: string; submitConfig: string; summaryConfig: string;
}
export async function writeDerivedConfigs(config: CallerConfig, paths: DerivedReactPaths): Promise<void> {
  const derive = (final: string) => ({ ...config, 'promptpile-react': {
    tools_file: paths.toolsFile, thought_prompt: paths.thoughtPrompt, observe_prompt: paths.observePrompt, check_prompt: paths.checkPrompt,
    final_prompt: final, ...(paths.afterHookPath ? { after_hook: paths.afterHookPath } : {}),
  } });
  await Promise.all([
    writeFile(paths.sendConfig, TOML.stringify(derive(paths.sendFinalPrompt) as TOML.JsonMap), 'utf8'),
    writeFile(paths.submitConfig, TOML.stringify(derive(paths.submitFinalPrompt) as TOML.JsonMap), 'utf8'),
    writeFile(paths.summaryConfig, TOML.stringify(deriveSummaryConfig(config)), 'utf8'),
  ]);
}
