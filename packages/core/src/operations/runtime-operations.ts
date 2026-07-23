import type { ArchiveRepository } from '../archive';
import { systemClock, type RuntimeClock } from '../infrastructure/clock';
import type { RuntimeOperations } from '../runtime/types';
import { abandonDay } from './abandon-day';
import { cancelSession } from './cancel-session';
import { initializeWorld } from './initialize-world';
import { prepareSessionStart } from './start-session';
import { settleDay } from './settle-day';
import { submitPlanning } from './submit-planning';
import { submitPlay } from './submit-play';
import { submitRevise } from './submit-revise';

/** 用真实 ArchiveRepository 实现 RuntimeOperations 端口。 */
export function createArchiveRuntimeOperations(options: {
  archive: ArchiveRepository;
  clock?: RuntimeClock;
}): RuntimeOperations {
  const clock = options.clock ?? systemClock;
  return {
    prepareSessionStart: (request) => prepareSessionStart({ archive: options.archive, ...request }),
    submitSession: (request) => {
      switch (request.submission.kind) {
        case 'init': return initializeWorld({ archive: options.archive, ...request, submission: request.submission });
        case 'planning': return submitPlanning({ archive: options.archive, ...request, submission: request.submission });
        case 'play': return submitPlay({ archive: options.archive, ...request, submission: request.submission });
        case 'revise': return submitRevise({ archive: options.archive, ...request, submission: request.submission });
      }
    },
    cancelSession: (request) => cancelSession({ archive: options.archive, ...request }),
    executeStableCommand: (request) => request.command === 'settle'
      ? settleDay({ archive: options.archive, clock, ...request })
      : abandonDay({ archive: options.archive, clock, ...request }),
  };
}
