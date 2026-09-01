import { readCallerLlmConfigV1, writeReactConfigV1, type CallerLlmConfigV1 } from '@dayloom/cli';
import { draftErrorV1 } from './errors.js';

export async function readLlmConfigV1(configPath: string): Promise<CallerLlmConfigV1> {
  try {
    return await readCallerLlmConfigV1(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM config is unusable.';
    throw draftErrorV1('LLM_CONFIG_INVALID', message);
  }
}

export async function writeDerivedReactConfigV1(input: {
  caller: CallerLlmConfigV1;
  target: string;
  thoughtPrompt: string;
  observePrompt: string;
  checkPrompt: string;
  finalPrompt: string;
  toolBinding: { toolsFile: string; afterHookPath: string | null } | null;
}): Promise<void> {
  await writeReactConfigV1(input);
}
