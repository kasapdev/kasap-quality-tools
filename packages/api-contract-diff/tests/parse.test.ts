import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, resolveSchema } from "../src/parse.js";
import type { OpenAPIDocument } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

describe("loadSpec", () => {
  it("parses a .json file with JSON.parse", () => {
    const doc = loadSpec(path.join(fixturesDir, "simple.json"));
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.paths?.["/ping"]?.get?.operationId).toBe("ping");
  });

  it("parses a .yaml file as YAML", () => {
    const doc = loadSpec(path.join(fixturesDir, "before-basic.yaml"));
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.paths?.["/users"]?.get?.operationId).toBe("listUsers");
  });
});

describe("resolveSchema", () => {
  const doc: OpenAPIDocument = {
    components: {
      schemas: {
        Foo: { type: "string" },
        Bar: { $ref: "#/components/schemas/Foo" },
      },
    },
  };

  it("returns a non-ref schema unchanged", () => {
    const schema = { type: "number" };
    expect(resolveSchema(doc, schema)).toBe(schema);
  });

  it("resolves a local #/components/schemas ref", () => {
    const resolved = resolveSchema(doc, { $ref: "#/components/schemas/Foo" });
    expect(resolved).toEqual({ type: "string" });
  });

  it("resolves a ref that itself points to another ref", () => {
    const resolved = resolveSchema(doc, { $ref: "#/components/schemas/Bar" });
    expect(resolved).toEqual({ type: "string" });
  });

  it("returns undefined for an unresolvable ref name", () => {
    expect(resolveSchema(doc, { $ref: "#/components/schemas/Missing" })).toBeUndefined();
  });

  it("returns undefined for an out-of-scope ref shape", () => {
    expect(resolveSchema(doc, { $ref: "#/components/parameters/Foo" })).toBeUndefined();
    expect(resolveSchema(doc, { $ref: "external.yaml#/Foo" })).toBeUndefined();
  });

  it("returns undefined instead of looping forever on a circular ref", () => {
    const circularDoc: OpenAPIDocument = {
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { $ref: "#/components/schemas/A" },
        },
      },
    };
    expect(resolveSchema(circularDoc, { $ref: "#/components/schemas/A" })).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(resolveSchema(doc, undefined)).toBeUndefined();
  });
});
