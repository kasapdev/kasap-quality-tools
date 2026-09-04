/**
 * Latency statistics over a set of request latencies (milliseconds).
 */
export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
}

const ZERO_STATS: LatencyStats = {
  count: 0,
  min: 0,
  max: 0,
  mean: 0,
  p50: 0,
  p90: 0,
  p99: 0,
};

/**
 * Percentile method: NEAREST-RANK.
 *
 * For a sorted (ascending) array of `n` values and a percentile `p`
 * (0-100), the nearest-rank index is:
 *
 *   index = ceil((p / 100) * n) - 1
 *
 * clamped to the valid range `[0, n - 1]`. This picks an actual element
 * from the data set (no interpolation between two values), which is a
 * simple, standard, and unambiguous definition of "the p-th percentile"
 * commonly used by load-testing tools.
 *
 * Example: n = 100, p = 50 -> ceil(0.5 * 100) - 1 = 49 (0-indexed),
 * i.e. the 50th smallest value out of 100.
 *
 * Edge cases:
 * - Empty input: returns all-zero stats (`count: 0`) rather than
 *   throwing, so a load-test run with zero completed requests still
 *   produces a printable report.
 * - Single-element input: every percentile equals that one value.
 *
 * The input array is never mutated: a copy is sorted internally.
 */
export function computeLatencyStats(latenciesMs: number[]): LatencyStats {
  const n = latenciesMs.length;
  if (n === 0) {
    return { ...ZERO_STATS };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);

  const min = sorted[0] as number;
  const max = sorted[n - 1] as number;

  let sum = 0;
  for (const value of sorted) {
    sum += value;
  }
  const mean = sum / n;

  return {
    count: n,
    min,
    max,
    mean,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
  };
}

/**
 * Nearest-rank percentile lookup on an ALREADY-SORTED-ASCENDING array.
 */
function percentile(sortedAscending: number[], p: number): number {
  const n = sortedAscending.length;
  const rawIndex = Math.ceil((p / 100) * n) - 1;
  const clampedIndex = Math.min(Math.max(rawIndex, 0), n - 1);
  return sortedAscending[clampedIndex] as number;
}
