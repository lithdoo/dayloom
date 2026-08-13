import type { TuiMessage as DriverMessage } from './types.js';

export type TuiMessageRole = DriverMessage['role'] | 'error' | 'warn';

export interface TuiDisplayMessage {
  id: string;
  role: TuiMessageRole;
  text: string;
}

export function driverMessageToTui(message: DriverMessage): TuiDisplayMessage {
  return {
    id: message.id,
    role: message.status === 'error' && message.role === 'system' ? 'error' : message.role,
    text: message.text,
  };
}

export function createLocalMessage(
  role: TuiMessageRole,
  text: string,
  id: string,
): TuiDisplayMessage {
  return {
    id,
    role,
    text: normalizeText(text),
  };
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

