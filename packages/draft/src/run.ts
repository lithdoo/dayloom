import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { parseArgvV1, type DraftCommandV1, type ParsedDraftInvocationV1 } from './argv.js';
import { resolveAuthorityV1, type ResolvedAuthorityV1 } from './authority.js';
import { resolvePromptpileBoundariesV1, type PromptpileBoundariesV1 } from './binaries.js';
import { resolveDraftCommandV1 } from './command.js';
import { readLlmConfigV1, writeDerivedReactConfigV1 } from './config.js';
import { appendConversationUserV1 } from './conversation.js';
import { helpTextV1, packageVersionV1 } from './help.js';
import { checkPromptV1, finalPromptV1, observePromptV1, thoughtPromptV1 } from './prompts.js';
import { runPromptpileReactV1 } from './react.js';
import { startFileRuntimeV1 } from './runtime.js';

export interface DraftDependenciesV1 {
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
  reactBin?: string;
  resolveBoundaries?: () => Promise<PromptpileBoundariesV1>;
}

export interface DraftRunResultV1 {
  exitCode: number;
  startedReact: boolean;
  command: DraftCommandV1 | null;
}

export async function executeDraftV1(
  argv: readonly string[],
  dependencies: DraftDependenciesV1 = {},
): Promise<DraftRunResultV1> {
  const parsed = parseArgvV1(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (parsed.mode === 'help') {
    stdout.write(helpTextV1());
    return { exitCode: 0, startedReact: false, command: null };
  }
  if (parsed.mode === 'version') {
    stdout.write(`${packageVersionV1()}\n`);
    return { exitCode: 0, startedReact: false, command: null };
  }
  return runDraftInvocationV1(parsed, dependencies, stdout, stderr);
}

async function runDraftInvocationV1(
  invocation: ParsedDraftInvocationV1,
  dependencies: DraftDependenciesV1,
  stdout: Writable,
  stderr: Writable,
): Promise<DraftRunResultV1> {
  const cwd = dependencies.cwd ?? process.cwd();
  const worldRoot = path.resolve(cwd, invocation.world);
  const resolved = await resolveDraftCommandV1(worldRoot, invocation.command);
  const authority = await resolveAuthorityV1({
    cwd,
    world: invocation.world,
    drafts: invocation.drafts,
    draftDir: invocation.draftDir,
    conversation: invocation.conversation,
    llmConfig: invocation.llmConfig,
  });
  const boundaries = await (dependencies.resolveBoundaries?.() ?? resolvePromptpileBoundariesV1());
  const reactBin = dependencies.reactBin ?? boundaries.reactBin;
  const caller = await readLlmConfigV1(authority.llmConfig);

  const operationRoot = await mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-'));
  let startedReact = false;
  try {
    const reactRoot = path.join(operationRoot, 'react');
    const runtimeRoot = path.join(operationRoot, 'runtime');
    const workRoot = path.join(operationRoot, 'react-work');
    await mkdir(reactRoot, { recursive: true });
    const worldRootForMcp = authority.world.kind === 'directory' ? authority.world.canonical : null;
    const runtime = await startFileRuntimeV1({
      runtimeRoot,
      promptpileMcpBin: boundaries.promptpileMcpBin,
      filesystemMcp: boundaries.filesystemMcp,
      worldRoot: worldRootForMcp,
      draft: authority.draft,
    });
    try {
      await writeReactSidecarsV1(reactRoot, resolved.command, authority, runtime.binding.toolsFile, runtime.binding.afterHookPath, caller);
      await appendConversationUserV1({
        promptpileBin: boundaries.promptpileBin,
        directory: authority.conversation.canonical,
        message: invocation.message,
      });
      startedReact = true;
      const exitCode = await runPromptpileReactV1({
        reactBin,
        config: path.join(reactRoot, 'config.toml'),
        conversation: authority.conversation.canonical,
        workRoot,
        outputFormat: invocation.outputFormat,
        stdout,
        stderr,
      });
      return { exitCode, startedReact, command: resolved.command };
    } finally {
      await runtime.close();
    }
  } finally {
    await rm(operationRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeReactSidecarsV1(
  reactRoot: string,
  command: DraftCommandV1,
  authority: ResolvedAuthorityV1,
  toolsFile: string,
  afterHookPath: string,
  caller: Awaited<ReturnType<typeof readLlmConfigV1>>,
): Promise<void> {
  const thought = path.join(reactRoot, 'thought.md');
  const observe = path.join(reactRoot, 'observe.md');
  const check = path.join(reactRoot, 'check.md');
  const final = path.join(reactRoot, 'final.md');
  await Promise.all([
    writeFile(thought, thoughtPromptV1(command, authority), 'utf8'),
    writeFile(observe, observePromptV1(), 'utf8'),
    writeFile(check, checkPromptV1(), 'utf8'),
    writeFile(final, finalPromptV1(), 'utf8'),
  ]);
  await writeDerivedReactConfigV1({
    caller,
    target: path.join(reactRoot, 'config.toml'),
    thoughtPrompt: thought,
    observePrompt: observe,
    checkPrompt: check,
    finalPrompt: final,
    toolsFile,
    afterHookPath,
  });
}
