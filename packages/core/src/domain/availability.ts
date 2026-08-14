import type { SessionSnapshot } from '../sessions/types';
import { isSessionSubmittable } from '../session-status';
import type { WorldSnapshot } from '../types';
import { COMMAND_REGISTRY, RUNTIME_COMMANDS } from './command-registry';
import type { CommandUnavailableReason, RuntimeCommand } from './commands';
import { sessionKindForPhase } from './phases';

/** 单个 command 在当前快照中的确定可用性。 */
export interface CommandAvailability {
  name: RuntimeCommand;
  type: 'world' | 'session';
  enabled: boolean;
  reasonCode: CommandUnavailableReason | null;
  reason: string | null;
}

interface UnavailableReason {
  code: CommandUnavailableReason;
  message: string;
}

/** 计算全部 Runtime command 的可用性。 */
export function getCommandAvailability(
  world: WorldSnapshot,
  session: SessionSnapshot,
): CommandAvailability[] {
  return RUNTIME_COMMANDS.map((command) => getSingleCommandAvailability(world, session, command));
}

/** 计算一个 Runtime command 的可用性。 */
export function getSingleCommandAvailability(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: RuntimeCommand,
): CommandAvailability {
  const rule = COMMAND_REGISTRY[command];
  const reason = unavailableReason(world, session, command);
  return {
    name: command,
    type: rule.type,
    enabled: reason === null,
    reasonCode: reason?.code ?? null,
    reason: reason?.message ?? null,
  };
}

function unavailableReason(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: RuntimeCommand,
): UnavailableReason | null {
  const rule = COMMAND_REGISTRY[command];
  if (world.phase === 'invalid') return unavailable('WORLD_INVALID', 'World is invalid.');

  // Session command 先报告缺少 Session，供调用方稳定地区分“无会话”和“阶段错误”。
  if (rule.session === 'active' && !session.active) {
    return unavailable('SESSION_REQUIRED', `${command} requires an active Session.`);
  }
  if (!rule.phases.includes(world.phase)) {
    return unavailable('PHASE_MISMATCH', `${command} is not available in phase ${world.phase}.`);
  }
  if (rule.session === 'none' && session.active) {
    return unavailable('SESSION_ALREADY_ACTIVE', `${command} requires no active Session.`);
  }
  if (rule.currentDayRequired && world.day === null) {
    return unavailable('CURRENT_DAY_REQUIRED', `${command} requires a current day.`);
  }
  if (rule.session === 'active') {
    const expectedKind = sessionKindForPhase(world.phase);
    if (session.kind !== expectedKind) {
      return unavailable('SESSION_KIND_MISMATCH', `${command} requires the Session kind to match the world phase.`);
    }
    if (command === 'submit' && !isSessionSubmittable(session.status)) {
      return unavailable(
        'SESSION_STATUS_MISMATCH',
        `submit requires a submittable Session status, got ${session.status}.`,
      );
    }
    if (command === 'cancel' && !isSessionCancellable(session.status)) {
      return unavailable(
        'SESSION_STATUS_MISMATCH',
        `cancel is not available while Session status is ${session.status}.`,
      );
    }
  }
  return null;
}

function isSessionCancellable(status: SessionSnapshot['status']): boolean {
  return status !== 'none' && status !== 'submitting' && status !== 'completed' && status !== 'cancelled';
}

function unavailable(code: CommandUnavailableReason, message: string): UnavailableReason {
  return { code, message };
}
