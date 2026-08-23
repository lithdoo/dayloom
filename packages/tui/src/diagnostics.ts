import type { CoreEvent } from '@dayloom/core2';
import type { TuiDriverState } from './types.js';

export function summarizeCoreEvent(event: CoreEvent): Record<string, unknown> {
  if (event.type === 'state.changed') {
    return {
      eventType: event.type,
      worldStatus: event.state.world.status,
      worldRevision: event.state.world.status === 'published' ? event.state.world.revision : undefined,
      worldPhase: event.state.world.status === 'published' ? event.state.world.phase : undefined,
      sessionId: event.state.session?.id,
      sessionKind: event.state.session?.kind,
      sessionStatus: event.state.session?.status,
      capabilities: event.state.capabilities,
    };
  }
  return {
    eventType: event.type,
    sessionId: event.sessionId,
    operationId: event.operationId,
    ...(event.type === 'work.delta' || event.type === 'output.delta' ? { deltaLength: event.text.length } : {}),
    ...(event.type === 'work.delta' ? { phase: event.phase, stepIndex: event.stepIndex } : {}),
    ...('messageId' in event ? { messageId: event.messageId } : {}),
    ...('status' in event ? { status: event.status } : {}),
  };
}

export function summarizeDriverState(state: TuiDriverState): Record<string, unknown> {
  const lastMessage = state.messages.at(-1);
  return {
    page: state.page.kind,
    worldStatus: state.world.status,
    worldRevision: state.world.status === 'published' ? state.world.revision : undefined,
    worldPhase: state.world.status === 'published' ? state.world.phase : undefined,
    sessionId: state.session?.id,
    sessionKind: state.session?.kind,
    sessionStatus: state.session?.status,
    pendingActionId: state.page.kind === 'hub' ? state.page.busy?.actionId : undefined,
    messageCount: state.messages.length,
    lastMessageId: lastMessage?.id,
    lastMessageRole: lastMessage?.role,
    lastMessageStatus: lastMessage?.status,
    lastMessageTextLength: lastMessage?.text.length,
  };
}
