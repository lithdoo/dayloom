import type { SessionCommandSpec } from './types';
import type { Translator } from '../i18n';

export function formatAvailableCommands<T extends string>(
  specs: Array<SessionCommandSpec<T>>,
  tOrLabel?: Translator | string,
  label?: string
): string {
  const t = typeof tOrLabel === 'function' ? tOrLabel : undefined;
  const prefix = label ?? t?.('commands.available') ?? 'Available commands';
  const resolvedPrefix = typeof tOrLabel === 'string' ? tOrLabel : prefix;
  const separator = t?.('commands.availableSeparator') ?? ': ';
  return `${resolvedPrefix}${separator}${specs.map(spec => formatHintItem(spec, t)).join(', ')}\n`;
}

export function formatCommandHelp<T extends string>(
  specs: Array<SessionCommandSpec<T>>,
  t?: Translator
): string {
  return specs.map(spec => `/${spec.name}  ${formatSummary(spec, t)}`).join('\n') + '\n';
}

export function formatUnknownCommand<T extends string>(raw: string, specs?: Array<SessionCommandSpec<T>>, t?: Translator): string {
  const message = t?.('commands.unknown', { command: raw }) ?? `Unknown command: ${raw}`;
  if (!specs) return `${message}\n${t?.('commands.helpHint') ?? 'Type /help to see commands available in this session.'}\n`;
  return `${message}\n${formatAvailableCommands(specs, t)}`;
}

function formatHintItem<T extends string>(spec: SessionCommandSpec<T>, t?: Translator): string {
  const label = spec.hintKey && t ? t(spec.hintKey) : undefined;
  return label ? `/${spec.name} ${label}` : `/${spec.name}`;
}

function formatSummary<T extends string>(spec: SessionCommandSpec<T>, t?: Translator): string {
  return spec.summaryKey && t ? t(spec.summaryKey) : spec.summary;
}
