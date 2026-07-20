import { createRuntimeError } from './errors';
import type {
  RuntimeCommand,
  RuntimeError,
  SessionKind,
  SessionSnapshot,
  SessionSubmitResult,
  WorldPhase,
  WorldSnapshot,
} from './types';

/** 状态机 transition 的成功结果。 */
export interface TransitionSuccess {
  /** transition 是否成功。 */
  ok: true;

  /** transition 后的 world 快照。 */
  world: WorldSnapshot;

  /** world 指令需要创建的 Session 类型。 */
  createSessionKind?: SessionKind;
}

/** 状态机 transition 的失败结果。 */
export interface TransitionFailure {
  /** transition 是否成功。 */
  ok: false;

  /** transition 失败后保持不变的 world 快照。 */
  world: WorldSnapshot;

  /** 稳定错误。 */
  error: RuntimeError;
}

/** 状态机 transition 结果。 */
export type TransitionResult = TransitionSuccess | TransitionFailure;

/** 执行不依赖 Session submit result 的 world 指令 transition。 */
export function transitionWorldCommand(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: RuntimeCommand,
): TransitionResult {
  if (world.phase === 'invalid') {
    return fail(world, 'WORLD_INVALID', 'World is invalid.');
  }

  switch (command) {
    case 'init':
      return requirePhase(world, 'uninitialized', () =>
        success(setPhase(world, 'initializing'), 'init'),
      );
    case 'daily':
      return requirePhase(world, 'idle', () => success(setPhase(world, 'planning'), 'planning'));
    case 'play':
      return requirePhase(world, 'planned', () => success(setPhase(world, 'playing'), 'play'));
    case 'revise':
      return requirePhase(world, 'idle', () => success(setPhase(world, 'revising'), 'revise'));
    case 'settle':
      return requirePhase(world, 'awaiting-settle', () => success(setPhase(world, 'idle')));
    case 'abandon-day':
      if (session.active) {
        return fail(world, 'COMMAND_NOT_AVAILABLE', 'abandon-day requires no active session.');
      }
      if (world.phase !== 'planned' && world.phase !== 'awaiting-settle') {
        return fail(world, 'COMMAND_NOT_AVAILABLE', 'abandon-day is not available in this phase.');
      }
      return success({ ...world, phase: 'idle', day: previousDayFromSnapshot(world.day) });
    case 'submit':
    case 'cancel':
      return fail(world, 'COMMAND_NOT_AVAILABLE', `${command} must be handled through SessionManager.`);
  }
}

/** 执行 submit 后的 world transition。 */
export function transitionSessionSubmit(
  world: WorldSnapshot,
  result: SessionSubmitResult,
): TransitionResult {
  if (world.phase === 'invalid') {
    return fail(world, 'WORLD_INVALID', 'World is invalid.');
  }

  const expectedKind = sessionKindForPhase(world.phase);
  if (!expectedKind) {
    return fail(world, 'COMMAND_NOT_AVAILABLE', 'submit is not available in this phase.');
  }
  if (result.kind !== expectedKind) {
    return fail(world, 'SESSION_KIND_MISMATCH', 'Session submit result does not match world phase.');
  }

  switch (world.phase) {
    case 'initializing':
      return success({ ...world, phase: 'idle', initialized: true });
    case 'planning':
      return success({ ...world, phase: 'planned', day: dayFromPayload(result.payload) ?? world.day });
    case 'playing':
      return success(setPhase(world, 'awaiting-settle'));
    case 'revising':
      return success(setPhase(world, 'idle'));
    default:
      return fail(world, 'COMMAND_NOT_AVAILABLE', 'submit is not available in this phase.');
  }
}

/** 执行 cancel 后的 world transition。 */
export function transitionSessionCancel(world: WorldSnapshot): TransitionResult {
  if (world.phase === 'invalid') {
    return fail(world, 'WORLD_INVALID', 'World is invalid.');
  }

  switch (world.phase) {
    case 'initializing':
      return success({ ...world, phase: 'uninitialized', initialized: false });
    case 'planning':
      return success(setPhase(world, 'idle'));
    case 'playing':
      return success(setPhase(world, 'planned'));
    case 'revising':
      return success(setPhase(world, 'idle'));
    default:
      return fail(world, 'COMMAND_NOT_AVAILABLE', 'cancel is not available in this phase.');
  }
}

/** 根据有 Session 的 world phase 返回应创建或提交的 SessionKind。 */
export function sessionKindForPhase(phase: WorldPhase): SessionKind | null {
  switch (phase) {
    case 'initializing':
      return 'init';
    case 'planning':
      return 'planning';
    case 'playing':
      return 'play';
    case 'revising':
      return 'revise';
    default:
      return null;
  }
}

function requirePhase(
  world: WorldSnapshot,
  phase: WorldPhase,
  next: () => TransitionSuccess,
): TransitionResult {
  if (world.phase !== phase) {
    return fail(world, 'COMMAND_NOT_AVAILABLE', `Command is not available in phase ${world.phase}.`);
  }
  return next();
}

function success(world: WorldSnapshot, createSessionKind?: SessionKind): TransitionSuccess {
  return createSessionKind ? { ok: true, world, createSessionKind } : { ok: true, world };
}

function fail(world: WorldSnapshot, code: string, message: string): TransitionFailure {
  return { ok: false, world, error: createRuntimeError(code, message) };
}

function setPhase(world: WorldSnapshot, phase: WorldPhase): WorldSnapshot {
  return { ...world, phase };
}

function dayFromPayload(payload: unknown): string | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'day' in payload &&
    typeof (payload as { day?: unknown }).day === 'string'
  ) {
    return (payload as { day: string }).day;
  }
  return null;
}

function previousDayFromSnapshot(day: string | null): string | null {
  if (!day) {
    return null;
  }
  const match = /^day_(\d+)$/.exec(day);
  if (!match) {
    return null;
  }
  const previous = Number(match[1]) - 1;
  if (previous <= 0) {
    return null;
  }
  return `day_${String(previous).padStart(match[1].length, '0')}`;
}
