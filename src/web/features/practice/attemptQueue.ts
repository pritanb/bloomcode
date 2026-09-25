import type { Attempt } from '../../../shared/contracts';
/** A single lane for every write to an attempt. Never capture a version before joining the lane. */
export class AttemptQueue {
  private tail: Promise<unknown> = Promise.resolve();
  error: unknown = null;
  constructor(public current: Attempt) {}
  clearError() {
    this.error = null;
  }
  run(operation: (current: Attempt) => Promise<Attempt>): Promise<Attempt> {
    const next = this.tail.then(async () => {
      if (this.error) throw this.error;
      try {
        const committed = await operation(this.current);
        this.current = committed;
        return committed;
      } catch (error) {
        this.error = error;
        throw error;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}
