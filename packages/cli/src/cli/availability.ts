import type { WorldControlV1 } from '@dayloom/archive-protocol';

export type PublicMutationCommandV1 = 'init' | 'plan' | 'play' | 'revise' | 'settle' | 'abandon';

export type AvailabilityStateV1 =
  | { status: 'uninitialized' }
  | { status: 'published'; control: WorldControlV1 }
  | { status: 'invalid' };

export function availableMutationCommandsV1(state: AvailabilityStateV1): readonly PublicMutationCommandV1[] {
  if (state.status === 'invalid') return Object.freeze([]);
  if (state.status === 'uninitialized') return Object.freeze(['init']);
  if (state.control.phase === 'idle') return Object.freeze(['plan', 'revise']);
  if (state.control.phase === 'planned') return Object.freeze(['play', 'abandon']);
  return Object.freeze(['settle', 'abandon']);
}

export function isMutationAvailableV1(state: AvailabilityStateV1, command: PublicMutationCommandV1): boolean {
  return availableMutationCommandsV1(state).includes(command);
}
