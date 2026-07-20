import type { RuntimeMessage, SessionEvent } from './types';

/** MessageStore 的保留策略配置。 */
export interface MessageStoreOptions {
  /** 每个 session 最多保留的消息条数；不传表示不限条数。 */
  maxMessagesPerSession?: number;

  /** 每个 session 最多保留的文本字符数；不传表示不限字符数。 */
  maxTextCharsPerSession?: number;
}

/** 按 session id 聚合 RuntimeMessage 的 driver 辅助模块。 */
export class MessageStore {
  private readonly messagesBySession = new Map<string, RuntimeMessage[]>();
  private readonly maxMessagesPerSession?: number;
  private readonly maxTextCharsPerSession?: number;

  constructor(options: MessageStoreOptions = {}) {
    this.maxMessagesPerSession = options.maxMessagesPerSession;
    this.maxTextCharsPerSession = options.maxTextCharsPerSession;
  }

  /** 读取某个 session 的聚合消息副本。 */
  getMessages(sessionId: string): RuntimeMessage[] {
    return (this.messagesBySession.get(sessionId) ?? []).map((message) => ({ ...message }));
  }

  /** 清空某个 session 的消息。 */
  clearSession(sessionId: string): void {
    this.messagesBySession.delete(sessionId);
  }

  /** 应用 SessionEvent 到聚合消息模型。 */
  applySessionEvent(sessionId: string, event: SessionEvent): void {
    switch (event.type) {
      case 'message-added':
        this.upsertMessage(sessionId, { ...event.message, sessionId });
        break;
      case 'assistant-message-start':
        this.upsertMessage(sessionId, {
          id: event.messageId,
          role: 'assistant',
          text: '',
          status: 'streaming',
          sessionId,
        });
        break;
      case 'assistant-message-delta':
        this.appendAssistantDelta(sessionId, event.messageId, event.delta);
        break;
      case 'assistant-message-end':
        this.updateAssistantStatus(sessionId, event.messageId, 'complete');
        break;
      case 'assistant-message-error':
        this.updateAssistantStatus(sessionId, event.messageId, 'error');
        break;
      default:
        break;
    }
  }

  private upsertMessage(sessionId: string, message: RuntimeMessage): void {
    const messages = this.ensureSession(sessionId);
    const index = messages.findIndex((candidate) => candidate.id === message.id);
    if (index === -1) {
      messages.push({ ...message });
    } else {
      messages[index] = { ...messages[index], ...message };
    }
    this.enforceRetention(sessionId);
  }

  private appendAssistantDelta(sessionId: string, messageId: string, delta: string): void {
    const messages = this.ensureSession(sessionId);
    let message = messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        text: '',
        status: 'streaming',
        sessionId,
      };
      messages.push(message);
    }
    if (message.status !== 'complete') {
      message.text += delta;
      message.status = 'streaming';
    }
    this.enforceRetention(sessionId);
  }

  private updateAssistantStatus(
    sessionId: string,
    messageId: string,
    status: 'complete' | 'error',
  ): void {
    const messages = this.ensureSession(sessionId);
    let message = messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        text: '',
        status,
        sessionId,
      };
      messages.push(message);
    } else {
      message.status = status;
    }
    this.enforceRetention(sessionId);
  }

  private ensureSession(sessionId: string): RuntimeMessage[] {
    let messages = this.messagesBySession.get(sessionId);
    if (!messages) {
      messages = [];
      this.messagesBySession.set(sessionId, messages);
    }
    return messages;
  }

  private enforceRetention(sessionId: string): void {
    const messages = this.messagesBySession.get(sessionId);
    if (!messages) {
      return;
    }

    if (this.maxMessagesPerSession !== undefined) {
      while (messages.length > this.maxMessagesPerSession) {
        messages.shift();
      }
    }

    if (this.maxTextCharsPerSession !== undefined) {
      while (this.totalTextLength(messages) > this.maxTextCharsPerSession && messages.length > 1) {
        messages.shift();
      }
    }
  }

  private totalTextLength(messages: RuntimeMessage[]): number {
    return messages.reduce((total, message) => total + message.text.length, 0);
  }
}
