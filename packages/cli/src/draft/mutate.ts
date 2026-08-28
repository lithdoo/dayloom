import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildTargetControlV1,
  hashDayloomPatchV1,
  type DayloomCommandV1,
  type WorldControlV1,
} from '@dayloom/archive-protocol';
import type { ParsedInvocationV1 } from '../cli/argv.js';
import { CliErrorV1, cliErrorV1 } from '../cli/errors.js';
import { buildPatchFromTargetTreeV1, changedAfterFilesV1 } from '../patch/build.js';
import { materializeWorkspaceV1, scanWorkspaceV1 } from '../workspace/files.js';
import { validateWorldProfileWorkspaceV1 } from '../world/domain-validator.js';
import { publishV1 } from '../world/publish.js';
import type { PublishedHeadV1 } from '../world/read.js';
import { assertRequestedBaseV1 } from '../commands/base.js';
import { captureDraftInputV1, type CapturedDraftSnapshotV1 } from './snapshot.js';

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
  const targetControl = buildTargetControlV1(command, input.head?.commit.control ?? null);
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), `dayloom-${command}-v1-`));
  try {
    if (input.head !== null) {
      await materializeWorkspaceV1({ worldRoot: input.worldRoot, tree: input.head.tree, workspaceRoot });
    } else {
      await mkdir(workspaceRoot, { recursive: true });
    }

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
    const workspace = await scanWorkspaceV1(workspaceRoot);
    let profile;
    try {
      profile = validateWorldProfileWorkspaceV1(workspace);
      await validateCommandTargetV1(command, workspaceRoot, targetControl);
    } catch (error) {
      if (error instanceof CliErrorV1) throw error;
      throw cliErrorV1('VALIDATION_FAILED', error instanceof Error ? error.message : `${command} target World is invalid.`);
    }

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
    if (input.invocation.dryRun) {
      return {
        mode: 'dry-run',
        baseCommitId: input.head?.commit.id ?? null,
        patchHash: hashDayloomPatchV1(patch),
        changedPaths: patch.changes.length,
        controlChanged: JSON.stringify(patch.control.before) !== JSON.stringify(patch.control.after),
        draftSnapshotHash: draft.hash,
        ...(initialTitle === undefined ? {} : { title: initialTitle }),
      };
    }

    return await publishV1({
      worldRoot: input.worldRoot,
      base: input.head,
      patch,
      targetTree: workspace.tree,
      afterFiles: changedAfterFilesV1(patch, workspace),
      draftSnapshot: { snapshot: draft.snapshot, files: draft.files },
      ...(initialTitle === undefined ? {} : { initialTitle }),
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
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
