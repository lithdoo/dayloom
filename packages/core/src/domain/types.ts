/** world 的业务阶段。 */
export type WorldPhase =
  | 'uninitialized'
  | 'initializing'
  | 'idle'
  | 'planning'
  | 'planned'
  | 'playing'
  | 'awaiting-settle'
  | 'revising'
  | 'invalid';

/** 初始化、规划、行动或修订中的会话类型。 */
export type SessionKind = 'init' | 'planning' | 'play' | 'revise';

/** 当前 active Session 的交互状态。 */
export type SessionStatus =
  | 'none'
  | 'created'
  | 'waiting-input'
  | 'streaming'
  | 'loading'
  | 'ready-to-submit'
  | 'submitting'
  | 'completed'
  | 'cancelled'
  | 'failed';
