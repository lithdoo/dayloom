export type TuiMessageRole = 'output' | 'warn' | 'error' | 'system' | 'user';

export interface TuiMessage {
  id: string;
  role: TuiMessageRole;
  text: string;
  ts: number;
}

export interface AppendTuiMessageOptions {
  now: number;
  nextId: () => string;
}

export function appendTuiMessage(
  current: readonly TuiMessage[],
  role: TuiMessageRole,
  text: string,
  options: AppendTuiMessageOptions,
): readonly TuiMessage[] {
  const normalized = normalizeMessageText(text);
  if (normalized.trim() === '') return current;

  const last = current.at(-1);
  if (last && canMergeMessage(role) && last.role === role) {
    return [
      ...current.slice(0, -1),
      {
        ...last,
        text: mergeMessageText(last.text, normalized),
        ts: options.now,
      },
    ];
  }

  return [
    ...current,
    {
      id: options.nextId(),
      role,
      text: normalized,
      ts: options.now,
    },
  ];
}

export function normalizeSuggestedActions(actions: readonly string[]): string[] {
  return actions.map((action) => action.trim()).filter((action) => action !== '');
}

export function suggestedActionsKey(actions: readonly string[]): string {
  return normalizeSuggestedActions(actions).join('\n');
}

export function formatSuggestedActions(actions: readonly string[], locale: string): string {
  const normalized = normalizeSuggestedActions(actions);
  const title = locale === 'zh' ? '推荐下一步：' : 'Suggested next steps:';
  return [
    title,
    ...normalized.map((action, index) => `${index + 1}. ${action}`),
  ].join('\n');
}

function normalizeMessageText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

function canMergeMessage(role: TuiMessageRole): boolean {
  return role === 'output' || role === 'warn' || role === 'error';
}

function mergeMessageText(previous: string, next: string): string {
  if (previous.endsWith(' ') || next.startsWith(' ')) {
    return `${previous}${next}`;
  }
  return `${previous}\n${next}`;
}
