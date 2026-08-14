import type { RuntimeMessage } from '@dayloom/core';

export type TuiMessageRole = RuntimeMessage['role'] | 'warn';

export interface TuiMessage {
  id: string;
  role: TuiMessageRole;
  text: string;
}

export function runtimeMessageToTui(message: RuntimeMessage): TuiMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
  };
}

export function createLocalMessage(
  role: TuiMessageRole,
  text: string,
  id: string,
): TuiMessage {
  return {
    id,
    role,
    text: normalizeText(text),
  };
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

