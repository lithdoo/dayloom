import type { Translator } from '../i18n';
import { formatAvailableCommands, formatCommandHelp } from '../session-commands';
import type { SessionCommandSpec } from '../session-commands';

export type ShellWaitCommand = 'status' | 'help' | 'next' | 'revise' | 'quit';

export const SHELL_WAIT_COMMANDS: Array<SessionCommandSpec<ShellWaitCommand>> = [
  { name: 'status', summary: 'Show World overview and recommended next action.', summaryKey: 'shell.status.summary', hintKey: 'shell.status.hint' },
  { name: 'help', summary: 'Show shell commands.', summaryKey: 'shell.help.summary', hintKey: 'shell.help.hint' },
  { name: 'next', summary: 'Run the recommended action for the current World state.', summaryKey: 'shell.next.summary', hintKey: 'shell.next.hint' },
  { name: 'revise', summary: 'Start a World revision session.', summaryKey: 'shell.revise.summary', hintKey: 'shell.revise.hint' },
  { name: 'quit', summary: 'Exit the game shell.', summaryKey: 'shell.quit.summary', hintKey: 'shell.quit.hint' },
];

export function formatShellCommandHint(t?: Translator): string {
  return formatAvailableCommands(SHELL_WAIT_COMMANDS, t);
}

export function formatShellHelp(t?: Translator): string {
  return formatCommandHelp(SHELL_WAIT_COMMANDS, t);
}

export function formatUnknownShellCommand(raw: string, t?: Translator): string {
  const message = t?.('shell.unknownCommand', { command: raw }) ?? `Unknown shell command: ${raw}`;
  return `${message}\n${formatShellCommandHint(t)}`;
}
