import fs from 'fs';
import path from 'path';
import { DEFAULT_MAX_TOOL_ROUNDS, OPENING_ASSISTANT } from './constants';
import { applyChanges } from './apply-payload';
import { buildUnifiedDiff } from './diff';
import { assertSnapshotsUnchanged, snapshotChanges } from './file-hash';
import { finalizeRevision } from './finalize';
import { assertInitializedWorld, resolveWorldRoot } from './guard';
import { connectOrStartGateway } from './mcp-gateway';
import { assertAllowedWorldRoot, exportReadonlyTools } from './mcp-tools';
import { parseReviseStatus } from './parse-assistant';
import { runPromptpileUntilText } from './promptpile-loop';
import { appendUserMessage, buildTranscript, cleanupSession, createReviseSession, readDraft, writeDraft } from './session';
import { projectRevisePayload } from './project-payload';
import { validateRevisePayload } from './validate-payload';
import type { ReviseOptions } from './types';
import { createTranslator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import { parseShellLevelCommand, type SessionExit, type SessionIO } from '../session-io';

type ReviseCommand = 'help' | 'status' | 'save' | 'cancel' | 'exit';

const REVISE_COMMANDS: Array<SessionCommandSpec<ReviseCommand>> = [
  { name: 'help', summary: 'Show revise commands.', summaryKey: 'commands.help.summary', hintKey: 'commands.help.hint' },
  { name: 'status', aliases: ['pending'], summary: 'Show the current pending revision draft.', summaryKey: 'commands.status.summary', hintKey: 'commands.status.hint' },
  { name: 'save', aliases: ['apply'], summary: 'Finalize and apply the revision.', summaryKey: 'commands.save.summary', hintKey: 'commands.save.hint' },
  { name: 'cancel', summary: 'Cancel the revision session.', summaryKey: 'commands.cancel.summary', hintKey: 'commands.cancel.hint' },
  { name: 'exit', summary: 'Exit and preserve the revision session.', summaryKey: 'commands.exit.summary', hintKey: 'commands.exit.hint' },
];

export type ReviseInteractiveOptions = ReviseOptions & { io: SessionIO };

export async function runReviseInteractive(
  dir: string,
  options: ReviseInteractiveOptions,
): Promise<SessionExit<{ worldRoot: string; description: string; revisionId: string }>> {
  const { io, ...reviseOptions } = options;
  const t = createTranslator();
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not set. Interactive revise requires an API key.');
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  const session = createReviseSession();
  let preserveSession = reviseOptions.keepSession ?? false;
  let gateway: Awaited<ReturnType<typeof connectOrStartGateway>> | undefined;
  const maxToolRounds = reviseOptions.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  try {
    await io.withLoading('正在准备修订会话...', async loading => {
      gateway = await connectOrStartGateway(session.root, worldRoot, reviseOptions.mcpBaseUrl, reviseOptions.mcpToken);
      loading.update('正在准备只读工具...');
      await exportReadonlyTools(gateway.baseUrl, gateway.token, session.toolsFile);
      await assertAllowedWorldRoot(gateway.baseUrl, gateway.token, worldRoot, session.root);
    });
    if (!gateway) throw new Error('Failed to initialize readonly gateway');
    io.write(`\n--- World revision session ---\n\n${OPENING_ASSISTANT}\n`);
    while (true) {
      const input = await io.readInput({
        commandHint: formatAvailableCommands(REVISE_COMMANDS, t),
        instruction: t('input.messageInstruction'),
        userPrompt: t('input.userPrompt'),
        emptyBehavior: 'ask-save-draft',
      });
      if (input === undefined) {
        preserveSession = true;
        io.write(`Revision draft saved in session: ${session.root}\n`);
        return { kind: 'saved', sessionPath: session.root };
      }
      const command = parseSessionCommand(input, REVISE_COMMANDS);
      if (command.kind === 'unknown') {
        const shell = parseShellLevelCommand(input);
        if (shell) return { kind: 'shell-command', command: shell, raw: input };
        io.write(formatUnknownCommand(command.raw, REVISE_COMMANDS, t));
        continue;
      }
      if (command.kind === 'command' && command.name === 'help') {
        io.write(formatCommandHelp(REVISE_COMMANDS, t));
        continue;
      }
      if (command.kind === 'command' && command.name === 'status') {
        io.write(`${JSON.stringify(readDraft(session), null, 2)}\n`);
        continue;
      }
      if (command.kind === 'command' && command.name === 'cancel') {
        io.write('Revision cancelled.\n');
        return { kind: 'cancelled' };
      }
      if (command.kind === 'command' && command.name === 'exit') {
        preserveSession = true;
        io.write(`Revision draft saved in session: ${session.root}\n`);
        return { kind: 'saved', sessionPath: session.root };
      }
      if (command.kind === 'command' && command.name === 'save') {
        const draft = readDraft(session);
        if (!draft.pending_changes.length) {
          io.write('No pending changes.\n');
          continue;
        }
        const payload = await io.withLoading('正在生成修订方案...', () =>
          finalizeRevision(buildTranscript(session.messagesDir), draft, session.toolsFile, gateway!.baseUrl, gateway!.token, maxToolRounds, reviseOptions.keepSession, io));
        validateRevisePayload(payload);
        const changes = projectRevisePayload(payload, worldRoot);
        const diff = buildUnifiedDiff(worldRoot, changes);
        if (!diff) {
          io.write('No file changes produced.\n');
          continue;
        }
        io.write(`\n${diff}\n`);
        if (reviseOptions.dryRun) {
          io.write('Dry run only. No files changed.\n');
          continue;
        }
        const snapshots = snapshotChanges(worldRoot, changes);
        if (!reviseOptions.yes && !await io.confirm('Apply this revision? (Y/N): ')) {
          io.write('Revision not applied.\n');
          continue;
        }
        assertSnapshotsUnchanged(worldRoot, snapshots);
        const revisionId = applyChanges(worldRoot, payload, changes, new Date(), { diff, draft, transcript: buildTranscript(session.messagesDir) });
        io.write(`Applied World revision: ${revisionId}\n`);
        return { kind: 'completed', result: { worldRoot, description: diff, revisionId } };
      }
      appendUserMessage(session.messagesDir, input);
      io.write('\nAI> ');
      const stream = io.createStreamWriter({ hiddenBlocks: ['revise-status'] });
      const reply = await runPromptpileUntilText(session, gateway.baseUrl, gateway.token, maxToolRounds, text => stream.push(text));
      stream.flush();
      try {
        const status = parseReviseStatus(reply);
        if (status) writeDraft(session, status);
      } catch (err) {
        io.warn(`Warning: ${err instanceof Error ? err.message : err}\n`);
      }
      io.write('\n');
    }
  } finally {
    if (gateway) await gateway.stop();
    if (preserveSession) io.warn(`Revise session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}

/** @deprecated Use runReviseInteractive */
export const reviseWorldInteractive = runReviseInteractive;
