import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/parse.js";
import { diffSpecs } from "../src/diff.js";
import type { Change } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

function find(changes: Change[], category: string, pathSubstring?: string): Change | undefined {
  return changes.find((c) => c.category === category && (pathSubstring === undefined || c.path.includes(pathSubstring)));
}

describe("api-contract-diff end-to-end (before-basic.yaml -> after-basic.yaml)", () => {
  const before = loadSpec(path.join(fixturesDir, "before-basic.yaml"));
  const after = loadSpec(path.join(fixturesDir, "after-basic.yaml"));
  const { breaking, safe } = diffSpecs(before, after);

  it("flags the removed path and removed operation as breaking", () => {
    expect(find(breaking, "path-removed", "/users/legacy")).toBeDefined();
    expect(find(breaking, "operation-removed", "DELETE /users/{id}")).toBeDefined();
  });

  it("flags the new path and new operation as safe", () => {
    expect(find(safe, "path-added", "/users/{id}/avatar")).toBeDefined();
    expect(find(safe, "operation-added", "PATCH /users/{id}")).toBeDefined();
  });

  it("flags the query parameter type change and the newly-required parameter as breaking, and the new optional parameter as safe", () => {
    expect(find(breaking, "parameter-type-changed", "query:limit")).toBeDefined();
    expect(find(breaking, "required-parameter-added", "query:tenant")).toBeDefined();
    expect(find(safe, "parameter-added", "query:search")).toBeDefined();
  });

  it("flags the removed User.nickname property as breaking and the new User.avatarUrl property as safe", () => {
    expect(find(breaking, "property-removed", "properties.nickname")).toBeDefined();
    expect(find(safe, "property-added", "properties.avatarUrl")).toBeDefined();
  });

  it("flags the removed enum value as breaking and the added enum value as safe", () => {
    const removed = find(breaking, "enum-value-removed", "properties.status");
    expect(removed?.before).toBe("banned");
    const added = find(safe, "enum-value-added", "properties.status");
    expect(added?.after).toBe("pending");
  });

  it("flags NewUser.password newly required as breaking", () => {
    expect(find(breaking, "field-now-required", "requestBody.properties.password")).toBeDefined();
  });

  it("flags the tightened NewUser.email maxLength as breaking", () => {
    const change = find(breaking, "maxLength-tightened", "requestBody.properties.email");
    expect(change).toBeDefined();
    expect(change?.before).toBe(255);
    expect(change?.after).toBe(100);
  });

  it("flags the removed NewUser.referralCode property as breaking and the new marketingOptIn property as safe", () => {
    expect(find(breaking, "property-removed", "requestBody.properties.referralCode")).toBeDefined();
    expect(find(safe, "property-added", "requestBody.properties.marketingOptIn")).toBeDefined();
  });

  it("flags the removed Deprecated component schema as breaking", () => {
    expect(find(breaking, "schema-removed", "components.schemas.Deprecated")).toBeDefined();
  });

  it("produces a non-empty breaking set, matching the CLI's non-zero exit code contract", () => {
    expect(breaking.length).toBeGreaterThan(0);
  });
});
