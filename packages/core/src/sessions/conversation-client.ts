import type { SessionKind } from '../types';

/** 发送给 AI provider 的一条对话消息。 */
export interface ConversationMessage {
  /** 消息角色。 */
  role: 'user' | 'assistant';

  /** 消息正文。 */
  text: string;
}

/** 一次自然语言 AI 请求。 */
export interface ConversationRequest {
  /** 当前业务 Session 类型。 */
  kind: SessionKind;

  /** 本次请求用于对话还是生成提交产物。 */
  purpose: 'dialogue' | 'submit';

  /** 本次请求的系统提示。 */
  systemPrompt: string;

  /** 截至本轮的完整 Session 对话。 */
  messages: readonly ConversationMessage[];

  /** 中断 provider 调用。 */
  signal: AbortSignal;
}

/** Provider 无关的自然语言流式 AI client。 */
export interface ConversationClient {
  /** 发起请求并按 provider delta 返回 assistant 文本。 */
  streamReply(request: ConversationRequest): AsyncIterable<string>;
}
