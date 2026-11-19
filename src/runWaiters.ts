/**
 * Callers waiting on a model run's outcome (the generation repair loop, art
 * import). Runs supersede each other: loading code also schedules a debounced
 * re-run, and a slider drag runs every frame. A superseded run must not strand
 * its waiters, so they stay queued and the run that finishes last settles them
 * all with its outcome
 */
export const createRunWaiters = <T>() => {
  let waiters: Array<(outcome: T) => void> = [];
  return {
    add(waiter?: (outcome: T) => void): void {
      if (waiter) waiters.push(waiter);
    },
    settle(outcome: T): void {
      const current = waiters;
      waiters = [];
      for (const waiter of current) waiter(outcome);
    },
  };
};
