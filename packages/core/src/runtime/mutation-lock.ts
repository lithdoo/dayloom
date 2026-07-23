import { createRuntimeError } from '../errors';

/** Runtime mutation 使用的非排队独占锁。 */
export class RuntimeMutationLock {
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  async run<T>(mutation: () => Promise<T>): Promise<T> {
    if (this.active) throw createRuntimeError('RUNTIME_BUSY', 'Another Runtime mutation is active.');
    this.active = true;
    try {
      return await mutation();
    } finally {
      this.active = false;
    }
  }
}
