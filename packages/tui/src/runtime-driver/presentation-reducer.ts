import type { CoreEvent } from '@dayloom/core2';
import type { TuiMessage, TuiPresentationItem, TuiWorkingItem } from '../types.js';

export interface PresentationOperation {
  sessionId: string;
  operationId: string | null;
  closed: boolean;
}

export interface PresentationState {
  items: readonly TuiPresentationItem[];
  operation: PresentationOperation | null;
}

const MAX_WORK_TEXT_CHARS = 64_000;

export function reducePresentation(state: PresentationState, event: Exclude<CoreEvent, { type: 'state.changed' }>): PresentationState {
  const operation = state.operation;
  if (!operation || operation.closed || event.sessionId !== operation.sessionId) return state;
  if (operation.operationId !== null && event.operationId !== operation.operationId) return state;

  if (event.type === 'work.started') {
    if (operation.operationId !== null) return state;
    return {
      operation: { ...operation, operationId: event.operationId },
      items: [...state.items, workingItem(event)],
    };
  }
  if (operation.operationId === null) return state;

  const index = state.items.findIndex((item) => isWorking(item) && item.sessionId === event.sessionId && item.operationId === event.operationId);
  if (index < 0) return state;
  const work = state.items[index] as TuiWorkingItem;

  if (event.type === 'work.delta') {
    if (work.status !== 'streaming') return state;
    const appended = appendLimited(work.text, event.text);
    return replace(state, index, { ...work, phase: event.phase, stepIndex: event.stepIndex, text: appended.text, truncated: work.truncated || appended.truncated });
  }
  if (event.type === 'work.completed') {
    if (work.status !== 'streaming' || event.workPath !== work.workPath) return state;
    return replace(state, index, { ...work, phase: null, stepIndex: null, text: '', truncated: false, status: 'completed', workPath: event.workPath, pathStatus: 'live', detail: null });
  }
  if (event.type === 'work.failed') {
    if (work.status !== 'streaming' && work.status !== 'completed') return state;
    return replace(state, index, {
      ...work, phase: null, stepIndex: null, text: '', truncated: false,
      status: event.status, workPath: event.workPath, pathStatus: 'expired', detail: event.status === 'cancelled' ? '工作过程已取消' : safeDetail(event.message),
    }, true);
  }
  if (event.type === 'output.started') {
    if (work.status !== 'completed' || state.items.some((item) => !isWorking(item) && (item.id === event.messageId || item.operationId === event.operationId))) return state;
    const message: TuiMessage = { id: event.messageId, operationId: event.operationId, role: 'assistant', text: '', status: 'streaming' };
    return { ...state, items: [...state.items, message] };
  }
  const messageIndex = state.items.findIndex((item) => !isWorking(item) && item.id === event.messageId);
  if (messageIndex < 0) return state;
  const message = state.items[messageIndex] as TuiMessage;
  if (event.type === 'output.delta') {
    if (message.status !== 'streaming') return state;
    return replace(state, messageIndex, { ...message, text: message.text + event.text });
  }
  if (event.type === 'output.completed') {
    if (message.status !== 'streaming') return state;
    return expireWork(replace(state, messageIndex, { ...message, status: 'complete' }), event.operationId, true);
  }
  if (message.status !== 'streaming') return state;
  const failed = { ...message, text: message.text || safeDetail(event.message), status: 'error' as const };
  return expireWork(replace(state, messageIndex, failed), event.operationId, true);
}

export function closePresentation(state: PresentationState): PresentationState {
  return state.operation ? { ...state, operation: { ...state.operation, closed: true } } : state;
}

export function isWorking(item: TuiPresentationItem): item is TuiWorkingItem { return 'kind' in item && item.kind === 'working'; }

function workingItem(event: Extract<CoreEvent, { type: 'work.started' }>): TuiWorkingItem {
  return {
    kind: 'working', id: `operation:${event.sessionId}:${event.operationId}`, sessionId: event.sessionId, operationId: event.operationId,
    phase: null, stepIndex: null, text: '', truncated: false, status: 'streaming', workPath: event.workPath, pathStatus: 'live', detail: null,
  };
}

function appendLimited(current: string, delta: string): { text: string; truncated: boolean } {
  const combined = current + delta;
  if (combined.length <= MAX_WORK_TEXT_CHARS) return { text: combined, truncated: false };
  return { text: combined.slice(combined.length - MAX_WORK_TEXT_CHARS), truncated: true };
}

function replace(state: PresentationState, index: number, item: TuiPresentationItem, closed = false): PresentationState {
  const items = [...state.items]; items[index] = item;
  return { items, operation: closed && state.operation ? { ...state.operation, closed: true } : state.operation };
}

function expireWork(state: PresentationState, operationId: string, closed: boolean): PresentationState {
  return {
    operation: state.operation && closed ? { ...state.operation, closed: true } : state.operation,
    items: state.items.map((item) => isWorking(item) && item.operationId === operationId ? { ...item, pathStatus: 'expired' } : item),
  };
}

function safeDetail(message: string): string { return message.trim() || '工作过程未完成'; }
