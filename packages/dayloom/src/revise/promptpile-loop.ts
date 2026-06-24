import path from 'path';
import { getPromptpileSpawnConfig } from './bin-resolve';
import { executeReadonlyCalls } from './mcp-tools';
import { getLatestAssistantText, getLatestCallsFile } from './session';
import { runPromptpileWithStream } from '../shared/run-promptpile-with-stream';
import type { ReviseSession } from './types';

export async function runPromptpileUntilText(session: ReviseSession, baseUrl: string, token: string | undefined, maxToolRounds: number, onDelta: (text: string) => void = () => undefined): Promise<string> {
  for (let round = 0; round <= maxToolRounds; round += 1) {
    const spawnConfig = getPromptpileSpawnConfig();
    const result = await runPromptpileWithStream({
      command: spawnConfig.command,
      args: [
        ...spawnConfig.argvPrefix,
        '--config', path.basename(session.promptpileConfig),
        '-d', 'messages',
        '--tools-file', path.basename(session.toolsFile),
        '--continue',
        '--quiet'
      ],
      cwd: session.root,
      quiet: true,
      onDelta
    });
    if (result.error) throw new Error('Failed to run ' + spawnConfig.displayName + ': ' + result.error.message);
    if (result.status !== 0) throw new Error('promptpile exited with code ' + result.status + ': ' + result.stderr.trim().slice(-500));
    const callsFile = getLatestCallsFile(session.messagesDir);
    if (!callsFile) return getLatestAssistantText(session.messagesDir);
    if (round === maxToolRounds) throw new Error('AI exceeded the tool-call limit (' + maxToolRounds + ') for this turn');
    await executeReadonlyCalls(baseUrl, token, callsFile);
  }
  throw new Error('Unexpected promptpile loop exit');
}
