import path from 'node:path';
import { parseArgvV1, type ParsedInvocationV1 } from './argv.js';
import { availableMutationCommandsV1, type PublicMutationCommandV1 } from './availability.js';
import { cliErrorV1 } from './errors.js';
import { runAbandonV1 } from '../commands/abandon.js';
import { runStatusV1 } from '../commands/status.js';
import { runVerifyV1 } from '../commands/verify.js';
import { classifyWorldV1 } from '../world/read.js';

export interface ExecutedCliV1 {
  invocation: Readonly<ParsedInvocationV1>;
  result: unknown;
}

export async function executeCliV1(argv: readonly string[]): Promise<ExecutedCliV1> {
  const invocation = parseArgvV1(argv);
  const worldRoot = path.resolve(invocation.world);
  if (invocation.command === 'status') return { invocation, result: await runStatusV1(worldRoot) };
  if (invocation.command === 'verify') return { invocation, result: await runVerifyV1(worldRoot) };

  const classified = await classifyWorldV1(worldRoot);
  if (classified.status === 'invalid') throw cliErrorV1('WORLD_INVALID', classified.reason);
  const availability = classified.status === 'uninitialized'
    ? { status: 'uninitialized' as const }
    : { status: 'published' as const, control: classified.head.commit.control };
  const available = availableMutationCommandsV1(availability);
  if (!available.includes(invocation.command as PublicMutationCommandV1)) {
    throw cliErrorV1('NOT_AVAILABLE', `${invocation.command} is not available for the current World state.`, { availableCommands: available });
  }

  if (invocation.command === 'abandon' && classified.status === 'published') {
    return { invocation, result: await runAbandonV1(worldRoot, invocation, classified.head) };
  }

  throw cliErrorV1('NOT_AVAILABLE', `${invocation.command} execution has not been landed yet.`);
}
