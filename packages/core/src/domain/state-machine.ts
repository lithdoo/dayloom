import type { SessionSubmission } from '../schemas/submissions';
import type { SessionSnapshot } from '../sessions/types';
import type { RuntimeError } from '../schemas/common';
import type { WorldSnapshot } from '../types';
import type { CommandAvailability } from './availability';
import { getCommandAvailability, getSingleCommandAvailability } from './availability';
import type { WorldCommand } from './commands';
import type { SessionKind } from './types';
import { transitionCancel, transitionSubmit, transitionWorld } from './transitions';

export interface MachineInput {
  world: WorldSnapshot;
  session: SessionSnapshot;
}

export type TransitionResult =
  | { ok: true; nextWorld: WorldSnapshot; createSession?: SessionKind }
  | { ok: false; error: RuntimeError };

/** 无副作用的 Core 业务状态机。 */
export interface StateMachine {
  getAvailableCommands(input: MachineInput): CommandAvailability[];
  transitionWorld(command: WorldCommand, input: MachineInput): TransitionResult;
  transitionSubmit(submission: SessionSubmission, input: MachineInput): TransitionResult;
  transitionCancel(input: MachineInput): TransitionResult;
}

/** 默认确定性状态机实例。 */
export const coreStateMachine: StateMachine = Object.freeze({
  getAvailableCommands: (input: MachineInput) => getCommandAvailability(input.world, input.session),
  transitionWorld,
  transitionSubmit,
  transitionCancel,
});

/** 兼容当前调用点的 availability 函数。 */
export { getCommandAvailability, getSingleCommandAvailability };

/** 兼容当前调用点命名的纯 world transition。 */
export function transitionWorldCommand(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: WorldCommand,
): TransitionResult {
  return transitionWorld(command, { world, session });
}

/** 兼容当前调用点命名的纯 submit transition。 */
export function transitionSessionSubmit(
  world: WorldSnapshot,
  session: SessionSnapshot,
  submission: SessionSubmission,
): TransitionResult {
  return transitionSubmit(submission, { world, session });
}

/** 兼容当前调用点命名的纯 cancel transition。 */
export function transitionSessionCancel(
  world: WorldSnapshot,
  session: SessionSnapshot,
): TransitionResult {
  return transitionCancel({ world, session });
}

/** Runtime 外层在 disposed 后覆盖全部 command availability。 */
export function closeCommandAvailability(commands: CommandAvailability[]): CommandAvailability[] {
  return commands.map((command) => ({
    ...command,
    enabled: false,
    reasonCode: 'RUNTIME_CLOSED',
    reason: 'Runtime is closed.',
  }));
}
