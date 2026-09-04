import { describe, expect, it } from "vitest";
import { diffComponentSchemas, diffPaths } from "../src/diffPaths.js";
import type { OpenAPIDocument } from "../src/types.js";

function categories(changes: { category: string }[]): string[] {
  return changes.map((c) => c.category);
}

describe("diffPaths - paths and operations", () => {
  it("flags a removed path as breaking and an added path as safe", () => {
    const before: OpenAPIDocument = { paths: { "/a": { get: { responses: {} } }, "/b": { get: { responses: {} } } } };
    const after: OpenAPIDocument = { paths: { "/a": { get: { responses: {} } }, "/c": { get: { responses: {} } } } };
    const changes = diffPaths(before, after);

    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "path-removed", path: "/b" }));
    expect(changes).toContainEqual(expect.objectContaining({ severity: "safe", category: "path-added", path: "/c" }));
  });

  it("flags a removed operation as breaking and an added operation as safe", () => {
    const before: OpenAPIDocument = { paths: { "/users": { get: { responses: {} }, delete: { responses: {} } } } };
    const after: OpenAPIDocument = { paths: { "/users": { get: { responses: {} }, patch: { responses: {} } } } };
    const changes = diffPaths(before, after);

    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "operation-removed", path: "DELETE /users" }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "safe", category: "operation-added", path: "PATCH /users" }),
    );
    expect(categories(changes)).not.toContain("path-removed");
  });
});

describe("diffPaths - parameters", () => {
  function withParams(params: Array<{ name: string; in: string; required?: boolean; schema?: { type: string } }>): OpenAPIDocument {
    return { paths: { "/users/{id}": { get: { parameters: params, responses: {} } } } };
  }

  it("flags a removed parameter as breaking, even if it was optional", () => {
    const before = withParams([{ name: "verbose", in: "query", required: false, schema: { type: "boolean" } }]);
    const after = withParams([]);
    const changes = diffPaths(before, after);
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "parameter-removed" }));
  });

  it("flags a new required parameter as breaking and a new optional parameter as safe", () => {
    const before = withParams([]);
    const afterRequired = withParams([{ name: "tenant", in: "query", required: true, schema: { type: "string" } }]);
    const afterOptional = withParams([{ name: "search", in: "query", required: false, schema: { type: "string" } }]);

    expect(diffPaths(before, afterRequired)).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "required-parameter-added" }),
    );
    expect(diffPaths(before, afterOptional)).toContainEqual(
      expect.objectContaining({ severity: "safe", category: "parameter-added" }),
    );
  });

  it("flags a parameter newly marked required as breaking", () => {
    const before = withParams([{ name: "id", in: "path", required: false, schema: { type: "string" } }]);
    const after = withParams([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
    const changes = diffPaths(before, after);
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "parameter-now-required" }));
  });

  it("flags a parameter's schema type change as breaking", () => {
    const before = withParams([{ name: "limit", in: "query", required: false, schema: { type: "integer" } }]);
    const after = withParams([{ name: "limit", in: "query", required: false, schema: { type: "string" } }]);
    const changes = diffPaths(before, after);
    expect(changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "parameter-type-changed" }));
  });
});

describe("diffPaths - request/response body wiring", () => {
  it("classifies a newly-required request field as breaking and a new optional response field as safe", () => {
    const before: OpenAPIDocument = {
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } }, required: [] } } },
            },
            responses: {
              "201": {
                content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } },
              },
            },
          },
        },
      },
    };
    const after: OpenAPIDocument = {
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
                },
              },
            },
            responses: {
              "201": {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "string" }, createdAt: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const changes = diffPaths(before, after);
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "field-now-required", path: "POST /users requestBody.properties.email" }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "safe", category: "property-added", path: "POST /users responses.201.properties.createdAt" }),
    );
  });
});

describe("diffComponentSchemas", () => {
  it("flags a removed component schema as breaking", () => {
    const before: OpenAPIDocument = { components: { schemas: { User: { type: "object" }, Deprecated: { type: "object" } } } };
    const after: OpenAPIDocument = { components: { schemas: { User: { type: "object" } } } };
    const changes = diffComponentSchemas(before, after);
    expect(changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "schema-removed", path: "components.schemas.Deprecated" }),
    );
  });

  it("does not flag schemas that still exist", () => {
    const before: OpenAPIDocument = { components: { schemas: { User: { type: "object" } } } };
    const after: OpenAPIDocument = { components: { schemas: { User: { type: "object" } } } };
    expect(diffComponentSchemas(before, after)).toEqual([]);
  });
});
