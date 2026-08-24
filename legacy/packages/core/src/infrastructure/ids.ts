import type {
  CanonRevisionId,
  CommitId,
  DayRevisionId,
  EventId,
  OperationId,
} from '../schemas/common';
import { randomUUID } from 'crypto';

/** Runtime 内所有生成标识的可替换来源。 */
export interface IdGenerator {
  nextOperationId(): OperationId;
  nextCommitId(): CommitId;
  nextCanonRevisionId(): CanonRevisionId;
  nextDayRevisionId(): DayRevisionId;
  nextSessionId(): string;
  nextMessageId(): string;
  nextEventId(): EventId;
}

/** 用一个唯一 token 构建规范前缀 id。 */
export function prefixedId(prefix: string, token: string): string {
  if (!/^[a-z][a-z0-9]*_$/.test(prefix)) {
    throw new Error(`Invalid id prefix: ${prefix}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(token)) {
    throw new Error('Id token must contain only letters, numbers, underscores, or hyphens.');
  }
  return `${prefix}${token}`;
}

/** 使用 UUID token 的默认 id 生成器。 */
export function createSystemIdGenerator(): IdGenerator {
  const token = () => randomUUID().replace(/-/g, '');
  return {
    nextOperationId: () => prefixedId('op_', token()),
    nextCommitId: () => prefixedId('commit_', token()),
    nextCanonRevisionId: () => prefixedId('canon_', token()),
    nextDayRevisionId: () => prefixedId('dayrev_', token()),
    nextSessionId: () => prefixedId('session_', token()),
    nextMessageId: () => prefixedId('message_', token()),
    nextEventId: () => prefixedId('event_', token()),
  };
}
