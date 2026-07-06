import { readCurrent, resolveWorldRoot } from './guard'; import { runPlayLoop } from './event-loop'; import type { PlayOptions } from './types';
export async function playInteractive(dir:string,options:PlayOptions={}):Promise<void>{const worldRoot=resolveWorldRoot(dir);const {day}=readCurrent(worldRoot);await runPlayLoop(worldRoot,day,options);}
export * from './types';
