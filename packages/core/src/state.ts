export type PublishedWorldPhase = 'idle' | 'planned' | 'awaiting-settle';
export type CoreSessionKind = 'init' | 'planning' | 'play' | 'revise';
export type CoreSessionStatus = 'ready' | 'running' | 'submitting';

export type CoreWorldState =
  | { status: 'uninitialized' }
  | { status: 'invalid'; error: { code: 'WORLD_INVALID'; message: string } }
  | {
      status: 'published'; worldId: string; title: string; revision: number; commitId: string;
      phase: PublishedWorldPhase; day: string | null; lastSettledDay: string | null;
    };

export interface CoreState {
  world: CoreWorldState;
  session: null | { id: string; kind: CoreSessionKind; status: CoreSessionStatus };
  capabilities: {
    startSessions: readonly CoreSessionKind[];
    settle: boolean;
    abandonDay: boolean;
    send: boolean;
    submit: boolean;
    cancel: boolean;
  };
}

export function buildState(
  world: CoreWorldState,
  session: CoreState['session'],
  mutationInFlight: boolean,
  disposed = false,
  cancelRequestedSessionId: string | null = null,
): CoreState {
  const available = !disposed && session === null && !mutationInFlight;
  let startSessions: readonly CoreSessionKind[] = [];
  let settle = false, abandonDay = false;
  if (available && world.status === 'uninitialized') startSessions = ['init'];
  if (available && world.status === 'published') {
    if (world.phase === 'idle') startSessions = ['planning', 'revise'];
    else if (world.phase === 'planned') { startSessions = ['play']; abandonDay = true; }
    else { settle = true; abandonDay = true; }
  }
  const ready = !disposed && session?.status === 'ready' && !mutationInFlight;
  const cancellable = !disposed
    && session !== null
    && (session.status === 'ready' ? !mutationInFlight : session.status === 'running' || session.status === 'submitting')
    && cancelRequestedSessionId !== session.id;
  return Object.freeze({
    world: Object.freeze({ ...world }) as CoreWorldState,
    session: session === null ? null : Object.freeze({ ...session }),
    capabilities: Object.freeze({
      startSessions: Object.freeze([...startSessions]), settle, abandonDay,
      send: ready, submit: ready, cancel: cancellable,
    }),
  });
}
