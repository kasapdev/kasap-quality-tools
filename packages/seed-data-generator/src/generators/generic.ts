import crypto from "node:crypto";
import {
  pickFrom,
  randomGenericWord,
  randomTurkishAddress,
  randomTurkishCity,
  randomTurkishFirstName,
  randomTurkishLastName,
  randomTurkishPhone,
  type RandomFn,
} from "./turkish.js";

export type { RandomFn };

export function randomBoolean(rand: RandomFn = Math.random): boolean {
  return rand() < 0.5;
}

/** Random integer in [min, max], inclusive. */
export function randomInt(min: number, max: number, rand: RandomFn = Math.random): number {
  const span = max - min + 1;
  return min + Math.min(span - 1, Math.max(0, Math.floor(rand() * span)));
}

/** Random float in [min, max], rounded to `decimals` places. */
export function randomFloat(min: number, max: number, decimals = 2, rand: RandomFn = Math.random): number {
  const value = min + rand() * (max - min);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Random ISO-8601 timestamp within the last `monthsBack` months (default ~2 years) up to now. */
export function randomDateIso(rand: RandomFn = Math.random, monthsBack = 24): string {
  const now = Date.now();
  const msBack = monthsBack * 30 * 24 * 60 * 60 * 1000;
  const offset = Math.floor(rand() * msBack);
  return new Date(now - offset).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomUuid(): string {
  return crypto.randomUUID();
}

/** Folds common Turkish diacritics to plain ASCII (for slug/email generation). */
export function asciiFold(input: string): string {
  const map: Record<string, string> = {
    ç: "c",
    Ç: "C",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ö: "o",
    Ö: "O",
    ş: "s",
    Ş: "S",
    ü: "u",
    Ü: "U",
  };
  return input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => map[ch] ?? ch);
}

export function randomEmail(rand: RandomFn = Math.random): string {
  const first = asciiFold(randomTurkishFirstName(rand)).toLowerCase();
  const last = asciiFold(randomTurkishLastName(rand)).toLowerCase();
  const suffix = randomInt(1, 999, rand);
  return `${first}.${last}${suffix}@example.com`;
}

/** Short pseudo-word/slug used as the generic fallback for unrecognized string fields. */
export function randomGenericString(rand: RandomFn = Math.random): string {
  const word = randomGenericWord(rand);
  const suffix = randomInt(100, 999, rand);
  return `${word}-${suffix}`;
}

/**
 * Splits a field name into lowercase tokens for heuristic matching, e.g.
 * "firstName" -> ["first", "name"], "first_name" -> ["first", "name"],
 * "authorId" -> ["author", "id"].
 */
export function tokenizeFieldName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s-]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

export type StringHeuristic = "email" | "firstName" | "lastName" | "city" | "address" | "phone" | "generic";

/** Case-insensitive field-name heuristic dispatcher, used to pick a String generator. */
export function classifyStringFieldName(fieldName: string): StringHeuristic {
  const tokens = tokenizeFieldName(fieldName);
  const has = (t: string) => tokens.includes(t);

  if (has("email") || has("mail")) return "email";
  if (has("last") || has("surname") || has("soyad") || has("soyisim")) return "lastName";
  if (has("first") || (has("name") && tokens.length === 1)) return "firstName";
  if (has("name") && !has("user") && !has("class") && !has("model")) return "firstName";
  if (has("city") || has("sehir") || has("il")) return "city";
  if (has("address") || has("adres") || has("street") || has("sokak")) return "address";
  if (has("phone") || has("telefon") || has("tel")) return "phone";
  return "generic";
}

export function generateStringByHeuristic(fieldName: string, rand: RandomFn = Math.random): string {
  const kind = classifyStringFieldName(fieldName);
  switch (kind) {
    case "email":
      return randomEmail(rand);
    case "firstName":
      return randomTurkishFirstName(rand);
    case "lastName":
      return randomTurkishLastName(rand);
    case "city":
      return randomTurkishCity(rand);
    case "address":
      return randomTurkishAddress(rand);
    case "phone":
      return randomTurkishPhone(rand);
    case "generic":
    default:
      return randomGenericString(rand);
  }
}

export type NumberHeuristic = "age" | "money" | "generic";

export function classifyNumberFieldName(fieldName: string): NumberHeuristic {
  const tokens = tokenizeFieldName(fieldName);
  const has = (t: string) => tokens.includes(t);
  if (has("age") || has("yas")) return "age";
  if (has("price") || has("amount") || has("cost") || has("total") || has("fiyat") || has("tutar")) return "money";
  return "generic";
}

/** Generates a plausible number for an Int/Float/Decimal/BigInt field, guided by the field name. */
export function generateNumberByHeuristic(
  fieldName: string,
  numericType: "Int" | "Float" | "Decimal" | "BigInt",
  rand: RandomFn = Math.random,
): number {
  const kind = classifyNumberFieldName(fieldName);
  const isDecimalLike = numericType === "Float" || numericType === "Decimal";

  if (kind === "age") {
    return randomInt(1, 90, rand);
  }
  if (kind === "money") {
    return isDecimalLike ? randomFloat(1, 10000, 2, rand) : randomInt(1, 10000, rand);
  }
  return isDecimalLike ? randomFloat(0, 1000, 2, rand) : randomInt(1, 100000, rand);
}

/**
 * Guarantees uniqueness of generated string values for a single field across
 * one generation run. Strategy: try the supplied candidate factory a few
 * times (real random retries); if it keeps colliding, fall back to
 * appending an incrementing numeric counter to the last candidate to
 * GUARANTEE a fresh value rather than looping indefinitely.
 */
export class UniqueValueTracker {
  private readonly seen = new Set<string>();
  private counter = 0;

  take(candidateFactory: () => string, maxRandomRetries = 5): string {
    for (let attempt = 0; attempt < maxRandomRetries; attempt++) {
      const candidate = candidateFactory();
      if (!this.seen.has(candidate)) {
        this.seen.add(candidate);
        return candidate;
      }
    }
    // Guaranteed-fresh fallback: keep suffixing an incrementing counter.
    const base = candidateFactory();
    let fallback = `${base}-${this.counter}`;
    while (this.seen.has(fallback)) {
      this.counter++;
      fallback = `${base}-${this.counter}`;
    }
    this.counter++;
    this.seen.add(fallback);
    return fallback;
  }
}
