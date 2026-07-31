import type { RuntimeEvent } from '@dayloom/core';
import type { TuiDriverState } from './types.js';

export function summarizeRuntimeEvent(event: RuntimeEvent): Record<string, unknown> {
  switch (event.type) {
    case 'message-added':
      return {
        eventType: event.type,
        sessionId: event.message.sessionId,
        messageId: event.message.id,
        role: event.message.role,
        status: event.message.status,
        textLength: event.message.text.length,
      };
    case 'assistant-message-delta':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        messageId: event.messageId,
        deltaSequence: event.sequence,
        deltaLength: event.delta.length,
      };
    case 'assistant-message-start':
    case 'assistant-message-end':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        messageId: event.messageId,
      };
    case 'assistant-message-error':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        messageId: event.messageId,
        errorCode: event.error.code,
        errorMessage: event.error.message,
      };
    case 'session-created':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
        sessionKind: event.kind,
      };
    case 'session-status-changed':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        sessionStatus: event.status,
      };
    case 'session-ended':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
        sessionStatus: event.status,
      };
    case 'input-started':
    case 'input-succeeded':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
      };
    case 'input-failed':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
        errorCode: event.error.code,
        errorMessage: event.error.message,
      };
    case 'input-requested':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        requestId: event.request.id,
      };
    case 'input-closed':
      return {
        eventType: event.type,
        sessionId: event.sessionId,
        requestId: event.requestId,
      };
    case 'loading-started':
    case 'loading-updated':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
        loadingId: event.loading.id,
        loadingOperation: event.loading.operation,
      };
    case 'loading-ended':
      return {
        eventType: event.type,
        operationId: event.operationId,
        sessionId: event.sessionId,
        loadingId: event.loadingId,
      };
    case 'command-started':
    case 'command-succeeded':
      return {
        eventType: event.type,
        operationId: event.operationId,
        command: event.command,
      };
    case 'command-failed':
    case 'command-rejected':
      return {
        eventType: event.type,
        operationId: event.operationId,
        command: event.command,
        errorCode: event.error.code,
        errorMessage: event.error.message,
      };
    case 'world-changed':
      return {
        eventType: event.type,
        operationId: event.operationId,
        previousPhase: event.previous.phase,
        currentPhase: event.current.phase,
        previousDay: event.previous.day,
        currentDay: event.current.day,
      };
  }
}

export function summarizeDriverState(state: TuiDriverState): Record<string, unknown> {
  const lastMessage = state.messages.at(-1);
  return {
    page: state.page.kind,
    activeSessionId: state.snapshot.session.id,
    sessionStatus: state.snapshot.session.status,
    messageCount: state.messages.length,
    lastMessageId: lastMessage?.id,
    lastMessageRole: lastMessage?.role,
    lastMessageStatus: lastMessage?.status,
    lastMessageTextLength: lastMessage?.text.length,
    loadingOperation: state.loading?.operation,
  };
}
