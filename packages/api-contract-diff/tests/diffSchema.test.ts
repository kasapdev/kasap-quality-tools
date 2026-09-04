import { describe, expect, it } from "vitest";
import { diffSchema } from "../src/diffSchema.js";
import type { DiffCtx, SchemaContext } from "../src/diffSchema.js";
import type { OpenAPIDocument, SchemaObject } from "../src/types.js";

function ctx(mode: SchemaContext, beforeDoc: OpenAPIDocument = {}, afterDoc: OpenAPIDocument = {}): DiffCtx {
  return { beforeDoc, afterDoc, mode };
}

function categories(changes: { category: string }[]): string[] {
  return changes.map((c) => c.category);
}

describe("diffSchema - type changes", () => {
  it("flags a changed primitive type as breaking", () => {
    const before: SchemaObject = { type: "string" };
    const after: SchemaObject = { type: "number" };
    const changes = diffSchema(before, after, "field", ctx("request"));
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "type-changed", path: "field" }),
    );
  });

  it("does not flag an unchanged type", () => {
    const before: SchemaObject = { type: "string" };
    const after: SchemaObject = { type: "string" };
    const changes = diffSchema(before, after, "field", ctx("request"));
    expect(categories(changes)).not.toContain("type-changed");
  });
});

describe("diffSchema - enum", () => {
  it("flags a removed enum value as breaking and an added one as safe", () => {
    const before: SchemaObject = { type: "string", enum: ["a", "b", "c"] };
    const after: SchemaObject = { type: "string", enum: ["a", "c", "d"] };
    const changes = diffSchema(before, after, "status", ctx("request"));

    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "enum-value-removed", before: "b" }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "safe", category: "enum-value-added", after: "d" }),
    );
  });
});

describe("diffSchema - string/number constraints", () => {
  it("flags a decreased maxLength as breaking and an increased one as safe", () => {
    const tightened = diffSchema({ type: "string", maxLength: 255 }, { type: "string", maxLength: 100 }, "email", ctx("request"));
    expect(tightened).toContainEqual(expect.objectContaining({ severity: "breaking", category: "maxLength-tightened" }));

    const loosened = diffSchema({ type: "string", maxLength: 100 }, { type: "string", maxLength: 255 }, "email", ctx("request"));
    expect(loosened).toContainEqual(expect.objectContaining({ severity: "safe", category: "maxLength-loosened" }));
  });

  it("flags an increased minimum as breaking and a decreased one as safe", () => {
    const tightened = diffSchema({ type: "integer", minimum: 0 }, { type: "integer", minimum: 5 }, "age", ctx("request"));
    expect(tightened).toContainEqual(expect.objectContaining({ severity: "breaking", category: "minimum-tightened" }));

    const loosened = diffSchema({ type: "integer", minimum: 5 }, { type: "integer", minimum: 0 }, "age", ctx("request"));
    expect(loosened).toContainEqual(expect.objectContaining({ severity: "safe", category: "minimum-loosened" }));
  });

  it("flags an increased minLength as breaking and a decreased one as safe", () => {
    const tightened = diffSchema({ type: "string", minLength: 0 }, { type: "string", minLength: 8 }, "password", ctx("request"));
    expect(tightened).toContainEqual(expect.objectContaining({ severity: "breaking", category: "minLength-tightened" }));

    const loosened = diffSchema({ type: "string", minLength: 8 }, { type: "string", minLength: 0 }, "password", ctx("request"));
    expect(loosened).toContainEqual(expect.objectContaining({ severity: "safe", category: "minLength-loosened" }));
  });

  it("flags a decreased maximum as breaking and an increased one as safe", () => {
    const tightened = diffSchema({ type: "integer", maximum: 100 }, { type: "integer", maximum: 10 }, "count", ctx("request"));
    expect(tightened).toContainEqual(expect.objectContaining({ severity: "breaking", category: "maximum-tightened" }));

    const loosened = diffSchema({ type: "integer", maximum: 10 }, { type: "integer", maximum: 100 }, "count", ctx("request"));
    expect(loosened).toContainEqual(expect.objectContaining({ severity: "safe", category: "maximum-loosened" }));
  });

  it("flags an added/changed pattern as breaking and a removed pattern as safe", () => {
    const added = diffSchema({ type: "string" }, { type: "string", pattern: "^[a-z]+$" }, "code", ctx("request"));
    expect(added).toContainEqual(expect.objectContaining({ severity: "breaking", category: "pattern-changed" }));

    const removed = diffSchema({ type: "string", pattern: "^[a-z]+$" }, { type: "string" }, "code", ctx("request"));
    expect(removed).toContainEqual(expect.objectContaining({ severity: "safe", category: "pattern-loosened" }));
  });
});

describe("diffSchema - object properties (request mode)", () => {
  it("flags a removed property as breaking", () => {
    const before: SchemaObject = { type: "object", properties: { nickname: { type: "string" } } };
    const after: SchemaObject = { type: "object", properties: {} };
    const changes = diffSchema(before, after, "User", ctx("request"));
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "property-removed", path: "User.properties.nickname" }),
    );
  });

  it("flags a new optional property as safe", () => {
    const before: SchemaObject = { type: "object", properties: {} };
    const after: SchemaObject = { type: "object", properties: { avatarUrl: { type: "string" } } };
    const changes = diffSchema(before, after, "User", ctx("request"));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "safe", category: "property-added" }));
  });

  it("flags a new required property as breaking", () => {
    const before: SchemaObject = { type: "object", properties: {} };
    const after: SchemaObject = {
      type: "object",
      properties: { password: { type: "string" } },
      required: ["password"],
    };
    const changes = diffSchema(before, after, "NewUser", ctx("request"));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "required-property-added" }));
  });

  it("flags a field newly marked required as breaking, and newly optional as safe", () => {
    const before: SchemaObject = { type: "object", properties: { password: { type: "string" } }, required: [] };
    const after: SchemaObject = { type: "object", properties: { password: { type: "string" } }, required: ["password"] };
    const nowRequired = diffSchema(before, after, "NewUser", ctx("request"));
    expect(nowRequired).toContainEqual(expect.objectContaining({ severity: "breaking", category: "field-now-required" }));

    const nowOptional = diffSchema(after, before, "NewUser", ctx("request"));
    expect(nowOptional).toContainEqual(expect.objectContaining({ severity: "safe", category: "field-now-optional" }));
  });
});

describe("diffSchema - object properties (response mode)", () => {
  it("still flags a removed property as breaking", () => {
    const before: SchemaObject = { type: "object", properties: { id: { type: "string" } } };
    const after: SchemaObject = { type: "object", properties: {} };
    const changes = diffSchema(before, after, "User", ctx("response"));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "property-removed" }));
  });

  it("flags a field dropped from required as breaking, and newly required as safe", () => {
    const before: SchemaObject = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
    const after: SchemaObject = { type: "object", properties: { id: { type: "string" } }, required: [] };
    const droppedFromRequired = diffSchema(before, after, "User", ctx("response"));
    expect(droppedFromRequired).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "field-no-longer-guaranteed" }),
    );

    const addedToRequired = diffSchema(after, before, "User", ctx("response"));
    expect(addedToRequired).toContainEqual(expect.objectContaining({ severity: "safe", category: "field-now-guaranteed" }));
  });

  it("flags a new optional-looking response field as safe (not required-added-as-breaking)", () => {
    const before: SchemaObject = { type: "object", properties: {} };
    const after: SchemaObject = {
      type: "object",
      properties: { newField: { type: "string" } },
      required: ["newField"],
    };
    const changes = diffSchema(before, after, "User", ctx("response"));
    // In response mode a newly-required field is a stronger guarantee, not a breaking removal.
    expect(changes).toContainEqual(expect.objectContaining({ severity: "safe", category: "property-added" }));
    expect(categories(changes)).not.toContain("required-property-added");
  });
});

describe("diffSchema - additionalProperties", () => {
  it("flags additionalProperties true -> false as breaking", () => {
    const changes = diffSchema(
      { type: "object", additionalProperties: true },
      { type: "object", additionalProperties: false },
      "Body",
      ctx("request"),
    );
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "additional-properties-disallowed" }));
  });

  it("flags additionalProperties unset -> false as breaking", () => {
    const changes = diffSchema({ type: "object" }, { type: "object", additionalProperties: false }, "Body", ctx("request"));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "additional-properties-disallowed" }));
  });

  it("does not flag additionalProperties false -> true", () => {
    const changes = diffSchema(
      { type: "object", additionalProperties: false },
      { type: "object", additionalProperties: true },
      "Body",
      ctx("request"),
    );
    expect(categories(changes)).not.toContain("additional-properties-disallowed");
  });
});

describe("diffSchema - array items", () => {
  it("recurses into items and reports nested changes with a []-suffixed path", () => {
    const before: SchemaObject = { type: "array", items: { type: "string" } };
    const after: SchemaObject = { type: "array", items: { type: "number" } };
    const changes = diffSchema(before, after, "tags", ctx("request"));
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "type-changed", path: "tags[]" }),
    );
  });
});

describe("diffSchema - $ref resolution", () => {
  it("resolves refs on both sides before comparing, even when the referenced schema differs across documents", () => {
    const beforeDoc: OpenAPIDocument = {
      components: { schemas: { Status: { type: "string", enum: ["active", "banned"] } } },
    };
    const afterDoc: OpenAPIDocument = {
      components: { schemas: { Status: { type: "string", enum: ["active", "pending"] } } },
    };
    const changes = diffSchema(
      { $ref: "#/components/schemas/Status" },
      { $ref: "#/components/schemas/Status" },
      "User.properties.status",
      ctx("response", beforeDoc, afterDoc),
    );
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "enum-value-removed", before: "banned" }));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "safe", category: "enum-value-added", after: "pending" }));
  });

  it("returns no changes when a ref cannot be resolved on either side", () => {
    const changes = diffSchema(
      { $ref: "#/components/schemas/Missing" },
      { type: "string" },
      "x",
      ctx("request"),
    );
    expect(changes).toEqual([]);
  });
});

describe("diffSchema - allOf composition (best-effort)", () => {
  it("flattens allOf branches so nested required/property changes are still detected", () => {
    const beforeDoc: OpenAPIDocument = {
      components: {
        schemas: {
          Base: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
      },
    };
    const afterDoc: OpenAPIDocument = {
      components: {
        schemas: {
          Base: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
      },
    };
    const before: SchemaObject = {
      allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", properties: { email: { type: "string" } } }],
    };
    const after: SchemaObject = {
      allOf: [
        { $ref: "#/components/schemas/Base" },
        { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
      ],
    };
    const changes = diffSchema(before, after, "NewUser", ctx("request", beforeDoc, afterDoc));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "field-now-required", path: "NewUser.properties.email" }));
  });
});
