import type { CoreLogger } from '../infrastructure/logger';
import type { RuntimeEvent, RuntimeEventListener, RuntimeUnsubscribe } from '../types';

/** 保序、listener 异常隔离的 Runtime event broadcaster。 */
export class RuntimeEventBroadcaster {
  private readonly listeners = new Set<RuntimeEventListener>();

  constructor(private readonly logger: CoreLogger) {}

  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Runtime event listener failed.', error, { eventType: event.type });
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
