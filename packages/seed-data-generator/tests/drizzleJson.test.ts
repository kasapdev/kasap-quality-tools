import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDrizzleJson } from "../src/drizzleJson.js";
import { parsePrismaSchema } from "../src/prismaParser.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseDrizzleJson", () => {
  it("produces the exact same ParsedSchema shape as the equivalent Prisma fixture", () => {
    const fromJson = parseDrizzleJson(fixture("blog.json"));
    const fromPrisma = parsePrismaSchema(fixture("blog.prisma"));
    expect(fromJson).toEqual(fromPrisma);
  });

  it("fills in sensible defaults for missing optional attribute fields", () => {
    const schema = parseDrizzleJson(
      JSON.stringify({
        models: [
          {
            name: "Simple",
            fields: [{ name: "id", type: "Int" }],
          },
        ],
      }),
    );
    expect(schema.enums).toEqual([]);
    expect(schema.models).toEqual([
      {
        name: "Simple",
        fields: [{ name: "id", type: "Int", isArray: false, isOptional: false, attributes: {} }],
      },
    ]);
  });

  it("throws a clear error on malformed JSON", () => {
    expect(() => parseDrizzleJson("{ not valid json")).toThrow();
  });

  it("throws a clear error when models is missing", () => {
    expect(() => parseDrizzleJson(JSON.stringify({ enums: [] }))).toThrow(/models/);
  });
});
