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
import { askYesNo, readReviseUserInput } from './read-user-input';
import { appendUserMessage, buildTranscript, cleanupSession, createReviseSession, readDraft, writeDraft } from './session';
import { projectRevisePayload } from './project-payload';
import { validateRevisePayload } from './validate-payload';
import type { ReviseOptions } from './types';
import { createFilteredStreamOutput } from '../shared/filtered-stream-output';
import { createTranslator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp, formatUnknownCommand, parseSessionCommand, type SessionCommandSpec } from '../session-commands';
import { withLoading } from '../utils/loading';

type ReviseCommand = 'help' | 'status' | 'save' | 'cancel' | 'exit';

const REVISE_COMMANDS: Array<SessionCommandSpec<ReviseCommand>> = [
  { name: 'help', summary: 'Show revise commands.', summaryKey: 'commands.help.summary', hintKey: 'commands.help.hint' },
  { name: 'status', aliases: ['pending'], summary: 'Show the current pending revision draft.', summaryKey: 'commands.status.summary', hintKey: 'commands.status.hint' },
  { name: 'save', aliases: ['apply'], summary: 'Finalize and apply the revision.', summaryKey: 'commands.save.summary', hintKey: 'commands.save.hint' },
  { name: 'cancel', summary: 'Cancel the revision session.', summaryKey: 'commands.cancel.summary', hintKey: 'commands.cancel.hint' },
  { name: 'exit', summary: 'Exit and preserve the revision session.', summaryKey: 'commands.exit.summary', hintKey: 'commands.exit.hint' },
];

export async function reviseWorldInteractive(dir: string, options: ReviseOptions = {}): Promise<void> {
  const t = createTranslator();
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not set. Interactive revise requires an API key.');
  const worldRoot = resolveWorldRoot(dir);
  assertInitializedWorld(worldRoot);
  const session = createReviseSession();
  let preserveSession = options.keepSession ?? false;
  let gateway: Awaited<ReturnType<typeof connectOrStartGateway>> | undefined;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  try {
    await withLoading('正在准备修订会话...', async loading => {
      gateway = await connectOrStartGateway(session.root, worldRoot, options.mcpBaseUrl, options.mcpToken);
      loading.update('正在准备只读工具...');
      await exportReadonlyTools(gateway.baseUrl, gateway.token, session.toolsFile);
      await assertAllowedWorldRoot(gateway.baseUrl, gateway.token, worldRoot, session.root);
    });
    if (!gateway) throw new Error('Failed to initialize readonly gateway');
    process.stdout.write(`\n--- World revision session ---\n\n${OPENING_ASSISTANT}\n`);
    while (true) {
        const input = await readReviseUserInput({ commandHint: formatAvailableCommands(REVISE_COMMANDS, t), t });
        if (input === undefined) { preserveSession = true; process.stdout.write(`Revision draft saved in session: ${session.root}\n`); return; }
        const command = parseSessionCommand(input, REVISE_COMMANDS);
        if (command.kind === 'unknown') { process.stdout.write(formatUnknownCommand(command.raw, REVISE_COMMANDS, t)); continue; }
        if (command.kind === 'command' && command.name === 'help') { process.stdout.write(formatCommandHelp(REVISE_COMMANDS, t)); continue; }
        if (command.kind === 'command' && command.name === 'status') { process.stdout.write(`${JSON.stringify(readDraft(session), null, 2)}\n`); continue; }
        if (command.kind === 'command' && command.name === 'cancel') { process.stdout.write('Revision cancelled.\n'); return; }
        if (command.kind === 'command' && command.name === 'exit') { preserveSession = true; process.stdout.write(`Revision draft saved in session: ${session.root}\n`); return; }
        if (command.kind === 'command' && command.name === 'save') {
          const draft = readDraft(session);
          if (!draft.pending_changes.length) { process.stdout.write('No pending changes.\n'); continue; }
          const payload = await withLoading('正在生成修订方案...', () =>
            finalizeRevision(buildTranscript(session.messagesDir), draft, session.toolsFile, gateway!.baseUrl, gateway!.token, maxToolRounds, options.keepSession));
          validateRevisePayload(payload);
          const changes = projectRevisePayload(payload, worldRoot);
          const diff = buildUnifiedDiff(worldRoot, changes);
          if (!diff) { process.stdout.write('No file changes produced.\n'); continue; }
          process.stdout.write(`\n${diff}\n`);
          if (options.dryRun) { process.stdout.write('Dry run only. No files changed.\n'); continue; }
          const snapshots = snapshotChanges(worldRoot, changes);
          if (!options.yes && !await askYesNo('Apply this revision? (Y/N): ')) { process.stdout.write('Revision not applied.\n'); continue; }
          assertSnapshotsUnchanged(worldRoot, snapshots);
          const revisionId = applyChanges(worldRoot, payload, changes, new Date(), { diff, draft, transcript: buildTranscript(session.messagesDir) });
          process.stdout.write(`Applied World revision: ${revisionId}\n`);
          return;
        }
        appendUserMessage(session.messagesDir, input);
        process.stdout.write('\nAI> ');
        const stream = createFilteredStreamOutput({ hiddenBlocks: ['revise-status'] });
        const reply = await runPromptpileUntilText(session, gateway.baseUrl, gateway.token, maxToolRounds, text => stream.push(text));
        stream.flush();
        try { const status = parseReviseStatus(reply); if (status) writeDraft(session, status); }
        catch (err) { process.stderr.write(`Warning: ${err instanceof Error ? err.message : err}\n`); }
        process.stdout.write('\n');
      }
  } finally {
    if (gateway) await gateway.stop();
    if (preserveSession) process.stderr.write(`Revise session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}
