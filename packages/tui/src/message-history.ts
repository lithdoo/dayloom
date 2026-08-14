import type { TuiMessage } from './types.js';

export type TuiMessageRole = TuiMessage['role'];
export type { TuiMessage } from './types.js';

export function createLocalMessage(role: TuiMessageRole, text: string, id: string): TuiMessage {
  return { id, role, text: normalizeText(text), status: 'complete' };
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}
