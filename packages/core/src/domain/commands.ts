/** world 业务指令。 */
export type WorldCommand = 'init' | 'daily' | 'play' | 'settle' | 'revise' | 'abandon-day';

/** active Session 控制指令。 */
export type SessionCommand = 'submit' | 'cancel';

/** Runtime 支持的业务指令，不含应用级指令。 */
export type RuntimeCommand = WorldCommand | SessionCommand;

/** 指令不可执行时的稳定机器原因。 */
export type CommandUnavailableReason =
  | 'WORLD_INVALID'
  | 'PHASE_MISMATCH'
  | 'SESSION_REQUIRED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'SESSION_KIND_MISMATCH'
  | 'SESSION_STATUS_MISMATCH'
  | 'CURRENT_DAY_REQUIRED'
  | 'RUNTIME_CLOSED';
