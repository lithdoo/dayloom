import type { ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackagedBoundaries } from '../promptpile/binaries';
import type { CallerConfig } from '../promptpile/config';
import { writeReactConfig } from '../promptpile/config';
import { appendUser, type ProcessRunner } from '../promptpile/conversation';
import { runReact, type ReactProcessObserver } from '../promptpile/react-runner';
import { ARCHIVE_FILE_TOOLS, CANDIDATE_FILE_TOOLS, DRAFT_FILE_TOOLS, startSessionFileRuntimeV1, type SessionFileRuntimeV1 } from '../promptpile/session-file-runtime';
import { materializeArchiveView } from '../world/archive-view';
import { readHistoricalAssignmentIdsV1 } from './assignment';
import { SESSION_FILE_LIMITS } from './file-limits';
import { buildDayloomCheckPrompt } from './prompts/check';
import { buildDayloomObservePrompt } from './prompts/observe';
import type { SubmissionConverterV2, SubmissionPlannerV2, SubmissionReviewerV2 } from './submission-pipeline-v2';

interface AgentOptionsV2 {
  worldRoot: string;
  config: CallerConfig;
  boundaries: PackagedBoundaries;
  runner: ProcessRunner;
  onChild?: (child: ChildProcess) => void;
  observer?: ReactProcessObserver;
}

const FINAL = 'Complete the required tool calls, then briefly confirm that the operation artifact was produced. Natural-language Final output is never a structured result.';

export class AiSubmissionPlannerV2 implements SubmissionPlannerV2 {
  constructor(private readonly options: AgentOptionsV2) {}

  async plan(input: Parameters<SubmissionPlannerV2['plan']>[0]) {
    const root = path.join(input.session.root, 'submission-v2', 'plan');
    const resultPath = path.join(root, 'sealed.json');
    const contextPath = path.join(root, 'control.json');
    await reset(root);
    const reservedIds = [...await readHistoricalAssignmentIdsV1(this.options.worldRoot, input.session.pinned)];
    await writeFile(contextPath, `${JSON.stringify({ mode: 'change-plan', resultPath, baseRootTreeHash: input.session.pinned?.commit.rootTreeHash ?? null, reservedIds }, null, 2)}\n`);
    const archive = await archiveRoot(this.options, input.session, root);
    const runtime = await startSessionFileRuntimeV1({
      runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.options.boundaries.promptpileMcpBin,
      filesystemMcp: this.options.boundaries.filesystemMcp, runner: this.options.runner,
      servers: [
        ...(archive ? [{ id: 'archive' as const, root: archive, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []),
        { id: 'draft' as const, root: input.draft.root, writable: false, tools: DRAFT_FILE_TOOLS },
        { id: 'change_plan' as const, root, writable: false, tools: ['declare_change_plan'], command: { command: process.execPath, argsPrefix: [path.join(__dirname, '../promptpile/operation-control-server.js'), contextPath] } },
      ],
      workspaces: [draftPolicy(input.draft.root)], maxToolCallsPerThought: SESSION_FILE_LIMITS.conversionMaxToolCallsPerThought,
      maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes,
    });
    try {
      const thought = 'Read brief.md and only the necessary evidence.md or Published Archive ranges. Include only explicit agreements; proposed and unresolved material must not become changes. Call mcp__change_plan__declare_change_plan exactly once with the complete Change Plan. Never assign persistent IDs yourself.';
      const config = await makeConfig(root, this.options, runtime, thought);
      await execute(root, this.options, runtime, config, `Session kind: ${input.session.kind}\nTarget day: ${input.session.day ?? '<none>'}\nBase Draft hash: ${input.draft.hash}`);
      return JSON.parse(await readFile(resultPath, 'utf8'));
    } finally { await runtime.close(); }
  }
}

export class AiSubmissionConverterV2 implements SubmissionConverterV2 {
  constructor(private readonly options: AgentOptionsV2) {}

  async run(input: Parameters<SubmissionConverterV2['run']>[0]) {
    const root = path.join(input.session.root, 'submission-v2', `${input.phase}-${input.attempt}`);
    const candidateParent = path.dirname(input.candidateRoot);
    await reset(root);
    await mkdir(candidateParent, { recursive: true });
    await writeFile(path.join(candidateParent, 'task.json'), `${JSON.stringify({ schemaVersion: 2, plan: input.plan, assignment: input.assignment, diagnostics: input.diagnostics }, null, 2)}\n`);
    const archive = await archiveRoot(this.options, input.session, root);
    const runtime = await startSessionFileRuntimeV1({
      runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.options.boundaries.promptpileMcpBin,
      filesystemMcp: this.options.boundaries.filesystemMcp, runner: this.options.runner,
      servers: [
        ...(archive ? [{ id: 'archive' as const, root: archive, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []),
        { id: 'draft' as const, root: input.draft.root, writable: false, tools: DRAFT_FILE_TOOLS },
        { id: 'candidate' as const, root: candidateParent, writable: true, tools: CANDIDATE_FILE_TOOLS },
      ],
      workspaces: [draftPolicy(input.draft.root), candidatePolicy(candidateParent, true)],
      maxToolCallsPerThought: input.phase === 'convert' ? SESSION_FILE_LIMITS.conversionMaxToolCallsPerThought : SESSION_FILE_LIMITS.repairMaxToolCallsPerThought,
      maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes,
    });
    try {
      const thought = input.phase === 'convert'
        ? 'The Change Plan is sealed. Read candidate/task.json, the Markdown Draft, and the minimum Archive context required. Materialize only the planned resources under candidate files/ using the assigned IDs; do not expand scope.'
        : 'Repair only the validation diagnostics in candidate/task.json. The sealed Change Plan, assignment, and operation scope are immutable.';
      const config = await makeConfig(root, this.options, runtime, thought);
      await execute(root, this.options, runtime, config, 'Read candidate/task.json and materialize the Candidate workspace.');
    } finally { await runtime.close(); }
  }
}

export class AiSubmissionReviewerV2 implements SubmissionReviewerV2 {
  constructor(private readonly options: AgentOptionsV2) {}

  async review(input: Parameters<SubmissionReviewerV2['review']>[0]) {
    const root = path.join(input.session.root, 'submission-v2', 'review');
    const candidateParent = path.dirname(input.candidateRoot);
    await reset(root);
    const archive = await archiveRoot(this.options, input.session, root);
    const runtime = await startSessionFileRuntimeV1({
      runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.options.boundaries.promptpileMcpBin,
      filesystemMcp: this.options.boundaries.filesystemMcp, runner: this.options.runner,
      servers: [
        ...(archive ? [{ id: 'archive' as const, root: archive, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []),
        { id: 'draft' as const, root: input.draft.root, writable: false, tools: DRAFT_FILE_TOOLS },
        { id: 'candidate' as const, root: candidateParent, writable: false, tools: CANDIDATE_FILE_TOOLS },
      ],
      workspaces: [draftPolicy(input.draft.root), candidatePolicy(candidateParent, false)],
      maxToolCallsPerThought: SESSION_FILE_LIMITS.repairMaxToolCallsPerThought,
      maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes,
    });
    try {
      const thought = 'Read-only review: verify that Candidate files faithfully implement the sealed Change Plan and its evidence. Final must be JSON: {"advisory":[{"code":string,"paths":string[],"reason":string,"evidence":string}]}.';
      const config = await makeConfig(root, this.options, runtime, thought);
      const final = await execute(root, this.options, runtime, config, 'Review the current Candidate without modifying it.');
      const raw = JSON.parse(final);
      if (!raw || !Array.isArray(raw.advisory)) throw new Error('Review output is invalid.');
      return {
        raw,
        advisory: raw.advisory.map((item: any) => ({ schemaVersion: 1 as const, stage: 'review' as const, severity: 'advisory' as const, code: String(item.code), path: Array.isArray(item.paths) ? item.paths[0] ?? null : null, constraint: String(item.reason), actual: String(item.evidence) })),
      };
    } finally { await runtime.close(); }
  }
}

function draftPolicy(root: string) {
  return { serverId: 'draft' as const, root, writeAllowed: false, writePaths: [], maxFiles: 2, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 };
}

function candidatePolicy(root: string, writable: boolean) {
  return { serverId: 'candidate' as const, root, writeAllowed: writable, ...(writable ? { writePrefix: 'files/' } : {}), maxFiles: SESSION_FILE_LIMITS.candidateMaxFiles + 1, maxFileBytes: SESSION_FILE_LIMITS.candidateMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.candidateMaxTotalBytes + SESSION_FILE_LIMITS.candidateMaxFileBytes };
}

async function reset(root: string) {
  await rm(root, { recursive: true, force: true });
  await Promise.all(['context', 'conversation', 'react'].map((name) => mkdir(path.join(root, name), { recursive: true })));
}

async function archiveRoot(options: AgentOptionsV2, session: Parameters<SubmissionPlannerV2['plan']>[0]['session'], root: string) {
  return session.pinned ? (await materializeArchiveView({ worldRoot: options.worldRoot, sessionRoot: root, world: session.pinned })).root : null;
}

async function makeConfig(root: string, options: AgentOptionsV2, runtime: SessionFileRuntimeV1, thoughtText: string) {
  const react = path.join(root, 'react');
  const thought = path.join(react, 'thought.md');
  const observe = path.join(react, 'observe.md');
  const check = path.join(react, 'check.md');
  const final = path.join(react, 'final.md');
  const config = path.join(react, 'config.toml');
  await Promise.all([writeFile(thought, thoughtText), writeFile(observe, buildDayloomObservePrompt(true)), writeFile(check, buildDayloomCheckPrompt(true)), writeFile(final, FINAL)]);
  await writeReactConfig(options.config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: runtime.binding.toolsFile, afterHookPath: runtime.binding.afterHookPath, finalPrompt: final, config });
  return config;
}

async function execute(root: string, options: AgentOptionsV2, runtime: SessionFileRuntimeV1, config: string, task: string) {
  const conversation = path.join(root, 'conversation');
  await appendUser(options.runner, options.boundaries.promptpileBin, conversation, task, options.onChild);
  return runReact({ runner: options.runner, reactBin: options.boundaries.reactBin, validateProcessPile: options.boundaries.validateProcessPile, config, context: path.join(root, 'context'), conversation, observer: options.observer, onChild: options.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.conversionTimeoutMs });
}
