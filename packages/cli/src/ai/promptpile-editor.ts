import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DraftWorkspaceEditorInputV1, DraftWorkspaceEditorV1 } from '../draft/mutate.js';
import { resolvePromptpileBoundariesV1 } from './binaries.js';
import { readCallerLlmConfigV1, resolveLlmConfigPathV1, writeReactConfigV1 } from './config.js';
import { startFileRuntimeV1 } from './file-runtime.js';
import { appendPromptpileUserV1, runPromptpileReactV1 } from './react.js';

export const promptpileWorkspaceEditorV1: DraftWorkspaceEditorV1 = Object.freeze({
  async edit(input) { await editWorkspaceWithPromptpileV1(input); },
});

export async function editWorkspaceWithPromptpileV1(input: DraftWorkspaceEditorInputV1): Promise<void> {
  const configPath = await resolveLlmConfigPathV1(input.llmConfigPath);
  const callerConfig = await readCallerLlmConfigV1(configPath);
  const boundaries = await resolvePromptpileBoundariesV1();
  const operationRoot = await mkdtemp(path.join(os.tmpdir(), `dayloom-ai-${input.command}-`));
  const draftRoot = path.join(operationRoot, 'draft');
  const runtimeRoot = path.join(operationRoot, 'file-runtime');
  const reactRoot = path.join(operationRoot, 'react');
  const conversation = path.join(operationRoot, 'conversation');
  const context = path.join(operationRoot, 'context');
  try {
    await materializeDraftV1(input, draftRoot);
    const runtime = await startFileRuntimeV1({
      runtimeRoot,
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      draftRoot,
      workspaceRoot: input.workspaceRoot,
    });
    try {
      await mkdir(reactRoot, { recursive: true });
      const thought = path.join(reactRoot, 'thought.md');
      const observe = path.join(reactRoot, 'observe.md');
      const check = path.join(reactRoot, 'check.md');
      const final = path.join(reactRoot, 'final.md');
      const reactConfig = path.join(reactRoot, 'config.toml');
      await Promise.all([
        writeFile(thought, thoughtPromptV1(input), 'utf8'),
        writeFile(observe, observePromptV1(), 'utf8'),
        writeFile(check, checkPromptV1(), 'utf8'),
        writeFile(final, finalPromptV1(), 'utf8'),
      ]);
      await writeReactConfigV1({
        caller: callerConfig,
        target: reactConfig,
        thoughtPrompt: thought,
        observePrompt: observe,
        checkPrompt: check,
        finalPrompt: final,
        toolsFile: runtime.binding.toolsFile,
        afterHookPath: runtime.binding.afterHookPath,
      });
      const task = taskPromptV1(input);
      await appendPromptpileUserV1(boundaries.promptpileBin, conversation, task);
      await runPromptpileReactV1({
        reactBin: boundaries.reactBin,
        validateProcessPile: boundaries.validateProcessPile,
        config: reactConfig,
        context,
        conversation,
        workRoot: path.join(operationRoot, 'react-work'),
        maxSteps: 10,
        timeoutMs: 5 * 60_000,
      });
      runtime.assertHealthy();
    } finally {
      await runtime.close();
    }
  } finally {
    await rm(operationRoot, { recursive: true, force: true });
  }
}

async function materializeDraftV1(input: DraftWorkspaceEditorInputV1, draftRoot: string): Promise<void> {
  await mkdir(draftRoot, { recursive: true });
  for (const [relative, bytes] of input.draft.files) {
    const target = path.join(draftRoot, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o400 });
    if (process.platform !== 'win32') await chmod(target, 0o400);
  }
}

function thoughtPromptV1(input: DraftWorkspaceEditorInputV1): string {
  return `You are the Dayloom World workspace editor for the ${input.command} command.

The Draft is creative semantic input, not a mutation DSL. Read it from the read-only draft tools. Inspect the current World only through the workspace tools. Apply the Draft by editing the workspace directly.

Hard rules:
- Never invent or edit Archive protocol files such as manifest.json, current.json, commits/, objects/, operations/, or .locks/.
- Never try to write the Draft root.
- Use mcp__workspace__write_file for World changes.
- Preserve existing information unless the Draft asks to change it.
- Do not change command lifecycle/control; the program owns target control.
- Keep changes within the ${input.command} command scope described below.
- Before stopping, read back the important files you wrote and fix obvious structural mistakes.

${commandScopeV1(input)}

Work until the Draft has been reflected in the workspace. Do not produce a Change Plan, Candidate, Assignment, or patch yourself; the program computes the Patch from the final workspace.`;
}

function commandScopeV1(input: DraftWorkspaceEditorInputV1): string {
  const day = input.targetControl.day ?? '<none>';
  if (input.command === 'init') return `INIT scope: create the initial World documents. state/world.yaml with a non-empty title is required. Do not create days/**. profile/dayloom.json is program-owned and will be installed after you finish.`;
  if (input.command === 'plan') return `PLAN scope: only edit days/${day}/plan.json, days/${day}/timeline.md, days/${day}/dialogue/planning.md, and days/${day}/events/index.yaml.`;
  if (input.command === 'play') return `PLAY scope: only edit days/${day}/play.json, days/${day}/play-index.json, days/${day}/summary.md, days/${day}/timeline.md, and days/${day}/events/**. Long-term state is settled later by deterministic event patches.`;
  return `REVISE scope: edit long-term canon/state/entity/memory/story-seed/custom World documents. Do not edit profile/**, days/**, or state/calendar.yaml.`;
}

function observePromptV1(): string {
  return `Summarize only what happened in the latest tool round using exactly these fields:
[EVIDENCE]
Successful reads/writes that matter; <none> if none.
[REMAINING]
Concrete workspace work still needed; <none> if complete.
[NEXT_TOOL_ACTION]
One specific namespaced tool action that is necessary next; <none> if complete.`;
}

function checkPromptV1(): string {
  return `Use only the latest Observe. Call react_check_decision exactly once. If [NEXT_TOOL_ACTION] names one concrete necessary tool action, use {"decision":true}; otherwise use {"decision":false}. Do not continue just to explain or polish prose.`;
}

function finalPromptV1(): string {
  return `Briefly confirm that the workspace editing pass is complete. Final text is not a structured result and is not used to publish the World.`;
}

function taskPromptV1(input: DraftWorkspaceEditorInputV1): string {
  return `Apply the submitted Draft to the Dayloom workspace.
Command: ${input.command}
Base commit: ${input.baseCommitId ?? '<none>'}
Target control: ${JSON.stringify(input.targetControl)}
Draft snapshot hash: ${input.draft.hash}
Draft files: ${input.draft.snapshot.entries.map((entry) => entry.path).join(', ')}`;
}
