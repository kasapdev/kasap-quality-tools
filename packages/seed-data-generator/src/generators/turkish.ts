import {
  GENERIC_WORDS,
  TURKISH_CITIES,
  TURKISH_FIRST_NAMES,
  TURKISH_LAST_NAMES,
  TURKISH_STREET_WORDS,
} from "../data/turkish.js";

/** A PRNG function returning a float in [0, 1), like `Math.random`. Injectable for deterministic tests. */
export type RandomFn = () => number;

/**
 * Picks an element from `arr` using `rand()`. Clamps the computed index into
 * `[0, arr.length - 1]` so a `rand()` value at or very near 1 (or an
 * injected test double that returns exactly 1) can never index out of
 * bounds and produce `undefined`.
 */
export function pickFrom<T>(arr: readonly T[], rand: RandomFn = Math.random): T {
  if (arr.length === 0) {
    throw new Error("pickFrom() called with an empty array");
  }
  const rawIndex = Math.floor(rand() * arr.length);
  const index = Math.min(arr.length - 1, Math.max(0, rawIndex));
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`pickFrom() computed out-of-bounds index ${index} for array of length ${arr.length}`);
  }
  return value;
}

export function randomTurkishFirstName(rand: RandomFn = Math.random): string {
  return pickFrom(TURKISH_FIRST_NAMES, rand);
}

export function randomTurkishLastName(rand: RandomFn = Math.random): string {
  return pickFrom(TURKISH_LAST_NAMES, rand);
}

export function randomTurkishCity(rand: RandomFn = Math.random): string {
  return pickFrom(TURKISH_CITIES, rand);
}

function randomDigit(rand: RandomFn): number {
  return Math.min(9, Math.max(0, Math.floor(rand() * 10)));
}

function randomIntInRange(min: number, max: number, rand: RandomFn): number {
  const span = max - min + 1;
  return min + Math.min(span - 1, Math.floor(rand() * span));
}

/** Generates a plausible Turkish mobile phone number, e.g. "+90 532 123 45 67". */
export function randomTurkishPhone(rand: RandomFn = Math.random): string {
  const operatorPrefixes = ["530", "531", "532", "533", "535", "536", "541", "542", "543", "544", "555"];
  const prefix = pickFrom(operatorPrefixes, rand);
  const part1 = `${randomDigit(rand)}${randomDigit(rand)}${randomDigit(rand)}`;
  const part2 = `${randomDigit(rand)}${randomDigit(rand)}`;
  const part3 = `${randomDigit(rand)}${randomDigit(rand)}`;
  return `+90 ${prefix} ${part1} ${part2} ${part3}`;
}

/**
 * Generates a plausible Turkish street address by combining a small set of
 * curated street-name words with common address patterns.
 */
export function randomTurkishAddress(rand: RandomFn = Math.random): string {
  const streetWord = pickFrom(TURKISH_STREET_WORDS, rand);
  const houseNo = randomIntInRange(1, 150, rand);

  const patterns: Array<() => string> = [
    () => `${streetWord} Sokak No: ${houseNo}`,
    () => `${streetWord} Caddesi No: ${houseNo} Daire: ${randomIntInRange(1, 20, rand)}`,
    () => {
      const neighborhoodWord = pickFrom(TURKISH_STREET_WORDS, rand);
      return `${neighborhoodWord} Mahallesi ${streetWord} Sokak No: ${houseNo}`;
    },
  ];

  const pattern = pickFrom(patterns, rand);
  return pattern();
}

/** Generic non-Turkish-specific fallback word, used for unrecognized string fields. */
export function randomGenericWord(rand: RandomFn = Math.random): string {
  return pickFrom(GENERIC_WORDS, rand);
}
