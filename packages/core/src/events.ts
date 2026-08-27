import type { CoreState } from './state';
import type { CoreOperationEventV2 } from './session/turn-coordinator';
export type ReactWorkPhase='thought'|'observe'|'check';
export type CoreEvent={type:'state.changed';state:Readonly<CoreState>}|CoreOperationEventV2;
