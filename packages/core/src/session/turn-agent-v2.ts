import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackagedBoundaries } from '../promptpile/binaries';
import type { CallerConfig } from '../promptpile/config';
import { writeReactConfig } from '../promptpile/config';
import { runCompressedCompletion } from '../promptpile/compression';
import { appendUser, type ProcessRunner } from '../promptpile/conversation';
import { runReact, type ReactProcessObserver } from '../promptpile/react-runner';
import { ARCHIVE_FILE_TOOLS, DRAFT_FILE_TOOLS, startSessionFileRuntimeV1 } from '../promptpile/session-file-runtime';
import { materializeArchiveView } from '../world/archive-view';
import type { PublishedWorld } from '../world/read';
import { forkConversationAttemptV1, materializeConversationRevisionV1, validateConversationPromotionV1 } from './conversation-revision';
import { SESSION_FILE_LIMITS } from './file-limits';
import { materializeMarkdownDraftSnapshotV2, renderEvidenceBlockV1, technicalCheckMarkdownDraftV2, type MarkdownDraftSnapshotV2 } from './markdown-draft-snapshot';
import { buildDayloomCheckPrompt } from './prompts/check';
import { buildDayloomObservePrompt } from './prompts/observe';
import { ARBITER_FINAL_V2, ARBITER_THOUGHT_V2, CURATOR_FINAL_V2, CURATOR_THOUGHT_V2, RESPONSE_FINAL_V2, RESPONSE_THOUGHT_V2 } from './prompts/turn-v2';
import type { ProducedCurationV1, ProducedResponseV1 } from './turn-coordinator';
import type { TurnVerdictV1 } from './turn-record';

interface TurnAgentInputV2 {
  worldRoot: string;
  operationRoot: string;
  slotRoot: string;
  persistentSessionRoot: string;
  sessionId: string;
  userInput: string;
  baseConversationRoot: string;
  baseSnapshot: Readonly<MarkdownDraftSnapshotV2>;
  world: PublishedWorld | null;
  config: CallerConfig;
  boundaries: PackagedBoundaries;
  runner: ProcessRunner;
  requestsDir: string;
  summaryConfigPath: string;
  summaryPromptPath: string;
  observer?: (operationId: string) => ReactProcessObserver;
  onChild?: (child: ChildProcess) => void;
  onChildEnd?: (child: ChildProcess) => void;
}

export class AiTurnAgentV2 {
  constructor(private readonly input: TurnAgentInputV2) {}

  async generate(operationId: string, attempt: 1 | 2, repairConstraint: string | null): Promise<ProducedResponseV1> {
    const generationId = `generation_${randomUUID().replaceAll('-', '')}`;
    const root = path.join(this.input.operationRoot, `response-${attempt}`);
    const conversation = path.join(root, 'conversation');
    await rm(root, { recursive: true, force: true });
    await forkConversationAttemptV1({ baseRoot: this.input.baseConversationRoot, attemptRoot: conversation });
    await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, this.input.userInput, this.input.onChild);
    const runtime = await this.fileRuntime(root, this.input.baseSnapshot.root, false);
    try {
      const config = await this.reactConfig(root, `${RESPONSE_THOUGHT_V2}${repairConstraint ? `\n\nRepair constraint: ${repairConstraint}` : ''}`, RESPONSE_FINAL_V2, runtime.binding);
      const final = await runCompressedCompletion({
        runner: this.input.runner,
        promptpileBin: this.input.boundaries.promptpileBin,
        requestsDir: this.input.requestsDir,
        summaryConfigPath: this.input.summaryConfigPath,
        summaryPromptPath: this.input.summaryPromptPath,
        conversationDir: conversation,
        onChildStart: (child) => this.input.onChild?.(child),
        onChildEnd: (child) => this.input.onChildEnd?.(child),
        completion: () => runReact({
          runner: this.input.runner,
          reactBin: this.input.boundaries.reactBin,
          validateProcessPile: this.input.boundaries.validateProcessPile,
          config,
          context: path.join(root, 'context'),
          conversation,
          observer: this.input.observer?.(operationId),
          onChild: this.input.onChild,
          assertBeforeFinal: (work) => runtime.assertReadyForFinal(work),
          timeoutMs: SESSION_FILE_LIMITS.responseTimeoutMs,
        }),
      });
      await validateConversationPromotionV1({ baseRoot: this.input.baseConversationRoot, attemptRoot: conversation, userText: this.input.userInput, finalText: final });
      const conversationId = `conv_${randomUUID().replaceAll('-', '')}`;
      await materializeConversationRevisionV1({ sessionRoot: this.input.persistentSessionRoot, conversationId, source: conversation });
      return { generationId, operationId, responseText: final, conversationId };
    } finally {
      await runtime.close();
    }
  }

  async arbitrate(operationId: string, response: ProducedResponseV1, attempt: 1 | 2): Promise<{ operationId: string; verdict: TurnVerdictV1 }> {
    const root = path.join(this.input.operationRoot, `arbitration-${attempt}`);
    const resultPath = path.join(root, 'verdict.json');
    const contextPath = path.join(root, 'control-context.json');
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(contextPath, `${JSON.stringify({ mode: 'turn-verdict', resultPath }, null, 2)}\n`);
    const runtime = await this.fileRuntime(root, this.input.baseSnapshot.root, false, { id: 'turn_control', tool: 'turn_verdict', contextPath });
    try {
      const config = await this.reactConfig(root, ARBITER_THOUGHT_V2, ARBITER_FINAL_V2, runtime.binding);
      const conversation = path.join(root, 'conversation');
      await mkdir(conversation);
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, `[TURN]\n${this.input.userInput}\n\n[RESPONSE CANDIDATE]\n${response.responseText}`, this.input.onChild);
      await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context: path.join(root, 'context'), conversation, observer: this.input.observer?.(operationId), onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.reviewTimeoutMs });
      return { operationId, verdict: JSON.parse(await readFile(resultPath, 'utf8')) as TurnVerdictV1 };
    } finally {
      await runtime.close();
    }
  }

  async curate(operationId: string, request: { turnId: string; accepted: ProducedResponseV1; baseDraftHash: string; attempt: 1 | 2 }): Promise<ProducedCurationV1> {
    const root = path.join(this.input.operationRoot, `curation-${request.attempt}`);
    const staging = path.join(root, 'draft');
    await rm(root, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await cp(path.join(this.input.baseSnapshot.root, 'brief.md'), path.join(staging, 'brief.md'));
    await cp(path.join(this.input.baseSnapshot.root, 'evidence.md'), path.join(staging, 'evidence.md'));
    const runtime = await this.fileRuntime(root, staging, true);
    try {
      const config = await this.reactConfig(root, CURATOR_THOUGHT_V2, CURATOR_FINAL_V2, runtime.binding);
      const conversation = path.join(root, 'conversation');
      await mkdir(conversation);
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, `[USER INPUT]\n${this.input.userInput}\n\n[ACCEPTED RESPONSE]\n${request.accepted.responseText}`, this.input.onChild);
      const note = await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context: path.join(root, 'context'), conversation, observer: this.input.observer?.(operationId), onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.reviewTimeoutMs });
      const block = renderEvidenceBlockV1({ turnId: request.turnId, generationId: request.accepted.generationId, userInput: this.input.userInput, acceptedResponse: request.accepted.responseText, curatorNote: note });
      const brief = await readFile(path.join(staging, 'brief.md'));
      const baseEvidence = await readFile(path.join(this.input.baseSnapshot.root, 'evidence.md'));
      const snapshot = await materializeMarkdownDraftSnapshotV2({ slotRoot: this.input.slotRoot, draftId: this.input.baseSnapshot.draftId, meta: this.input.baseSnapshot.meta, brief, evidence: Buffer.concat([baseEvidence, block]) });
      const checked = await technicalCheckMarkdownDraftV2({ base: this.input.baseSnapshot, candidate: snapshot, expectedEvidenceBlock: block, currentHeadHash: request.baseDraftHash });
      if (!checked.ok) throw new Error(checked.diagnostics.map((item) => item.constraint).join('; '));
      return { operationId, snapshot };
    } finally {
      await runtime.close();
    }
  }

  private async fileRuntime(root: string, draftRoot: string, writable: boolean, control?: { id: 'turn_control'; tool: string; contextPath: string }) {
    const archiveRoot = this.input.world ? (await materializeArchiveView({ worldRoot: this.input.worldRoot, sessionRoot: root, world: this.input.world })).root : null;
    const controlServer = control ? { id: control.id, root, writable: false, tools: [control.tool], command: { command: process.execPath, argsPrefix: [path.join(__dirname, '../promptpile/operation-control-server.js'), control.contextPath] } } : null;
    return startSessionFileRuntimeV1({ runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.input.boundaries.promptpileMcpBin, filesystemMcp: this.input.boundaries.filesystemMcp, runner: this.input.runner, servers: [...(archiveRoot ? [{ id: 'archive' as const, root: archiveRoot, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []), { id: 'draft' as const, root: draftRoot, writable, tools: DRAFT_FILE_TOOLS }, ...(controlServer ? [controlServer] : [])], workspaces: [{ serverId: 'draft', root: draftRoot, writeAllowed: writable, writePaths: writable ? ['brief.md'] : [], maxFiles: 2, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 }], maxToolCallsPerThought: SESSION_FILE_LIMITS.conversationMaxToolCallsPerThought, maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes });
  }

  private async reactConfig(root: string, thoughtText: string, finalText: string, binding: { toolsFile: string; afterHookPath: string }) {
    const context = path.join(root, 'context');
    const react = path.join(root, 'react');
    await Promise.all([mkdir(context, { recursive: true }), mkdir(react, { recursive: true })]);
    const thought = path.join(react, 'thought.md');
    const observe = path.join(react, 'observe.md');
    const check = path.join(react, 'check.md');
    const final = path.join(react, 'final.md');
    const config = path.join(react, 'config.toml');
    await Promise.all([writeFile(thought, thoughtText), writeFile(observe, buildDayloomObservePrompt(true)), writeFile(check, buildDayloomCheckPrompt(true)), writeFile(final, finalText)]);
    await writeReactConfig(this.input.config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: binding.toolsFile, afterHookPath: binding.afterHookPath, finalPrompt: final, config });
    return config;
  }
}
