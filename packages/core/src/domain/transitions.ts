import { createRuntimeError } from '../errors';
import type { RuntimeError } from '../schemas/common';
import type { SessionSubmission } from '../schemas/submissions';
import type { WorldSnapshot } from '../types';
import { getSingleCommandAvailability } from './availability';
import { COMMAND_REGISTRY } from './command-registry';
import type { WorldCommand } from './commands';
import { cancelTargetForPhase, sessionKindForPhase, submitTargetForPhase } from './phases';
import type { MachineInput, TransitionResult } from './state-machine';

/** 计算 world command 的逻辑目标，不执行副作用。 */
export function transitionWorld(command: WorldCommand, input: MachineInput): TransitionResult {
  const unavailable = requireAvailable(command, input);
  if (unavailable) return unavailable;
  const rule = COMMAND_REGISTRY[command];
  let nextWorld = { ...input.world, phase: rule.targetPhase! };
  if (command === 'abandon-day') nextWorld = { ...nextWorld, day: previousDay(input.world.day) };
  return rule.createSession
    ? { ok: true, nextWorld, createSession: rule.createSession }
    : { ok: true, nextWorld };
}

/** 校验 Session 快照和 submission 后计算 submit 目标。 */
export function transitionSubmit(submission: SessionSubmission, input: MachineInput): TransitionResult {
  const unavailable = requireAvailable('submit', input);
  if (unavailable) return unavailable;
  const expectedKind = sessionKindForPhase(input.world.phase);
  if (submission.kind !== expectedKind) {
    return failure('SESSION_KIND_MISMATCH', 'Session submission kind does not match the world phase.');
  }
  const target = submitTargetForPhase(input.world.phase);
  if (!target) return failure('PHASE_MISMATCH', 'submit has no transition from the current phase.');
  const nextWorld: WorldSnapshot = {
    ...input.world,
    phase: target,
    ...(submission.kind === 'init' ? { initialized: true } : {}),
    ...(submission.kind === 'planning' ? { day: submission.day } : {}),
  };
  return { ok: true, nextWorld };
}

/** 计算 active Session 的 cancel 目标。 */
export function transitionCancel(input: MachineInput): TransitionResult {
  const unavailable = requireAvailable('cancel', input);
  if (unavailable) return unavailable;
  const target = cancelTargetForPhase(input.world.phase);
  if (!target) return failure('PHASE_MISMATCH', 'cancel has no transition from the current phase.');
  return {
    ok: true,
    nextWorld: {
      ...input.world,
      phase: target,
      ...(input.world.phase === 'initializing' ? { initialized: false } : {}),
    },
  };
}

function requireAvailable(
  command: Parameters<typeof getSingleCommandAvailability>[2],
  input: MachineInput,
): Extract<TransitionResult, { ok: false }> | null {
  const availability = getSingleCommandAvailability(input.world, input.session, command);
  return availability.enabled
    ? null
    : failure(reasonToErrorCode(availability.reasonCode), availability.reason ?? 'Command is not available.');
}

function reasonToErrorCode(reason: NonNullable<ReturnType<typeof getSingleCommandAvailability>['reasonCode']> | null) {
  if (reason === 'SESSION_REQUIRED') return 'SESSION_NOT_ACTIVE' as const;
  if (reason === 'CURRENT_DAY_REQUIRED') return 'COMMAND_NOT_AVAILABLE' as const;
  return reason ?? 'COMMAND_NOT_AVAILABLE';
}

function failure(code: RuntimeError['code'], message: string): Extract<TransitionResult, { ok: false }> {
  return { ok: false, error: createRuntimeError(code, message) };
}

function previousDay(day: string | null): string | null {
  const match = day ? /^day_(\d+)$/.exec(day) : null;
  if (!match) return null;
  const value = Number(match[1]) - 1;
  return value > 0 ? `day_${String(value).padStart(match[1].length, '0')}` : null;
}
