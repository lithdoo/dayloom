import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DraftWorkspaceEditorInputV1, DraftWorkspaceEditorV1, DraftWorkspaceRepairInputV1 } from '../draft/mutate.js';
import { resolvePromptpileBoundariesV1 } from './binaries.js';
import { readCallerLlmConfigV1, resolveLlmConfigPathV1, writeReactConfigV1 } from './config.js';
import { startFileRuntimeV1 } from './file-runtime.js';
import { appendPromptpileUserV1, ReactProcessErrorV1, runPromptpileReactV1 } from './react.js';

export const promptpileWorkspaceEditorV1: DraftWorkspaceEditorV1 = Object.freeze({
  async edit(input: DraftWorkspaceEditorInputV1): Promise<void> { await editWorkspaceWithPromptpileV1(input); },
  async repair(input: DraftWorkspaceRepairInputV1): Promise<void> { await editWorkspaceWithPromptpileV1(input); },
});

export async function editWorkspaceWithPromptpileV1(input: DraftWorkspaceEditorInputV1 | DraftWorkspaceRepairInputV1): Promise<void> {
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
      command: input.command,
      targetDay: input.targetControl.day,
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
      await runReactWithDecisionRetriesV1(async (reactAttempt) => {
        await runPromptpileReactV1({
            reactBin: boundaries.reactBin,
            validateProcessPile: boundaries.validateProcessPile,
            config: reactConfig,
            context,
            conversation,
            workRoot: path.join(operationRoot, `react-work-${reactAttempt}`),
            maxSteps: 10,
            timeoutMs: 5 * 60_000,
        });
      });
      runtime.assertHealthy();
    } finally {
      await runtime.close();
    }
  } finally {
    await rm(operationRoot, { recursive: true, force: true });
  }
}

export async function runReactWithDecisionRetriesV1(run: (attempt: number) => Promise<void>): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await run(attempt);
      return;
    } catch (error) {
      if (!(error instanceof ReactProcessErrorV1) || error.code !== 'check_decision_invalid' || attempt === maxAttempts) throw error;
    }
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

function thoughtPromptV1(input: DraftWorkspaceEditorInputV1 | DraftWorkspaceRepairInputV1): string {
  const repair = 'diagnostics' in input
    ? `This is bounded repair attempt ${input.attempt}/${input.maxAttempts}. Fix every validation diagnostic below:\n${input.diagnostics.map((diagnostic) => `- ${diagnostic.message}`).join('\n')}\nYour first tool round must write the missing or invalid diagnostic target. Do not repeat workspace discovery or claim completion before a successful corrective write.\n`
    : '';
  return `You are the Dayloom World workspace editor for the ${input.command} command.

${repair}

The Draft is creative semantic input, not a mutation DSL. Read it from the read-only draft tools. Inspect the current World only through the workspace tools. Apply the Draft by editing the workspace directly.

Hard rules:
- Never invent or edit Archive protocol files such as manifest.json, current.json, commits/, objects/, operations/, or .locks/.
- Never try to write the Draft root.
- Use search_files for path/name discovery and search_files_content for content discovery before reading files one by one.
- Use read_file_lines for focused reads of search results; use directory_tree when structural context is needed.
- Use mcp__workspace__create_directory when an allowed entity, custom, or event parent directory does not exist.
- Only revise may use mcp__workspace__delete_file. When deleting an entity, delete every file in its entity directory and remove its ID and references from the indexes/documents in the same pass.
- Use mcp__workspace__write_file for World changes.
- Preserve existing information unless the Draft asks to change it.
- Do not change command lifecycle/control; the program owns target control.
- Keep changes within the ${input.command} command scope described below.
- A successful editing pass must make at least one successful workspace write. A read-only or no-op pass is incomplete.
- Before stopping, read back the important files you wrote and fix obvious structural mistakes.

${commandScopeV1(input)}

Work until the Draft has been reflected in the workspace. Do not produce a Change Plan, Candidate, Assignment, or patch yourself; the program computes the Patch from the final workspace.`;
}

function commandScopeV1(input: DraftWorkspaceEditorInputV1): string {
  const day = input.targetControl.day ?? '<none>';
  if (input.command === 'init') return `INIT scope: create the complete initial World document profile below. Do not create days/**. profile/dayloom.json is program-owned and will be installed after you finish.

Required Markdown documents (non-empty UTF-8):
- canon/premise.md, canon/rules.md, canon/style.md, canon/user-role.md
- memory/short-term.md, memory/long-term.md

Required YAML documents and exact top-level fields:
- state/world.yaml: schemaVersion: 1, non-empty title, non-empty status

The program has already seeded the following neutral structural YAML documents. Inspect and preserve them unless the Draft requires a semantic change:
- characters/index.yaml, locations/index.yaml, arcs/index.yaml: schemaVersion: 1 and ids: []
- state/calendar.yaml: schemaVersion: 1, currentDay: null, elapsed: null for a new World
- state/progress.yaml: schemaVersion: 1, activeArcIds: []
- state/variables.yaml: schemaVersion: 1, variables: {}
- memory/facts.yaml: schemaVersion: 1, facts: []
- memory/unresolved-threads.yaml: schemaVersion: 1, threads: []
- memory/important-events.yaml: schemaVersion: 1, events: []
- story-seeds/active.yaml: schemaVersion: 1, seeds: []

For a minimal initial World, keep the seeded empty indexes and collections. The standard parent directories are program-created; create allowed entity or custom subdirectories when the Draft needs them. Create state/world.yaml and every required Markdown document from the Draft with mcp__workspace__write_file. Do not stop until all required paths exist.`;
  if (input.command === 'plan') return `PLAN scope: create exactly days/${day}/plan.json, days/${day}/timeline.md, days/${day}/dialogue/planning.md, and days/${day}/events/index.yaml. The program has already created all allowed parent directories. Do not spend a tool round rediscovering the World: start by writing plan.json from the submitted Draft. plan.json must be exactly a JSON object with version: 1 and a non-empty intent. timeline.md and dialogue/planning.md must be non-empty. events/index.yaml must be exactly schemaVersion: 1 and ids: [].`;
  if (input.command === 'play') return `PLAY scope: only edit days/${day}/play.json, days/${day}/play-index.json, days/${day}/summary.md, days/${day}/timeline.md, and days/${day}/events/**. Long-term state is settled later by deterministic event patches.

The program has already created the day, events, and event1 parent directories. Create event2..eventN directories when needed. Do not spend a tool round rediscovering the existing plan. Start by writing play-index.json and events/index.yaml. Continue immediately with the event files below.

Create a settlement-ready event set. Required indexes:
- play-index.json: {"version":1,"eventIds":["event1", ...]}
- events/index.yaml: schemaVersion: 1 and the same sequential ids event1..eventN

For each events/<eventId>/ create non-empty scene.md, dialogue.md, user-action.md and these exact YAML shapes:
- event.yaml fields: schemaVersion: 1, id, beatId (string or null), title, locationId (stable id or null), participantIds (array), status: resolved
- result.yaml fields: schemaVersion: 1, summary, learnedFacts (array of non-empty strings), timeAdvanced (string or null), completedBeatIds (array of non-empty strings), skippedBeatIds (array of non-empty strings), endDay (boolean); never use objects inside these three arrays
- state-patch.yaml fields: schemaVersion: 1 and changes: []; use an empty changes array unless a supported deterministic state change is clearly required

Every state patch expected value must exactly match the current long-term World. Use each world-variable/character-status/character-location/location-status/arc-stage target at most once across the whole day, and use only World variable keys matching [A-Za-z][A-Za-z0-9_-]*.

play-index.json and events/index.yaml must list exactly the event directories you create.`;
  return `REVISE scope: add, modify, or delete long-term canon/state/entity/memory/story-seed/custom World documents. Do not edit profile/**, days/**, or state/calendar.yaml. Entity deletion must remove every file under the entity ID and update its index plus all references so the complete World remains closed.`;
}

function observePromptV1(): string {
  return `Do not call or request tools. Summarize only what happened in the latest tool round using exactly these fields:
[EVIDENCE]
Successful reads/writes that matter; <none> if none.
[REMAINING]
Concrete workspace work still needed; <none> only if the Draft is applied and at least one workspace write has succeeded.
[SHOULD_CONTINUE]
Exactly true if [REMAINING] is not <none> or no workspace write has succeeded; otherwise exactly false. Do not name a tool in this field.`;
}

function checkPromptV1(): string {
  return `Use only [SHOULD_CONTINUE] from the latest Observe. Call the only available tool, react_check_decision, exactly once with {"decision":true} when that field is true, or {"decision":false} when it is false. Produce no prose and never call or repeat a tool name mentioned in [EVIDENCE] or [REMAINING].`;
}

function finalPromptV1(): string {
  return `Briefly confirm that the workspace editing pass is complete. Final text is not a structured result and is not used to publish the World.`;
}

function taskPromptV1(input: DraftWorkspaceEditorInputV1 | DraftWorkspaceRepairInputV1): string {
  const repair = 'diagnostics' in input ? `\nRepair diagnostics: ${JSON.stringify(input.diagnostics)}` : '';
  const draftPreview = draftPreviewV1(input);
  return `Apply the submitted Draft to the Dayloom workspace.
Command: ${input.command}
Base commit: ${input.baseCommitId ?? '<none>'}
Target control: ${JSON.stringify(input.targetControl)}
Draft snapshot hash: ${input.draft.hash}
Draft files: ${input.draft.snapshot.entries.map((entry) => entry.path).join(', ')}${repair}
Draft preview (authoritative content remains in the read-only Draft MCP):${draftPreview}`;
}

function draftPreviewV1(input: DraftWorkspaceEditorInputV1): string {
  let remaining = 2_048;
  let result = '';
  let truncated = false;
  for (const [documentPath, bytes] of input.draft.files) {
    if (remaining === 0) { truncated = true; break; }
    const text = new TextDecoder().decode(bytes);
    const excerpt = text.slice(0, remaining);
    result += `\n--- ${documentPath} ---\n${excerpt}`;
    remaining -= excerpt.length;
    if (excerpt.length !== text.length) truncated = true;
  }
  if (truncated) result += '\n[Draft preview truncated; use search_files_content and read_file_lines for the authoritative content.]';
  return result;
}
