import type { ShellCommand } from './types';

const SHELL_COMMANDS: Record<string, ShellCommand> = {
  '/revise': 'revise',
  '/next': 'next',
  '/quit': 'quit',
};

export function parseShellLevelCommand(input: string): ShellCommand | undefined {
  const normalized = input.trim().split(/\s+/, 1)[0].toLowerCase();
  return SHELL_COMMANDS[normalized];
}
