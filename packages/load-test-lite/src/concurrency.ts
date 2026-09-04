/**
 * A minimal worker-pool concurrency limiter.
 *
 * Runs `totalTasks` calls to `worker(taskIndex)`, ensuring at most
 * `concurrency` calls are in flight at any given time. Results are
 * returned in an array ordered by task index, regardless of the order
 * in which the individual tasks actually complete.
 *
 * Implementation: spawn `Math.min(concurrency, totalTasks)` "lanes". Each
 * lane is an async loop that pulls the next task index from a single
 * shared `next` counter and runs it. Because JavaScript is single
 * threaded, incrementing `next` synchronously (read-then-increment,
 * with no `await` in between) is safe from race conditions even though
 * multiple lanes are conceptually "concurrent" — the increment itself
 * is never interrupted by another lane.
 *
 * Error handling (documented behavior): a worker that throws does NOT
 * abort the whole run and does NOT abort other lanes. Each task is
 * wrapped in a try/catch inside the lane loop; if `worker` throws (or
 * its returned promise rejects), the error is caught, reported via the
 * optional `onTaskError` callback, and that task's slot in the results
 * array is left as `undefined` (cast to `T` — see note below). The lane
 * then continues on to its next task index instead of stopping.
 *
 * In this codebase, the `worker` used for real HTTP requests
 * (`sendRequest` in httpClient.ts) never throws — it always resolves
 * with a `RequestResult` that itself encodes success/failure (network
 * errors and timeouts become `{ ok: false, statusCode: null, error }`
 * results, not thrown exceptions). So the catch block here is a safety
 * net for unexpected bugs, not the primary error-handling path, and the
 * `undefined`-in-a-`T[]` slot it produces should not be reachable in
 * normal operation of this CLI.
 */
export interface RunWithConcurrencyLimitOptions {
  /** Called when a worker throws/rejects, before the lane moves on. */
  onTaskError?: (taskIndex: number, error: unknown) => void;
}

export async function runWithConcurrencyLimit<T>(
  totalTasks: number,
  concurrency: number,
  worker: (taskIndex: number) => Promise<T>,
  options: RunWithConcurrencyLimitOptions = {},
): Promise<T[]> {
  if (totalTasks <= 0) {
    return [];
  }
  if (concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }

  const results: T[] = new Array(totalTasks);
  const laneCount = Math.min(concurrency, totalTasks);

  let next = 0;

  async function lane(): Promise<void> {
    for (;;) {
      // Synchronous read-then-increment: safe because no `await`
      // occurs between reading `next` and incrementing it, so this
      // can't interleave with another lane's read of the same value.
      const taskIndex = next;
      if (taskIndex >= totalTasks) {
        return;
      }
      next += 1;

      try {
        results[taskIndex] = await worker(taskIndex);
      } catch (error) {
        options.onTaskError?.(taskIndex, error);
        // Safety-net slot for an unexpectedly-throwing worker; see the
        // module doc comment above. Real workers used by this CLI
        // never throw, so this cast should not be exercised.
        results[taskIndex] = undefined as unknown as T;
      }
    }
  }

  const lanes: Array<Promise<void>> = [];
  for (let i = 0; i < laneCount; i++) {
    lanes.push(lane());
  }

  await Promise.all(lanes);

  return results;
}
