export type PublishedWorldPhase = 'idle' | 'planned' | 'awaiting-settle';
export type CoreSessionStatus = 'ready' | 'running' | 'submitting';

export interface CoreWorldView {
  worldId: string;
  title: string;
  revision: number;
  commitId: string;
  phase: PublishedWorldPhase;
  day: string | null;
  lastSettledDay: string | null;
}

export interface CoreState {
  world: CoreWorldView;
  session: null | { id: string; kind: 'play'; status: CoreSessionStatus };
  capabilities: {
    startSessions: readonly ('play')[];
    send: boolean;
    submit: boolean;
    cancel: boolean;
  };
}

export function buildState(world: CoreWorldView, session: CoreState['session'], mutationInFlight: boolean): CoreState {
  const ready = session?.status === 'ready' && !mutationInFlight;
  return Object.freeze({
    world: Object.freeze({ ...world }),
    session: session === null ? null : Object.freeze({ ...session }),
    capabilities: Object.freeze({
      startSessions: Object.freeze(session === null && !mutationInFlight && world.phase === 'planned' && world.day !== null ? ['play'] as const : []),
      send: ready,
      submit: ready,
      cancel: ready,
    }),
  });
}
