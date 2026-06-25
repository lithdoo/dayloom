import type { SessionCommandSpec } from './types';

export function formatAvailableCommands<T extends string>(
  specs: Array<SessionCommandSpec<T>>,
  label = 'Available commands'
): string {
  return `${label}: ${specs.map(spec => `/${spec.name}`).join(' ')}\n`;
}

export function formatCommandHelp<T extends string>(
  specs: Array<SessionCommandSpec<T>>
): string {
  return specs.map(spec => `/${spec.name}  ${spec.summary}`).join('\n') + '\n';
}

export function formatUnknownCommand(raw: string): string {
  return `Unknown command: ${raw}\nType /help to see commands available in this session.\n`;
}
