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
import { ARCHIVE_FILE_TOOLS, DRAFT_READ_TOOLS, DRAFT_WRITE_TOOLS, startSessionFileRuntimeV1 } from '../promptpile/session-file-runtime';
import { materializeArchiveView } from '../world/archive-view';
import type { PublishedWorld } from '../world/read';
import type { CoreSessionKind } from '../state';
import { forkConversationAttemptV1, prepareConversationRevisionV1, validateConversationPromotionV1 } from './conversation-revision';
import { SESSION_FILE_LIMITS } from './file-limits';
import { anchorAcceptedUserIntentV2, materializeMarkdownDraftSnapshotV2, renderEvidenceBlockV1, technicalCheckMarkdownDraftV2, type MarkdownDraftSnapshotV2 } from './markdown-draft-snapshot';
import { buildDayloomCheckPrompt } from './prompts/check';
import { buildDayloomObservePrompt } from './prompts/observe';
import { ARBITER_CHECK_V2, ARBITER_FINAL_V2, ARBITER_OBSERVE_V2, CURATOR_FINAL_V2, CURATOR_THOUGHT_V2, RESPONSE_CHECK_V2, RESPONSE_FINAL_V2, RESPONSE_OBSERVE_V2, buildArbiterThoughtV2, buildResponseThoughtV2 } from './prompts/turn-v2';
import type { ProducedCurationV1, ProducedResponseV1 } from './turn-coordinator';
import { parseTurnVerdictV1, type TurnVerdictV1 } from './control-protocol';
import { createSealedControlOperationV1 } from './sealed-control-operation';

interface TurnAgentInputV2 {
  worldRoot: string;
  operationRoot: string;
  slotRoot: string;
  persistentSessionRoot: string;
  sessionId: string;
  sessionKind: CoreSessionKind;
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
      const config = await this.reactConfig(root, `${buildResponseThoughtV2(this.input.sessionKind)}${repairConstraint ? `\n\nRepair constraint: ${repairConstraint}` : ''}`, RESPONSE_FINAL_V2, runtime.binding, RESPONSE_OBSERVE_V2, RESPONSE_CHECK_V2);
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
          workRoot: path.join(root, 'react-work'),
          observer: this.input.observer?.(operationId),
          onChild: this.input.onChild,
          assertBeforeFinal: (work) => runtime.assertReadyForFinal(work),
          timeoutMs: SESSION_FILE_LIMITS.responseTimeoutMs,
        }),
      });
      await validateConversationPromotionV1({ baseRoot: this.input.baseConversationRoot, attemptRoot: conversation, userText: this.input.userInput, finalText: final });
      return { generationId, operationId, responseText: final, stagedConversationRoot: conversation };
    } finally {
      await runtime.close();
    }
  }

  async arbitrate(operationId: string, response: ProducedResponseV1, attempt: 1 | 2): Promise<{ operationId: string; verdict: TurnVerdictV1 }> {
    const root = path.join(this.input.operationRoot, `arbitration-${attempt}`);
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    const control = await createSealedControlOperationV1({ root, mode: 'turn-verdict', serverId: 'turn_control', toolName: 'turn_verdict', context: {}, serverScript: path.join(__dirname, '../promptpile/operation-control-server.js'), parse: parseTurnVerdictV1 });
    const runtime = await this.fileRuntime(root, this.input.baseSnapshot.root, false, control.server, control);
    try {
      const config = await this.reactConfig(root, buildArbiterThoughtV2(this.input.sessionKind), ARBITER_FINAL_V2, runtime.binding, ARBITER_OBSERVE_V2, ARBITER_CHECK_V2);
      const conversation = path.join(root, 'conversation');
      await mkdir(conversation);
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, `[TURN]\n${this.input.userInput}\n\n[RESPONSE CANDIDATE]\n${response.responseText}`, this.input.onChild);
      await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context: path.join(root, 'context'), conversation, workRoot: path.join(root, 'react-work'), observer: this.input.observer?.(operationId), onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.arbitrationTimeoutMs });
      return { operationId, verdict: await control.finish() };
    } finally {
      await runtime.close();
    }
  }

  async prepareConversation(response: ProducedResponseV1) {
    return prepareConversationRevisionV1({ sessionRoot: this.input.persistentSessionRoot, conversationId: `conv_${randomUUID().replaceAll('-', '')}`, source: response.stagedConversationRoot });
  }

  async discardResponse(response: ProducedResponseV1): Promise<void> {
    await rm(path.dirname(response.stagedConversationRoot), { recursive: true, force: true });
  }

  async curate(operationId: string, request: { turnId: string; accepted: ProducedResponseV1; baseDraftHash: string; attempt: 1 | 2 }): Promise<ProducedCurationV1> {
    const root = path.join(this.input.operationRoot, `curation-${request.attempt}`);
    const staging = path.join(root, 'draft');
    await rm(root, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const baseBrief = await readFile(path.join(this.input.baseSnapshot.root, 'brief.md'));
    await writeFile(path.join(staging, 'brief.md'), anchorAcceptedUserIntentV2(baseBrief, this.input.userInput));
    await cp(path.join(this.input.baseSnapshot.root, 'evidence.md'), path.join(staging, 'evidence.md'));
    const runtime = await this.fileRuntime(root, staging, true);
    try {
      const config = await this.reactConfig(root, CURATOR_THOUGHT_V2, CURATOR_FINAL_V2, runtime.binding);
      const conversation = path.join(root, 'conversation');
      await mkdir(conversation);
      await appendUser(this.input.runner, this.input.boundaries.promptpileBin, conversation, `[USER INPUT]\n${this.input.userInput}\n\n[ACCEPTED RESPONSE]\n${request.accepted.responseText}`, this.input.onChild);
      const note = await runReact({ runner: this.input.runner, reactBin: this.input.boundaries.reactBin, validateProcessPile: this.input.boundaries.validateProcessPile, config, context: path.join(root, 'context'), conversation, workRoot: path.join(root, 'react-work'), observer: this.input.observer?.(operationId), onChild: this.input.onChild, assertBeforeFinal: (work) => runtime.assertReadyForFinal(work), timeoutMs: SESSION_FILE_LIMITS.reviewTimeoutMs });
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

  private async fileRuntime(root: string, draftRoot: string, writable: boolean, controlServer?: import('../promptpile/session-file-runtime').SessionFileServerV1, finalGate?: { assertReadyForFinal(workPath: string): void }) {
    const archiveRoot = this.input.world ? (await materializeArchiveView({ worldRoot: this.input.worldRoot, sessionRoot: root, world: this.input.world })).root : null;
    return startSessionFileRuntimeV1({ runtimeRoot: path.join(root, 'file-runtime'), promptpileMcpBin: this.input.boundaries.promptpileMcpBin, filesystemMcp: this.input.boundaries.filesystemMcp, runner: this.input.runner, servers: [...(archiveRoot ? [{ id: 'archive' as const, root: archiveRoot, writable: false, tools: ARCHIVE_FILE_TOOLS }] : []), { id: 'draft' as const, root: draftRoot, writable, tools: writable ? DRAFT_WRITE_TOOLS : DRAFT_READ_TOOLS }, ...(controlServer ? [controlServer] : [])], workspaces: [{ serverId: 'draft', root: draftRoot, writeAllowed: writable, writePaths: writable ? ['brief.md'] : [], maxFiles: 2, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 }], finalGates: finalGate ? [finalGate] : [], maxToolCallsPerThought: SESSION_FILE_LIMITS.conversationMaxToolCallsPerThought, maxToolResultLineBytes: SESSION_FILE_LIMITS.maxToolResultLineBytes });
  }

  private async reactConfig(root: string, thoughtText: string, finalText: string, binding: { toolsFile: string; afterHookPath: string }, observeText = buildDayloomObservePrompt(true), checkText = buildDayloomCheckPrompt(true)) {
    const context = path.join(root, 'context');
    const react = path.join(root, 'react');
    await Promise.all([mkdir(context, { recursive: true }), mkdir(react, { recursive: true })]);
    const thought = path.join(react, 'thought.md');
    const observe = path.join(react, 'observe.md');
    const check = path.join(react, 'check.md');
    const final = path.join(react, 'final.md');
    const config = path.join(react, 'config.toml');
    await Promise.all([writeFile(thought, thoughtText), writeFile(observe, observeText), writeFile(check, checkText), writeFile(final, finalText)]);
    await writeReactConfig(this.input.config, { thoughtPrompt: thought, observePrompt: observe, checkPrompt: check, toolsFile: binding.toolsFile, afterHookPath: binding.afterHookPath, finalPrompt: final, config });
    return config;
  }
}
