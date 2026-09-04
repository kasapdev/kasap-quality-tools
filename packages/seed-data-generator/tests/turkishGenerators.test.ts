import { describe, expect, it } from "vitest";
import {
  TURKISH_CITIES,
  TURKISH_FIRST_NAMES,
  TURKISH_LAST_NAMES,
  TURKISH_STREET_WORDS,
} from "../src/data/turkish.js";
import {
  pickFrom,
  randomTurkishAddress,
  randomTurkishCity,
  randomTurkishFirstName,
  randomTurkishLastName,
  randomTurkishPhone,
} from "../src/generators/turkish.js";

describe("Turkish generators", () => {
  it("randomTurkishFirstName always returns a non-empty string from the curated list", () => {
    for (let i = 0; i < 50; i++) {
      const name = randomTurkishFirstName();
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(TURKISH_FIRST_NAMES).toContain(name);
    }
  });

  it("randomTurkishLastName always returns a value from the curated list", () => {
    const name = randomTurkishLastName(() => 0.5);
    expect(TURKISH_LAST_NAMES).toContain(name);
  });

  it("randomTurkishCity always returns a value from the curated list", () => {
    const city = randomTurkishCity(() => 0.5);
    expect(TURKISH_CITIES).toContain(city);
  });

  it("pickFrom is exact and in-bounds at the rand()=0 boundary (first element)", () => {
    expect(pickFrom(TURKISH_FIRST_NAMES, () => 0)).toBe(TURKISH_FIRST_NAMES[0]);
  });

  it("pickFrom is exact and in-bounds at the rand()->1 boundary (last element, no off-by-one)", () => {
    // A value just under 1, and a pathological injected PRNG returning
    // exactly 1, must both resolve to the LAST element, never undefined.
    expect(pickFrom(TURKISH_FIRST_NAMES, () => 0.9999999999)).toBe(
      TURKISH_FIRST_NAMES[TURKISH_FIRST_NAMES.length - 1],
    );
    expect(pickFrom(TURKISH_FIRST_NAMES, () => 1)).toBe(TURKISH_FIRST_NAMES[TURKISH_FIRST_NAMES.length - 1]);
  });

  it("pickFrom walks a deterministic injected sequence to the exact expected indices", () => {
    const sequence = [0, 0.5, 0.999];
    let call = 0;
    const rand = () => sequence[call++] ?? 0;
    const arr = ["a", "b", "c", "d"];
    expect(pickFrom(arr, rand)).toBe("a"); // 0 * 4 = 0
    expect(pickFrom(arr, rand)).toBe("c"); // 0.5 * 4 = 2
    expect(pickFrom(arr, rand)).toBe("d"); // 0.999 * 4 = 3.996 -> floor 3
  });

  it("randomTurkishAddress produces a non-empty string containing a curated street word", () => {
    const address = randomTurkishAddress(() => 0.1);
    expect(address.length).toBeGreaterThan(0);
    const containsStreetWord = TURKISH_STREET_WORDS.some((word) => address.includes(word));
    expect(containsStreetWord).toBe(true);
  });

  it("randomTurkishPhone produces a +90 formatted number", () => {
    const phone = randomTurkishPhone(() => 0.2);
    expect(phone).toMatch(/^\+90 \d{3} \d{3} \d{2} \d{2}$/);
  });

  it("pickFrom throws a clear error on an empty array instead of returning undefined", () => {
    expect(() => pickFrom([], () => 0.5)).toThrow();
  });
});
