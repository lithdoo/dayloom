import type { CoreEvent } from '@dayloom/core2';
import type { TuiDriverState } from './types.js';

export function summarizeCoreEvent(event: CoreEvent): Record<string, unknown> {
  if (event.type === 'output.delta') {
    return { eventType: event.type, sessionId: event.sessionId, deltaLength: event.text.length };
  }
  return {
    eventType: event.type,
    sessionId: event.state.session?.id,
    sessionStatus: event.state.session?.status,
    phase: event.state.world.phase,
  };
}

export function summarizeDriverState(state: TuiDriverState): Record<string, unknown> {
  const lastMessage = state.messages.at(-1);
  return {
    page: state.page.kind,
    activeSessionId: state.session?.id,
    sessionStatus: state.session?.status,
    messageCount: state.messages.length,
    lastMessageId: lastMessage?.id,
    lastMessageRole: lastMessage?.role,
    lastMessageStatus: lastMessage?.status,
    lastMessageTextLength: lastMessage?.text.length,
  };
}
