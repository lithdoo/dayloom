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

export async function writeDerivedConfigs(config: CallerConfig, paths: { thought: string; observe: string; tools: string; sendFinal: string; submitFinal: string; sendConfig: string; submitConfig: string; summaryConfig: string }): Promise<void> {
  const derive = (final: string) => ({ ...config, 'promptpile-react': { tools_file: paths.tools, thought_prompt: paths.thought, observe_prompt: paths.observe, final_prompt: final } });
  await Promise.all([
    writeFile(paths.sendConfig, TOML.stringify(derive(paths.sendFinal) as TOML.JsonMap), 'utf8'),
    writeFile(paths.submitConfig, TOML.stringify(derive(paths.submitFinal) as TOML.JsonMap), 'utf8'),
    writeFile(paths.summaryConfig, TOML.stringify(deriveSummaryConfig(config)), 'utf8'),
  ]);
}
