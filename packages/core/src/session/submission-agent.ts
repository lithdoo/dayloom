import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { CallerConfig } from '../promptpile/config';
import { writeReactConfig } from '../promptpile/config';
import type { PackagedBoundaries } from '../promptpile/binaries';
import { appendUser, type ProcessRunner } from '../promptpile/conversation';
import { runReact, type ReactProcessObserver } from '../promptpile/react-runner';
import { startSessionFileRuntimeV1, ARCHIVE_FILE_TOOLS, CANDIDATE_FILE_TOOLS, DRAFT_FILE_TOOLS } from '../promptpile/session-file-runtime';
import { materializeArchiveView } from '../world/archive-view';
import { SESSION_FILE_LIMITS } from './file-limits';
import type { SubmissionConverterV1, SubmissionConversionInputV1, SubmissionReviewerV1, SubmissionReviewV1 } from './submission-pipeline';
import type { ValidationIssueV1 } from './diagnostics';
import { CONVERSION_CHECK_PROMPT, CONVERSION_FINAL_PROMPT, CONVERSION_OBSERVE_PROMPT, CONVERSION_THOUGHT_PROMPT } from './prompts/conversion/common';
import { INIT_CONVERSION_CONTRACT } from './prompts/conversion/init';
import { PLANNING_CONVERSION_CONTRACT } from './prompts/conversion/planning';
import { PLAY_CONVERSION_CONTRACT } from './prompts/conversion/play';
import { REVISE_CONVERSION_CONTRACT } from './prompts/conversion/revise';
import { REPAIR_PROMPT } from './prompts/repair';
import { REVIEW_PROMPT } from './prompts/review';

export class AiSubmissionConverterV1 implements SubmissionConverterV1 {
  constructor(private readonly input: {
    worldRoot: string; config: CallerConfig; boundaries: PackagedBoundaries; runner: ProcessRunner;
    onChild?: (child: ChildProcess) => void; observer?: ReactProcessObserver;
  }) {}

  async run(request: SubmissionConversionInputV1): Promise<void> {
    const phaseRoot = path.join(request.session.root, 'submission', `${request.phase}-${request.attempt}`), candidateParent = path.dirname(request.candidateRoot);
    const context = path.join(phaseRoot, 'context'), conversation = path.join(phaseRoot, 'conversation'), react = path.join(phaseRoot, 'react'), runtimeRoot = path.join(phaseRoot, 'file-runtime');
    await rm(phaseRoot, { recursive: true, force: true }); await Promise.all([mkdir(context, { recursive: true }), mkdir(conversation, { recursive: true }), mkdir(react, { recursive: true }), mkdir(candidateParent, { recursive: true })]);
    await writeFile(path.join(candidateParent, 'task.json'), `${JSON.stringify({ schemaVersion: 1, kind: request.session.kind, targetDay: request.session.day, assignment: request.assignment, diagnostics: request.diagnostics }, null, 2)}\n`, 'utf8');
    let archiveRoot: string | null = null;
    if (request.session.pinned) archiveRoot = (await materializeArchiveView({ worldRoot: this.input.worldRoot, sessionRoot: phaseRoot, world: request.session.pinned })).root;
    const workspaces = [
      { serverId: 'draft' as const, root: request.draft.root, writeAllowed: false, maxFiles: SESSION_FILE_LIMITS.draftMaxFiles, maxFileBytes: SESSION_FILE_LIMITS.draftMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.draftMaxTotalBytes },
      { serverId: 'candidate' as const, root: candidateParent, writePrefix: 'files/', maxFiles: SESSION_FILE_LIMITS.candidateMaxFiles + 1, maxFileBytes: SESSION_FILE_LIMITS.candidateMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.candidateMaxTotalBytes + SESSION_FILE_LIMITS.candidateMaxFileBytes },
    ];
    const servers = [
      ...(archiveRoot ? [{ id: 'archive' as const, root: archiveRoot, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []),
      { id: 'draft' as const, root: request.draft.root, writable: true, tools: DRAFT_FILE_TOOLS },
      { id: 'candidate' as const, root: candidateParent, writable: true, tools: CANDIDATE_FILE_TOOLS },
    ];
    const runtime = await startSessionFileRuntimeV1({ runtimeRoot, promptpileMcpBin: this.input.boundaries.promptpileMcpBin, filesystemMcp: this.input.boundaries.filesystemMcp, runner: this.input.runner, servers, workspaces, maxToolCallsPerThought: request.phase === 'convert' ? SESSION_FILE_LIMITS.conversionMaxToolCallsPerThought : SESSION_FILE_LIMITS.repairMaxToolCallsPerThought, maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes });
    try {
      const thought = path.join(react, 'thought.md'), observe = path.join(react, 'observe.md'), check = path.join(react, 'check.md'), final = path.join(react, 'final.md'), config = path.join(react, 'config.toml');
      await Promise.all([writeFile(thought, `${CONVERSION_THOUGHT_PROMPT}\n\n${contract(request.session.kind)}\n${request.phase === 'repair' ? `\n${REPAIR_PROMPT}` : ''}\n`, 'utf8'), writeFile(observe, CONVERSION_OBSERVE_PROMPT, 'utf8'), writeFile(check, CONVERSION_CHECK_PROMPT, 'utf8'), writeFile(final, CONVERSION_FINAL_PROMPT, 'utf8')]);
      await writeReactConfig(this.input.config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: runtime.binding.toolsFile, afterHookPath: runtime.binding.afterHookPath, finalPrompt: final, config });
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, taskMessage(request), this.input.onChild);
      await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context, conversation, observer: this.input.observer, onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: request.phase === 'convert' ? SESSION_FILE_LIMITS.conversionTimeoutMs : SESSION_FILE_LIMITS.repairTimeoutMs });
    } finally { await runtime.close(); }
  }
}

export class AiSubmissionReviewerV1 implements SubmissionReviewerV1 {
  constructor(private readonly input: { worldRoot: string; config: CallerConfig; boundaries: PackagedBoundaries; runner: ProcessRunner; onChild?: (child: ChildProcess) => void; observer?: ReactProcessObserver }) {}
  async review(request: Omit<SubmissionConversionInputV1, 'phase' | 'attempt' | 'diagnostics'>): Promise<SubmissionReviewV1> {
    const root = path.join(request.session.root, 'submission', 'review'), candidateParent = path.dirname(request.candidateRoot), context = path.join(root, 'context'), conversation = path.join(root, 'conversation'), react = path.join(root, 'react');
    await rm(root, { recursive: true, force: true }); await Promise.all([mkdir(context, { recursive: true }), mkdir(conversation, { recursive: true }), mkdir(react, { recursive: true })]);
    let archiveRoot: string | null = null; if (request.session.pinned) archiveRoot = (await materializeArchiveView({ worldRoot: this.input.worldRoot, sessionRoot: root, world: request.session.pinned })).root;
    const workspaces = [{ serverId: 'draft' as const, root: request.draft.root, writeAllowed: false, maxFiles: SESSION_FILE_LIMITS.draftMaxFiles, maxFileBytes: SESSION_FILE_LIMITS.draftMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.draftMaxTotalBytes }, { serverId: 'candidate' as const, root: candidateParent, writeAllowed: false, maxFiles: SESSION_FILE_LIMITS.candidateMaxFiles + 1, maxFileBytes: SESSION_FILE_LIMITS.candidateMaxFileBytes, maxTotalBytes: SESSION_FILE_LIMITS.candidateMaxTotalBytes + SESSION_FILE_LIMITS.candidateMaxFileBytes }];
    const servers = [...(archiveRoot ? [{ id: 'archive' as const, root: archiveRoot, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []), { id: 'draft' as const, root: request.draft.root, writable: true, tools: DRAFT_FILE_TOOLS }, { id: 'candidate' as const, root: candidateParent, writable: true, tools: CANDIDATE_FILE_TOOLS }];
    const runtime = await startSessionFileRuntimeV1({ runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.input.boundaries.promptpileMcpBin, filesystemMcp: this.input.boundaries.filesystemMcp, runner: this.input.runner, servers, workspaces, maxToolCallsPerThought: SESSION_FILE_LIMITS.repairMaxToolCallsPerThought, maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes });
    try {
      const thought = path.join(react, 'thought.md'), observe = path.join(react, 'observe.md'), check = path.join(react, 'check.md'), finalPrompt = path.join(react, 'final.md'), config = path.join(react, 'config.toml');
      await Promise.all([writeFile(thought, `${REVIEW_PROMPT}\n先使用只读工具收集证据；禁止调用 write_file。`, 'utf8'), writeFile(observe, CONVERSION_OBSERVE_PROMPT, 'utf8'), writeFile(check, CONVERSION_CHECK_PROMPT, 'utf8'), writeFile(finalPrompt, REVIEW_PROMPT, 'utf8')]);
      await writeReactConfig(this.input.config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: runtime.binding.toolsFile, afterHookPath: runtime.binding.afterHookPath, finalPrompt, config });
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, `[DAYLOOM_REVIEW_TASK_V1]\n审查 ${request.session.kind} Candidate。task.json 包含 assignment；Candidate 文件位于 files/。`, this.input.onChild);
      const final = await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context, conversation, observer: this.input.observer, onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.reviewTimeoutMs });
      const raw = parseReview(final), advisory = raw.advisory.map((item): ValidationIssueV1 => ({ schemaVersion: 1, stage: 'review', severity: 'advisory', code: item.code, path: item.paths[0] ?? null, constraint: item.reason, actual: item.evidence }));
      return Object.freeze({ raw, advisory: Object.freeze(advisory) });
    } finally { await runtime.close(); }
  }
}

function contract(kind: SubmissionConversionInputV1['session']['kind']): string { return kind === 'init' ? INIT_CONVERSION_CONTRACT : kind === 'planning' ? PLANNING_CONVERSION_CONTRACT : kind === 'play' ? PLAY_CONVERSION_CONTRACT : REVISE_CONVERSION_CONTRACT; }
function taskMessage(input: SubmissionConversionInputV1): string { return `[DAYLOOM_${input.phase === 'convert' ? 'CONVERT' : 'REPAIR'}_TASK_V1]\nSession: ${input.session.kind}\n目标日: ${input.session.day ?? '<none>'}\nDraft 根目录工具: mcp__draft__*\n任务与 assignment: mcp__candidate__read_file_lines path=task.json\nCandidate 写入路径统一以 files/ 开头。\n${input.diagnostics.length ? `\n结构化 diagnostics:\n${JSON.stringify(input.diagnostics, null, 2)}` : ''}`; }
function parseReview(text: string): { advisory: Array<{ code: string; paths: string[]; reason: string; evidence: string }> } {
  const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || !Array.isArray((value as { advisory?: unknown }).advisory)) throw new Error('Review output is invalid.');
  const advisory = (value as { advisory: unknown[] }).advisory.map((item) => { if (!item || typeof item !== 'object') throw new Error('Review advisory is invalid.'); const row = item as Record<string, unknown>; if (typeof row.code !== 'string' || !Array.isArray(row.paths) || row.paths.some((entry) => typeof entry !== 'string') || typeof row.reason !== 'string' || typeof row.evidence !== 'string') throw new Error('Review advisory is invalid.'); return { code: row.code, paths: row.paths as string[], reason: row.reason, evidence: row.evidence }; });
  return { advisory };
}
