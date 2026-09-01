import path from 'node:path';
import {
  availableMutationCommandsV1,
  classifyWorldV1,
  type PublishedHeadV1,
} from '@dayloom/cli';
import { draftErrorV1 } from '@dayloom/draft';
import type { AssistantCommandV1 } from './argv.js';

export interface ResolvedAssistantCommandV1 {
  command: AssistantCommandV1;
  worldRoot: string | null;
  head: PublishedHeadV1 | null;
  available: readonly AssistantCommandV1[];
}

const WORLD_COMMANDS = new Set<AssistantCommandV1>(['plan', 'play', 'revise']);

export async function resolveAssistantCommandV1(input: {
  cwd?: string;
  world: string | null;
  explicit: AssistantCommandV1 | null;
}): Promise<Readonly<ResolvedAssistantCommandV1>> {
  const cwd = input.cwd ?? process.cwd();
  if (input.world === null) {
    if (input.explicit !== null && input.explicit !== 'init') {
      throw draftErrorV1('INVALID_ARGUMENT', `${input.explicit} requires --world.`);
    }
    return Object.freeze({
      command: 'init',
      worldRoot: null,
      head: null,
      available: Object.freeze<AssistantCommandV1[]>(['init']),
    });
  }

  if (input.explicit === 'init') throw draftErrorV1('INVALID_ARGUMENT', 'init does not accept --world.');
  const worldRoot = path.resolve(cwd, input.world);
  const classified = await classifyWorldV1(worldRoot);
  if (classified.status === 'invalid') throw draftErrorV1('WORLD_INVALID', classified.reason);
  if (classified.status === 'uninitialized') {
    throw draftErrorV1('NOT_AVAILABLE', 'A Published World is required for plan, play, or revise.', { availableCommands: [] });
  }
  const state = { status: 'published' as const, control: classified.head.commit.control };
  const available = Object.freeze(
    availableMutationCommandsV1(state).filter((value): value is AssistantCommandV1 => WORLD_COMMANDS.has(value as AssistantCommandV1)),
  );
  if (input.explicit !== null) {
    if (!available.includes(input.explicit)) {
      throw draftErrorV1('NOT_AVAILABLE', `${input.explicit} is not available. Available: ${formatAvailableV1(available)}.`, { requested: input.explicit, availableCommands: available });
    }
    return Object.freeze({ command: input.explicit, worldRoot, head: classified.head, available });
  }
  if (available.length === 1) {
    return Object.freeze({ command: available[0]!, worldRoot, head: classified.head, available });
  }
  if (available.length === 0) throw draftErrorV1('NOT_AVAILABLE', 'No Draft command is available for the current World state.', { availableCommands: available });
  throw draftErrorV1('AMBIGUOUS_COMMAND', `Draft command is ambiguous. Available: ${formatAvailableV1(available)}.`, { availableCommands: available });
}

function formatAvailableV1(commands: readonly AssistantCommandV1[]): string {
  return commands.length === 0 ? '<none>' : commands.join(', ');
}
