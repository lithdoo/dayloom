import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import type { CallerLlmConfigV1 } from '@dayloom/cli';
import {
  appendConversationUserV1,
  readLlmConfigV1,
  resolvePromptpileBoundariesV1,
  startFileRuntimeV1,
  writeDerivedReactConfigV1,
  type FileRuntimeBindingV1,
  type FileRuntimeV1,
  type ProcessResultV1,
  type PromptpileBoundariesV1,
} from '@dayloom/draft';
import { parseAssistantArgvV1, type AssistantCommandV1 } from './argv.js';
import { resolveAssistantAuthorityV1 } from './authority.js';
import { resolveAssistantCommandV1 } from './command.js';
import { helpTextV1, packageVersionV1 } from './help.js';
import {
  dialogueCheckPromptV1,
  dialogueFinalPromptV1,
  dialogueObservePromptV1,
  dialogueThoughtPromptV1,
  syncCheckPromptV1,
  syncFinalPromptV1,
  syncObservePromptV1,
  syncThoughtPromptV1,
} from './prompts.js';
import { runDialogueReactV1, runSyncReactV1 } from './react.js';
import { materializeWorldViewV1 } from './world-view.js';

type RuntimeInputV1 = Parameters<typeof startFileRuntimeV1>[0];
type AppendInputV1 = Parameters<typeof appendConversationUserV1>[0];
type DialogueInputV1 = Parameters<typeof runDialogueReactV1>[0];
type SyncInputV1 = Parameters<typeof runSyncReactV1>[0];

export interface DraftAssistantDependenciesV1 {
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
  reactBin?: string;
  resolveBoundaries?: () => Promise<PromptpileBoundariesV1>;
  startRuntime?: (input: RuntimeInputV1) => Promise<FileRuntimeV1>;
  appendUser?: (input: AppendInputV1) => Promise<void>;
  runDialogue?: (input: DialogueInputV1) => Promise<number>;
  runSync?: (input: SyncInputV1) => Promise<ProcessResultV1>;
  materializeWorldView?: typeof materializeWorldViewV1;
}

export interface DraftAssistantRunResultV1 {
  exitCode: number;
  startedDialogue: boolean;
  startedSync: boolean;
  command: AssistantCommandV1 | null;
}

export async function executeDraftAssistantV1(
  argv: readonly string[],
  dependencies: DraftAssistantDependenciesV1 = {},
): Promise<DraftAssistantRunResultV1> {
  const parsed = parseAssistantArgvV1(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (parsed.mode === 'help') {
    stdout.write(helpTextV1());
    return { exitCode: 0, startedDialogue: false, startedSync: false, command: null };
  }
  if (parsed.mode === 'version') {
    stdout.write(`${packageVersionV1()}\n`);
    return { exitCode: 0, startedDialogue: false, startedSync: false, command: null };
  }

  const cwd = dependencies.cwd ?? process.cwd();
  const resolved = await resolveAssistantCommandV1({ cwd, world: parsed.world, explicit: parsed.command });
  const authority = await resolveAssistantAuthorityV1({
    cwd,
    worldRoot: resolved.worldRoot,
    drafts: parsed.drafts,
    draftDir: parsed.draftDir,
    conversation: parsed.conversation,
    llmConfig: parsed.llmConfig,
  });
  const operationRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-assistant-'));
  let startedDialogue = false;
  let startedSync = false;

  try {
    const worldViewRoot = authority.archiveRoot === null
      ? null
      : await (dependencies.materializeWorldView ?? materializeWorldViewV1)({
        archiveRoot: authority.archiveRoot,
        head: resolved.head!,
        operationRoot,
      });
    const boundaries = await (dependencies.resolveBoundaries?.() ?? resolvePromptpileBoundariesV1());
    const caller = await readLlmConfigV1(authority.llmConfig);
    const reactBin = dependencies.reactBin ?? boundaries.reactBin;

    const dialogueRoot = path.join(operationRoot, 'dialogue');
    await mkdir(dialogueRoot, { recursive: true });
    const dialogueRuntime = worldViewRoot === null ? null : await (dependencies.startRuntime ?? startFileRuntimeV1)({
      runtimeRoot: path.join(dialogueRoot, 'runtime'),
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      worldRoot: worldViewRoot,
      draft: null,
    });

    let dialogueCode: number;
    try {
      await writeReactSidecarsV1({
        root: dialogueRoot,
        caller,
        prompts: {
          thought: dialogueThoughtPromptV1(resolved.command, worldViewRoot !== null),
          observe: dialogueObservePromptV1(resolved.command),
          check: dialogueCheckPromptV1(),
          final: dialogueFinalPromptV1(),
        },
        binding: dialogueRuntime?.binding ?? null,
      });
      await (dependencies.appendUser ?? appendConversationUserV1)({
        promptpileBin: boundaries.promptpileBin,
        directory: authority.conversation.canonical,
        message: parsed.message,
      });
      startedDialogue = true;
      dialogueCode = await (dependencies.runDialogue ?? runDialogueReactV1)({
        reactBin,
        config: path.join(dialogueRoot, 'config.toml'),
        conversation: authority.conversation.canonical,
        workRoot: path.join(dialogueRoot, 'work'),
        outputFormat: parsed.outputFormat,
        stdout,
        stderr,
      });
    } finally {
      await dialogueRuntime?.close();
    }

    if (dialogueCode !== 0) {
      return { exitCode: dialogueCode, startedDialogue, startedSync, command: resolved.command };
    }

    const syncRoot = path.join(operationRoot, 'sync');
    await mkdir(syncRoot, { recursive: true });
    const syncRuntime = await (dependencies.startRuntime ?? startFileRuntimeV1)({
      runtimeRoot: path.join(syncRoot, 'runtime'),
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      worldRoot: null,
      draft: authority.draft,
    });
    try {
      await writeReactSidecarsV1({
        root: syncRoot,
        caller,
        prompts: {
          thought: syncThoughtPromptV1(resolved.command),
          observe: syncObservePromptV1(resolved.command),
          check: syncCheckPromptV1(),
          final: syncFinalPromptV1(),
        },
        binding: syncRuntime.binding,
      });
      startedSync = true;
      const sync = await (dependencies.runSync ?? runSyncReactV1)({
        reactBin,
        config: path.join(syncRoot, 'config.toml'),
        conversation: authority.conversation.canonical,
        workRoot: path.join(syncRoot, 'work'),
      });
      if (sync.code !== 0) {
        const diagnostic = sync.stderr.trim();
        if (diagnostic !== '') stderr.write(`${diagnostic}\n`);
        return { exitCode: sync.code ?? 1, startedDialogue, startedSync, command: resolved.command };
      }
      return { exitCode: 0, startedDialogue, startedSync, command: resolved.command };
    } finally {
      await syncRuntime.close();
    }
  } finally {
    await removeOperationRootV1(operationRoot);
  }
}

async function removeOperationRootV1(operationRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(operationRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '') || attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function writeReactSidecarsV1(input: {
  root: string;
  caller: CallerLlmConfigV1;
  prompts: { thought: string; observe: string; check: string; final: string };
  binding: FileRuntimeBindingV1 | null;
}): Promise<void> {
  const thought = path.join(input.root, 'thought.md');
  const observe = path.join(input.root, 'observe.md');
  const check = path.join(input.root, 'check.md');
  const final = path.join(input.root, 'final.md');
  const emptyTools = path.join(input.root, 'tools.toml');
  await Promise.all([
    writeFile(thought, input.prompts.thought, 'utf8'),
    writeFile(observe, input.prompts.observe, 'utf8'),
    writeFile(check, input.prompts.check, 'utf8'),
    writeFile(final, input.prompts.final, 'utf8'),
    ...(input.binding === null ? [writeFile(emptyTools, 'tools = []\n', 'utf8')] : []),
  ]);
  await writeDerivedReactConfigV1({
    caller: input.caller,
    target: path.join(input.root, 'config.toml'),
    thoughtPrompt: thought,
    observePrompt: observe,
    checkPrompt: check,
    finalPrompt: final,
    toolBinding: input.binding === null
      ? { toolsFile: emptyTools, afterHookPath: null }
      : { toolsFile: input.binding.toolsFile, afterHookPath: input.binding.afterHookPath },
  });
}
