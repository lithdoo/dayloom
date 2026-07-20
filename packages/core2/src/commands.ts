import type {
  CommandAvailability,
  RuntimeCommand,
  SessionSnapshot,
  WorldPhase,
  WorldSnapshot,
} from './types';

const allCommands: RuntimeCommand[] = [
  'init',
  'daily',
  'play',
  'settle',
  'revise',
  'abandon-day',
  'submit',
  'cancel',
];

/** 计算当前 world/session 下全部 RuntimeCommand 的可用性。 */
export function getCommandAvailability(
  world: WorldSnapshot,
  session: SessionSnapshot,
): CommandAvailability[] {
  return allCommands.map((command) => getSingleCommandAvailability(world, session, command));
}

/** 计算单个 RuntimeCommand 的可用性。 */
export function getSingleCommandAvailability(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: RuntimeCommand,
): CommandAvailability {
  const type = command === 'submit' || command === 'cancel' ? 'session' : 'world';
  const reason = getUnavailableReason(world, session, command);
  return {
    name: command,
    type,
    enabled: reason === null,
    reason,
  };
}

function getUnavailableReason(
  world: WorldSnapshot,
  session: SessionSnapshot,
  command: RuntimeCommand,
): string | null {
  if (world.phase === 'invalid') {
    return 'World is invalid.';
  }

  switch (command) {
    case 'init':
      return requirePhase(world.phase, 'uninitialized', command);
    case 'daily':
      return requirePhase(world.phase, 'idle', command);
    case 'play':
      return requirePhase(world.phase, 'planned', command);
    case 'settle':
      return requirePhase(world.phase, 'awaiting-settle', command);
    case 'revise':
      return requirePhase(world.phase, 'idle', command);
    case 'abandon-day':
      if (session.active) {
        return 'abandon-day requires no active session.';
      }
      return world.phase === 'planned' || world.phase === 'awaiting-settle'
        ? null
        : `abandon-day is not available in phase ${world.phase}.`;
    case 'submit':
      if (!session.active) {
        return 'submit requires an active session.';
      }
      return session.status === 'ready-to-submit'
        ? null
        : `submit requires session status ready-to-submit, got ${session.status}.`;
    case 'cancel':
      if (!session.active) {
        return 'cancel requires an active session.';
      }
      return session.status === 'submitting' ||
        session.status === 'completed' ||
        session.status === 'cancelled'
        ? `cancel is not available while session status is ${session.status}.`
        : null;
  }
}

function requirePhase(current: WorldPhase, expected: WorldPhase, command: RuntimeCommand): string | null {
  return current === expected ? null : `${command} is not available in phase ${current}.`;
}
