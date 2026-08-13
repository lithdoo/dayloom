import type { CoreState } from './state';
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
