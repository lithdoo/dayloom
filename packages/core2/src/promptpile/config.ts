import { readFile, writeFile } from 'node:fs/promises';
import * as TOML from '@iarna/toml';

export type CallerConfig = TOML.JsonMap;
const forbiddenPromptpile = ['dir', 'dirs', 'output_dir', 'quiet', 'input', 'continue', 'tools_file', 'after_hook'];

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

export async function writeDerivedConfigs(config: CallerConfig, paths: { thought: string; sendFinal: string; submitFinal: string; sendConfig: string; submitConfig: string }): Promise<void> {
  const derive = (final: string) => ({ ...config, 'promptpile-react': { max_step: 1, thought_prompt: paths.thought, final_prompt: final } });
  await Promise.all([
    writeFile(paths.sendConfig, TOML.stringify(derive(paths.sendFinal) as TOML.JsonMap), 'utf8'),
    writeFile(paths.submitConfig, TOML.stringify(derive(paths.submitFinal) as TOML.JsonMap), 'utf8'),
  ]);
}
