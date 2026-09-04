import { describe, expect, it } from "vitest";
import type { GeneratedData } from "../src/generate.js";
import { escapeSqlString, formatAsJson, formatAsSql } from "../src/output.js";

describe("escapeSqlString", () => {
  it("doubles single quotes", () => {
    expect(escapeSqlString("O'Brien")).toBe("O''Brien");
    expect(escapeSqlString("it's a 'test'")).toBe("it''s a ''test''");
    expect(escapeSqlString("no quotes here")).toBe("no quotes here");
  });
});

describe("formatAsJson", () => {
  it("pretty-prints one array of rows per model", () => {
    const data: GeneratedData = { User: [{ id: 1, name: "Ada" }] };
    const json = formatAsJson(data);
    expect(JSON.parse(json)).toEqual(data);
    expect(json).toContain("\n"); // pretty-printed, not minified
  });
});

describe("formatAsSql", () => {
  it("formats null, number, boolean, and string values correctly and escapes quotes", () => {
    const data: GeneratedData = {
      User: [
        { id: 1, name: "O'Brien", city: null, active: true, score: 3.5 },
        { id: 2, name: "Ayşe", city: "İstanbul", active: false, score: -1 },
      ],
    };
    const sql = formatAsSql(data);

    expect(sql).toContain('INSERT INTO "User" ("id", "name", "city", "active", "score") VALUES');
    expect(sql).toContain("(1, 'O''Brien', NULL, TRUE, 3.5)");
    expect(sql).toContain("(2, 'Ayşe', 'İstanbul', FALSE, -1)");
    expect(sql.trim().endsWith(";")).toBe(true);
  });

  it("emits one INSERT block per model, in the given key order", () => {
    const data: GeneratedData = {
      Parent: [{ id: 1 }],
      Child: [{ id: 1, parentId: 1 }],
    };
    const sql = formatAsSql(data);
    const parentIndex = sql.indexOf('INSERT INTO "Parent"');
    const childIndex = sql.indexOf('INSERT INTO "Child"');
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(childIndex).toBeGreaterThan(parentIndex);
  });

  it("emits a comment instead of an INSERT for a model with zero rows", () => {
    const data: GeneratedData = { Empty: [] };
    const sql = formatAsSql(data);
    expect(sql).toContain("No rows generated");
    expect(sql).not.toContain("INSERT INTO");
  });
});
