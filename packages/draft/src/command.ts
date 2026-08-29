import {
  availableMutationCommandsV1,
  classifyWorldV1,
  type ClassifiedWorldV1,
} from '@dayloom/cli';
import type { DraftCommandV1 } from './argv.js';
import { draftErrorV1 } from './errors.js';

const DRAFT_COMMANDS = Object.freeze(['init', 'plan', 'play', 'revise'] as const);

export interface ResolvedDraftCommandV1 {
  command: DraftCommandV1;
  classified: ClassifiedWorldV1;
  available: readonly DraftCommandV1[];
}

function isDraftCommandV1(value: string): value is DraftCommandV1 {
  return (DRAFT_COMMANDS as readonly string[]).includes(value);
}

export async function resolveDraftCommandV1(
  worldRoot: string,
  explicit: DraftCommandV1 | null,
): Promise<Readonly<ResolvedDraftCommandV1>> {
  const classified = await classifyWorldV1(worldRoot);
  if (classified.status === 'invalid') {
    throw draftErrorV1('WORLD_INVALID', classified.reason, { status: 'invalid' });
  }

  const availability = classified.status === 'uninitialized'
    ? { status: 'uninitialized' as const }
    : { status: 'published' as const, control: classified.head.commit.control };

  const available = Object.freeze(
    availableMutationCommandsV1(availability).filter(isDraftCommandV1),
  );

  if (explicit !== null) {
    if (!available.includes(explicit)) {
      throw draftErrorV1(
        'NOT_AVAILABLE',
        `${explicit} is not available for the current World state. Available: ${formatAvailableV1(available)}.`,
        { requested: explicit, availableCommands: available },
      );
    }
    return Object.freeze({ command: explicit, classified, available });
  }

  if (available.length === 1) {
    return Object.freeze({ command: available[0]!, classified, available });
  }
  if (available.length === 0) {
    throw draftErrorV1(
      'NOT_AVAILABLE',
      'No Draft command is available for the current World state.',
      { availableCommands: available },
    );
  }
  throw draftErrorV1(
    'AMBIGUOUS_COMMAND',
    `Draft command is ambiguous. Available: ${formatAvailableV1(available)}.`,
    { availableCommands: available },
  );
}

function formatAvailableV1(available: readonly DraftCommandV1[]): string {
  return available.length === 0 ? '<none>' : available.join(', ');
}
