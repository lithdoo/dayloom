import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildTargetControlV1,
  hashDayloomPatchV1,
  hashRootTreeV1,
  type DayloomCommandV1,
  type WorldControlV1,
} from '@dayloom/archive-protocol';
import type { ParsedInvocationV1 } from '../cli/argv.js';
import { CliErrorV1, cliErrorV1 } from '../cli/errors.js';
import { buildPatchFromTargetTreeV1, changedAfterFilesV1 } from '../patch/build.js';
import { materializeWorkspaceV1, scanWorkspaceV1 } from '../workspace/files.js';
import { validateWorldProfileWorkspaceV1 } from '../world/domain-validator.js';
import { assertPinnedWorldUnchangedV1, publishV1, validatePreparedPublicationV1 } from '../world/publish.js';
import type { PublishedHeadV1 } from '../world/read.js';
import { assertRequestedBaseV1 } from '../commands/base.js';
import { captureDraftInputV1, type CapturedDraftSnapshotV1 } from './snapshot.js';
import { lintCapturedDraftV1 } from './lint.js';

export type DraftDrivenCommandV1 = Extract<DayloomCommandV1, 'init' | 'plan' | 'play' | 'revise'>;

export interface DraftWorkspaceEditorInputV1 {
  command: DraftDrivenCommandV1;
  workspaceRoot: string;
  draft: CapturedDraftSnapshotV1;
  baseCommitId: string | null;
  targetControl: Readonly<WorldControlV1>;
  llmConfigPath: string | null;
}

export interface DraftWorkspaceEditorV1 {
  edit(input: DraftWorkspaceEditorInputV1): Promise<void>;
  repair?(input: DraftWorkspaceRepairInputV1): Promise<void>;
}

export interface DraftValidationDiagnosticV1 {
  code: 'WORLD_VALIDATION_FAILED';
  message: string;
}

export interface DraftWorkspaceRepairInputV1 extends DraftWorkspaceEditorInputV1 {
  attempt: number;
  maxAttempts: number;
  diagnostics: readonly DraftValidationDiagnosticV1[];
}

export async function runDraftMutationWithEditorV1(input: {
  worldRoot: string;
  invocation: Readonly<ParsedInvocationV1>;
  head: PublishedHeadV1 | null;
  editor: DraftWorkspaceEditorV1;
}): Promise<unknown> {
  const command = input.invocation.command;
  if (command !== 'init' && command !== 'plan' && command !== 'play' && command !== 'revise') {
    throw cliErrorV1('INTERNAL_ERROR', 'Draft mutation engine received a non-Draft command.');
  }
  if (input.head !== null) assertRequestedBaseV1(input.invocation.baseCommitId, input.head);

  const draft = await captureDraftInputV1(input.invocation);
  lintCapturedDraftV1(draft);
  const targetControl = buildTargetControlV1(command, input.head?.commit.control ?? null);
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), `dayloom-${command}-v1-`));
  try {
    if (input.head !== null) {
      await materializeWorkspaceV1({ worldRoot: input.worldRoot, tree: input.head.tree, workspaceRoot });
    } else {
      await mkdir(workspaceRoot, { recursive: true });
      await Promise.all([
        'canon', 'characters', 'locations', 'arcs', 'state', 'memory', 'story-seeds', 'custom',
      ].map((directory) => mkdir(path.join(workspaceRoot, directory), { recursive: true })));
      await seedInitialWorldStructureV1(workspaceRoot);
    }
    await prepareCommandWorkspaceDirectoriesV1(command, workspaceRoot, targetControl);

    try {
      await input.editor.edit({
        command,
        workspaceRoot,
        draft,
        baseCommitId: input.head?.commit.id ?? null,
        targetControl,
        llmConfigPath: input.invocation.llmConfigPath,
      });
    } catch (error) {
      if (error instanceof CliErrorV1) throw error;
      throw cliErrorV1('AI_FAILED', error instanceof Error ? error.message : 'Workspace editor failed.');
    }

    if (command === 'init') await installProfileDescriptorV1(workspaceRoot);
    const validated = await validateWithBoundedRepairV1({
      command,
      workspaceRoot,
      draft,
      baseCommitId: input.head?.commit.id ?? null,
      targetControl,
      llmConfigPath: input.invocation.llmConfigPath,
      editor: input.editor,
    });
    const { workspace, profile } = validated;

    const patch = buildPatchFromTargetTreeV1({
      command,
      baseCommitId: input.head?.commit.id ?? null,
      baseTree: input.head?.tree ?? null,
      targetTree: workspace.tree,
      draftSnapshotHash: draft.hash,
      beforeControl: input.head?.commit.control ?? null,
      afterControl: targetControl,
    });

    const initialTitle = command === 'init' ? profile.title : undefined;
    const publication = {
      worldRoot: input.worldRoot,
      base: input.head,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
      draftSnapshot: { snapshot: draft.snapshot, files: draft.files },
      ...(initialTitle === undefined ? {} : { initialTitle }),
    };
    validatePreparedPublicationV1(publication);
    if (input.invocation.dryRun) {
      await assertPinnedWorldUnchangedV1(input.worldRoot, input.head);
      return {
        mode: 'dry-run',
        baseCommitId: input.head?.commit.id ?? null,
        patchHash: hashDayloomPatchV1(patch),
        patch,
        changedPaths: patch.changes.length,
        controlChanged: JSON.stringify(patch.control.before) !== JSON.stringify(patch.control.after),
        draftSnapshotHash: draft.hash,
        ...(initialTitle === undefined ? {} : { title: initialTitle }),
      };
    }

    return await publishV1(publication);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function prepareCommandWorkspaceDirectoriesV1(
  command: DraftDrivenCommandV1,
  workspaceRoot: string,
  targetControl: Readonly<WorldControlV1>,
): Promise<void> {
  if (command !== 'plan' && command !== 'play') return;
  if (targetControl.day === null) throw cliErrorV1('INTERNAL_ERROR', `${command} target day is missing.`);
  const dayRoot = path.join(workspaceRoot, 'days', targetControl.day);
  const directories = command === 'plan'
    ? [dayRoot, path.join(dayRoot, 'dialogue'), path.join(dayRoot, 'events')]
    : [dayRoot, path.join(dayRoot, 'events'), path.join(dayRoot, 'events', 'event1')];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
}

async function seedInitialWorldStructureV1(workspaceRoot: string): Promise<void> {
  const documents = new Map<string, string>([
    ['characters/index.yaml', 'schemaVersion: 1\nids: []\n'],
    ['locations/index.yaml', 'schemaVersion: 1\nids: []\n'],
    ['arcs/index.yaml', 'schemaVersion: 1\nids: []\n'],
    ['state/calendar.yaml', 'schemaVersion: 1\ncurrentDay: null\nelapsed: null\n'],
    ['state/progress.yaml', 'schemaVersion: 1\nactiveArcIds: []\n'],
    ['state/variables.yaml', 'schemaVersion: 1\nvariables: {}\n'],
    ['memory/facts.yaml', 'schemaVersion: 1\nfacts: []\n'],
    ['memory/unresolved-threads.yaml', 'schemaVersion: 1\nthreads: []\n'],
    ['memory/important-events.yaml', 'schemaVersion: 1\nevents: []\n'],
    ['story-seeds/active.yaml', 'schemaVersion: 1\nseeds: []\n'],
  ]);
  await Promise.all([...documents].map(([documentPath, contents]) => (
    writeFile(path.join(workspaceRoot, ...documentPath.split('/')), contents, { encoding: 'utf8', flag: 'wx' })
  )));
}

async function validateWithBoundedRepairV1(input: DraftWorkspaceEditorInputV1 & {
  editor: DraftWorkspaceEditorV1;
}): Promise<{
  workspace: Awaited<ReturnType<typeof scanWorkspaceV1>>;
  profile: ReturnType<typeof validateWorldProfileWorkspaceV1>;
}> {
  const maxAttempts = 4;
  let previousFailureFingerprint: string | null = null;
  for (let attempt = 0; ; attempt += 1) {
    let workspaceHash = '<unscannable>';
    try {
      const workspace = await scanWorkspaceV1(input.workspaceRoot);
      workspaceHash = hashRootTreeV1(workspace.tree);
      const profile = validateWorldProfileWorkspaceV1(workspace);
      await validateCommandTargetV1(input.command, input.workspaceRoot, input.targetControl);
      return { workspace, profile };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${input.command} target World is invalid.`;
      const failureFingerprint = `${message}\n${workspaceHash}`;
      if (!input.editor.repair || attempt >= maxAttempts || failureFingerprint === previousFailureFingerprint) {
        if (error instanceof CliErrorV1 && error.code !== 'VALIDATION_FAILED') throw error;
        throw cliErrorV1('VALIDATION_FAILED', message);
      }
      previousFailureFingerprint = failureFingerprint;
      try {
        await input.editor.repair({
          command: input.command,
          workspaceRoot: input.workspaceRoot,
          draft: input.draft,
          baseCommitId: input.baseCommitId,
          targetControl: input.targetControl,
          llmConfigPath: input.llmConfigPath,
          attempt: attempt + 1,
          maxAttempts,
          diagnostics: Object.freeze([{ code: 'WORLD_VALIDATION_FAILED', message }]),
        });
      } catch (repairError) {
        if (repairError instanceof CliErrorV1) throw repairError;
        throw cliErrorV1('AI_FAILED', repairError instanceof Error ? repairError.message : 'Workspace repair failed.');
      }
    }
  }
}

async function installProfileDescriptorV1(workspaceRoot: string): Promise<void> {
  const target = path.join(workspaceRoot, 'profile', 'dayloom.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, '{"schemaVersion":1,"profile":"dayloom","profileVersion":1}\n', 'utf8');
}

async function validateCommandTargetV1(command: DraftDrivenCommandV1, workspaceRoot: string, control: WorldControlV1): Promise<void> {
  if (command === 'init') return;
  if (command === 'plan') {
    if (control.day === null) throw new Error('plan target day is missing.');
    await requiredFileV1(workspaceRoot, `days/${control.day}/plan.json`);
    return;
  }
  if (command === 'play') {
    if (control.day === null) throw new Error('play day is missing.');
    await requiredFileV1(workspaceRoot, `days/${control.day}/play-index.json`);
    await requiredFileV1(workspaceRoot, `days/${control.day}/events/index.yaml`);
  }
}

async function requiredFileV1(root: string, documentPath: string): Promise<void> {
  try { await readFile(path.join(root, ...documentPath.split('/'))); }
  catch { throw new Error(`Required World document is missing: ${documentPath}.`); }
}
