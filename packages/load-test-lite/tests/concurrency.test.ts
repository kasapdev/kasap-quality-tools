import { describe, expect, it } from "vitest";
import { runWithConcurrencyLimit } from "../src/concurrency.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runWithConcurrencyLimit", () => {
  it("returns results in task-index order even when tasks complete out of order", async () => {
    // Deliberately vary delays so that later-indexed tasks can finish
    // before earlier-indexed ones (e.g. task 0 is slow, task 1 is fast).
    const delays = [30, 5, 20, 1, 15, 10, 25, 2];

    const results = await runWithConcurrencyLimit(
      delays.length,
      3,
      async (taskIndex: number) => {
        const ms = delays[taskIndex] as number;
        await delay(ms);
        return taskIndex * 2;
      },
    );

    expect(results).toHaveLength(delays.length);
    expect(results).toEqual(delays.map((_, i) => i * 2));
  });

  it("never runs more than `concurrency` workers at once", async () => {
    const concurrency = 4;
    const totalTasks = 20;
    let live = 0;
    let maxLive = 0;

    await runWithConcurrencyLimit(totalTasks, concurrency, async () => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      // Small randomized delay so tasks genuinely overlap.
      await delay(5 + Math.floor(Math.random() * 10));
      live -= 1;
      return null;
    });

    expect(maxLive).toBeLessThanOrEqual(concurrency);
    expect(maxLive).toBeGreaterThan(0);
  });

  it("runs all tasks exactly once", async () => {
    const totalTasks = 37;
    const seen: number[] = [];

    await runWithConcurrencyLimit(totalTasks, 6, async (taskIndex: number) => {
      seen.push(taskIndex);
      return taskIndex;
    });

    expect(seen).toHaveLength(totalTasks);
    expect(new Set(seen).size).toBe(totalTasks);
  });

  it("catches a throwing worker and records the failure without aborting the run", async () => {
    const totalTasks = 6;
    const failingIndex = 2;
    const errors: Array<{ taskIndex: number; error: unknown }> = [];

    const results = await runWithConcurrencyLimit(
      totalTasks,
      2,
      async (taskIndex: number) => {
        if (taskIndex === failingIndex) {
          throw new Error("boom");
        }
        return taskIndex;
      },
      {
        onTaskError: (taskIndex, error) => {
          errors.push({ taskIndex, error });
        },
      },
    );

    // The whole run completes (does not reject / throw).
    expect(results).toHaveLength(totalTasks);
    // Every non-failing index still got its real result.
    for (let i = 0; i < totalTasks; i++) {
      if (i === failingIndex) {
        expect(results[i]).toBeUndefined();
      } else {
        expect(results[i]).toBe(i);
      }
    }
    // The failure was reported via the callback exactly once.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.taskIndex).toBe(failingIndex);
    expect((errors[0]?.error as Error).message).toBe("boom");
  });

  it("handles totalTasks of 0 by returning an empty array", async () => {
    const results = await runWithConcurrencyLimit(0, 5, async () => 1);
    expect(results).toEqual([]);
  });

  it("handles concurrency greater than totalTasks", async () => {
    const results = await runWithConcurrencyLimit(3, 100, async (i) => i);
    expect(results).toEqual([0, 1, 2]);
  });

  it("handles a negative totalTasks by returning an empty array", async () => {
    const results = await runWithConcurrencyLimit(-3, 5, async () => 1);
    expect(results).toEqual([]);
  });

  it("rejects when concurrency is zero", async () => {
    await expect(runWithConcurrencyLimit(5, 0, async (i) => i)).rejects.toThrow(
      "concurrency must be a positive integer",
    );
  });

  it("rejects when concurrency is negative", async () => {
    await expect(runWithConcurrencyLimit(5, -2, async (i) => i)).rejects.toThrow(
      "concurrency must be a positive integer",
    );
  });
});
