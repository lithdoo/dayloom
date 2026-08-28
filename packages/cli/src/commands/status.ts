import { availableMutationCommandsV1 } from '../cli/availability.js';
import { classifyWorldV1 } from '../world/read.js';

export interface StatusResultV1 {
  status: 'uninitialized' | 'published' | 'invalid';
  revision: number | null;
  commitId: string | null;
  phase: 'idle' | 'planned' | 'awaiting-settle' | null;
  day: string | null;
  lastSettledDay: string | null;
  availableCommands: readonly string[];
  reason?: string;
}

export async function runStatusV1(worldRoot: string): Promise<StatusResultV1> {
  const classified = await classifyWorldV1(worldRoot);
  if (classified.status === 'uninitialized') {
    return {
      status: 'uninitialized',
      revision: null,
      commitId: null,
      phase: null,
      day: null,
      lastSettledDay: null,
      availableCommands: availableMutationCommandsV1({ status: 'uninitialized' }),
    };
  }
  if (classified.status === 'invalid') {
    return {
      status: 'invalid',
      revision: null,
      commitId: null,
      phase: null,
      day: null,
      lastSettledDay: null,
      availableCommands: availableMutationCommandsV1({ status: 'invalid' }),
      reason: classified.reason,
    };
  }
  const { commit } = classified.head;
  return {
    status: 'published',
    revision: commit.revision,
    commitId: commit.id,
    phase: commit.control.phase,
    day: commit.control.day,
    lastSettledDay: commit.control.lastSettledDay,
    availableCommands: availableMutationCommandsV1({ status: 'published', control: commit.control }),
  };
}
