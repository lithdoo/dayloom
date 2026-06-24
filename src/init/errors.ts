import type { InitSession } from './types';

export class InitCancelledError extends Error {
  readonly session?: InitSession;

  constructor(message = 'Init cancelled by user.', session?: InitSession) {
    super(message);
    this.name = 'InitCancelledError';
    this.session = session;
  }
}
