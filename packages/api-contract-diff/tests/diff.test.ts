import { describe, expect, it } from "vitest";
import { diffSpecs } from "../src/diff.js";
import type { OpenAPIDocument } from "../src/types.js";

describe("diffSpecs", () => {
  it("partitions changes into breaking and safe buckets", () => {
    const before: OpenAPIDocument = {
      paths: { "/a": { get: { responses: {} } }, "/b": { get: { responses: {} } } },
      components: { schemas: { Old: { type: "object" } } },
    };
    const after: OpenAPIDocument = {
      paths: { "/a": { get: { responses: {} } }, "/c": { get: { responses: {} } } },
      components: { schemas: {} },
    };

    const { breaking, safe } = diffSpecs(before, after);

    expect(breaking.some((c) => c.category === "path-removed" && c.path === "/b")).toBe(true);
    expect(breaking.some((c) => c.category === "schema-removed")).toBe(true);
    expect(safe.some((c) => c.category === "path-added" && c.path === "/c")).toBe(true);

    for (const change of breaking) {
      expect(change.severity).toBe("breaking");
    }
    for (const change of safe) {
      expect(change.severity).toBe("safe");
    }
  });

  it("returns empty buckets for two identical specs", () => {
    const doc: OpenAPIDocument = { paths: { "/a": { get: { responses: {} } } } };
    const { breaking, safe } = diffSpecs(doc, structuredClone(doc));
    expect(breaking).toEqual([]);
    expect(safe).toEqual([]);
  });
});
