import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CallerConfig } from '../promptpile/config';
import { writeDerivedConfigs } from '../promptpile/config';
import type { CoreSessionKind } from '../state';
import type { PublishedWorld } from '../world/read';
import { buildDayloomCheckPrompt } from './prompts/check';
import { buildDayloomObservePrompt } from './prompts/observe';
import { SUMMARY_SYSTEM_PROMPT } from './prompts/summary';

export interface CoreSession {
  id: string; kind: CoreSessionKind; root: string; contextDir: string; conversationDir: string;
  sendConfig: string; submitConfig: string; requestsDir: string; summaryConfigPath: string; summaryPromptPath: string;
  submitMarker: string; pinned: PublishedWorld | null; day: string | null;
}
export interface SessionToolingBinding { readonly toolsFile: string; readonly afterHookPath: string }
export interface WorkspaceDefinition {
  kind: CoreSessionKind; thought: string; sendFinal: string; submitFinal: string; submitMarker: string;
  pinned: PublishedWorld | null; day?: string | null;
}

export async function createSessionWorkspace(runtimeRoot: string, id: string, config: CallerConfig, definition: WorkspaceDefinition, tooling?: SessionToolingBinding): Promise<CoreSession> {
  const root = path.join(runtimeRoot, 'sessions', id), contextDir = path.join(root, 'context'), conversationDir = path.join(root, 'conversation'), react = path.join(root, 'react'), compression = path.join(root, 'compression'), requestsDir = path.join(compression, 'requests');
  await Promise.all([mkdir(contextDir, { recursive: true }), mkdir(conversationDir, { recursive: true }), mkdir(react, { recursive: true }), mkdir(requestsDir, { recursive: true })]);
  const thought = path.join(react, 'thought.md'), observe = path.join(react, 'observe.md'), check = path.join(react, 'check.md'), tools = tooling?.toolsFile ?? path.join(react, 'tools.toml'), sendFinal = path.join(react, 'final-send.md'), submitFinal = path.join(react, 'final-submit.md'), sendConfig = path.join(react, 'send.toml'), submitConfig = path.join(react, 'submit.toml');
  const summaryPromptPath = path.join(compression, 'summary.system.md'), summaryConfigPath = path.join(compression, 'summary.toml');
  const retrievalAvailable = tooling !== undefined;
  await Promise.all([writeFile(thought, definition.thought), writeFile(observe, buildDayloomObservePrompt(retrievalAvailable)), writeFile(check, buildDayloomCheckPrompt(retrievalAvailable)), ...(tooling ? [] : [writeFile(tools, 'tools = []\n')]), writeFile(sendFinal, definition.sendFinal), writeFile(submitFinal, definition.submitFinal), writeFile(summaryPromptPath, SUMMARY_SYSTEM_PROMPT)]);
  await writeDerivedConfigs(config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: tools, afterHookPath: tooling?.afterHookPath, sendFinalPrompt: sendFinal, submitFinalPrompt: submitFinal, sendConfig, submitConfig, summaryConfig: summaryConfigPath });
  return { id, kind: definition.kind, root, contextDir, conversationDir, sendConfig, submitConfig, requestsDir, summaryConfigPath, summaryPromptPath, submitMarker: definition.submitMarker, pinned: definition.pinned, day: definition.day ?? null };
}
