import { describe, expect, it } from "vitest";
import { generateSeedData } from "../src/generate.js";
import type { ParsedSchema } from "../src/schema.js";

describe("generateSeedData", () => {
  const schema: ParsedSchema = {
    enums: [{ name: "Status", values: ["ACTIVE", "INACTIVE"] }],
    models: [
      {
        name: "Parent",
        fields: [
          { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true, default: "autoincrement()" } },
          // "name" maps to the firstName heuristic, which only has ~30
          // possible values -- with count 500 this WILL collide under naive
          // random generation, exercising the real uniqueness-guarantee path.
          { name: "name", type: "String", isArray: false, isOptional: false, attributes: { unique: true } },
          { name: "status", type: "Status", isArray: false, isOptional: false, attributes: {} },
          { name: "children", type: "Child", isArray: true, isOptional: false, attributes: {} },
        ],
      },
      {
        name: "Child",
        fields: [
          { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true, default: "autoincrement()" } },
          { name: "parentId", type: "Int", isArray: false, isOptional: false, attributes: {} },
          {
            name: "parent",
            type: "Parent",
            isArray: false,
            isOptional: false,
            attributes: { relation: { fields: ["parentId"], references: ["id"] } },
          },
        ],
      },
    ],
  };

  it("guarantees real uniqueness for a @unique String field even against a tiny random space", () => {
    const data = generateSeedData(schema, { count: 500 });
    const names = data["Parent"]?.map((row) => row["name"]) ?? [];
    expect(names).toHaveLength(500);
    expect(new Set(names).size).toBe(500);
  });

  it("generates sequential ids starting at 1 for autoincrement Int @id fields", () => {
    const data = generateSeedData(schema, { count: 500 });
    const ids = data["Parent"]?.map((row) => row["id"]) ?? [];
    expect(ids).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
  });

  it("only ever produces declared enum values", () => {
    const data = generateSeedData(schema, { count: 500 });
    const statuses = data["Parent"]?.map((row) => row["status"]) ?? [];
    for (const status of statuses) {
      expect(["ACTIVE", "INACTIVE"]).toContain(status);
    }
  });

  it("populates FK scalar fields with an id that exists among the generated parent rows", () => {
    const data = generateSeedData(schema, { count: 50 });
    const parentIds = new Set((data["Parent"] ?? []).map((row) => row["id"]));
    const children = data["Child"] ?? [];
    expect(children).toHaveLength(50);
    for (const child of children) {
      expect(parentIds.has(child["parentId"])).toBe(true);
    }
  });

  it("does not generate a column for has-many list fields or the belongs-to relation object field", () => {
    const data = generateSeedData(schema, { count: 3 });
    const parentRow = data["Parent"]?.[0];
    const childRow = data["Child"]?.[0];
    expect(parentRow).toBeDefined();
    expect(childRow).toBeDefined();
    expect(parentRow && "children" in parentRow).toBe(false);
    expect(childRow && "parent" in childRow).toBe(false);
  });

  it("throws a clear error when a child's referenced parent model has no generated rows", () => {
    // Only "Child" is present -- its @relation points at "Parent", which
    // doesn't exist in this schema at all, so generated["Parent"] is
    // undefined when Child tries to draw an FK value.
    const orphanSchema: ParsedSchema = {
      enums: [],
      models: [schema.models[1]!],
    };
    expect(() => generateSeedData(orphanSchema, { count: 5 })).toThrow(/parent model "Parent" has no generated rows/);
  });

  it("produces no rows for any model when count is 0", () => {
    const data = generateSeedData(schema, { count: 0 });
    expect(data).toEqual({ Parent: [], Child: [] });
  });
});
