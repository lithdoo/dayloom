import type { DayId, EventId, WorldId } from './common';

/** 一个完整、不可变的 canon 内容快照。 */
export interface CanonDocuments {
  /** 世界前提。 */
  premise: string;
  /** 叙事规则。 */
  rules: string;
  /** 文风说明。 */
  style: string;
  /** 玩家角色说明。 */
  userRole: string;
}

/** 尚未执行的计划节点。 */
export interface PlanBeat {
  /** day 内稳定 beat id。 */
  id: string;
  /** 节点意图。 */
  intent: string;
}

/** play 完成后带最终状态的计划节点。 */
export interface ResolvedPlanBeat extends PlanBeat {
  /** 节点最终状态。 */
  status: 'pending' | 'completed' | 'skipped';
  /** 完成该节点的事件；未产生事件时为 null。 */
  eventId: EventId | null;
}

/** play 中已完成的业务事件。 */
export interface PlayEvent {
  /** day 内稳定事件 id。 */
  id: EventId;
  /** 对应 beat；不对应固定 beat 时为 null。 */
  beatId: string | null;
  /** 用户行动。 */
  userInput: string;
  /** assistant 结果。 */
  assistantOutput: string;
}

/** 可持久化的完整会话记录条目。 */
export interface TranscriptEntry {
  /** transcript 内从 1 开始严格递增的序号。 */
  sequence: number;
  /** 消息角色。 */
  role: 'user' | 'assistant' | 'system';
  /** 消息正文。 */
  text: string;
  /** 对应 Runtime message id；没有时为 null。 */
  messageId: string | null;
}

/** init Session 的业务产物。 */
export interface InitSubmission {
  kind: 'init';
  world: { id: WorldId; title: string };
  canon: CanonDocuments;
}

/** planning Session 的业务产物。 */
export interface PlanningSubmission {
  kind: 'planning';
  day: DayId;
  intent: string;
  beats: PlanBeat[];
}

/** play Session 的业务产物。 */
export interface PlaySubmission {
  kind: 'play';
  day: DayId;
  summary: string;
  beats: ResolvedPlanBeat[];
  events: PlayEvent[];
  transcript: TranscriptEntry[];
}

/** revise Session 的业务产物。 */
export interface ReviseSubmission {
  kind: 'revise';
  summary: string;
  canon: CanonDocuments;
}

/** Session 可以提交给 Runtime 的全部强类型业务产物。 */
export type SessionSubmission =
  | InitSubmission
  | PlanningSubmission
  | PlaySubmission
  | ReviseSubmission;
