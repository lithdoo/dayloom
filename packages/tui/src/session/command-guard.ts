import type { Translator } from '@dayloom/core';
import type { SessionCapability } from './types.js';

type BlockedHubCommand = SessionCapability['blockedHubCommands'][number];

export function guardSessionInput(
  input: string,
  capability: SessionCapability,
  t: Translator,
): string | undefined {
  const token = input.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!token?.startsWith('/')) return undefined;

  const command = token.slice(1);
  if (!isBlockedHubCommand(command, capability.blockedHubCommands)) return undefined;

  return t('commands.unknown', { command: token })
    + '\n'
    + '当前正在会话中。请先输入 /exit 返回指令页，再选择状态、帮助或其它操作。';
}

function isBlockedHubCommand(
  command: string,
  blockedCommands: readonly BlockedHubCommand[],
): command is BlockedHubCommand {
  return blockedCommands.includes(command as BlockedHubCommand);
}
