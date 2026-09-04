import { describe, expect, it } from "vitest";
import { orderModelsByDependency, type ParsedSchema } from "../src/schema.js";

describe("orderModelsByDependency", () => {
  it("orders a parent model before its child (FK relation)", () => {
    const schema: ParsedSchema = {
      enums: [],
      models: [
        {
          name: "Post",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
            { name: "authorId", type: "Int", isArray: false, isOptional: false, attributes: {} },
            {
              name: "author",
              type: "User",
              isArray: false,
              isOptional: false,
              attributes: { relation: { fields: ["authorId"], references: ["id"] } },
            },
          ],
        },
        {
          name: "User",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
            { name: "posts", type: "Post", isArray: true, isOptional: false, attributes: {} },
          ],
        },
      ],
    };

    const order = orderModelsByDependency(schema).map((m) => m.name);
    expect(order.indexOf("User")).toBeLessThan(order.indexOf("Post"));
    expect(order).toEqual(["User", "Post"]);
  });

  it("keeps a stable, complete order when there are no relations", () => {
    const schema: ParsedSchema = {
      enums: [],
      models: [
        { name: "Alpha", fields: [{ name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } }] },
        { name: "Beta", fields: [{ name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } }] },
        { name: "Gamma", fields: [{ name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } }] },
      ],
    };

    const order = orderModelsByDependency(schema).map((m) => m.name);
    expect(order).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("handles a 3-model chain (Grandparent -> Parent -> Child) in correct order", () => {
    const schema: ParsedSchema = {
      enums: [],
      models: [
        {
          name: "Child",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
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
        {
          name: "Grandparent",
          fields: [{ name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } }],
        },
        {
          name: "Parent",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
            { name: "grandparentId", type: "Int", isArray: false, isOptional: false, attributes: {} },
            {
              name: "grandparent",
              type: "Grandparent",
              isArray: false,
              isOptional: false,
              attributes: { relation: { fields: ["grandparentId"], references: ["id"] } },
            },
          ],
        },
      ],
    };

    const order = orderModelsByDependency(schema).map((m) => m.name);
    expect(order.indexOf("Grandparent")).toBeLessThan(order.indexOf("Parent"));
    expect(order.indexOf("Parent")).toBeLessThan(order.indexOf("Child"));
  });

  it("does not infinite-loop or crash on a relation cycle", () => {
    const schema: ParsedSchema = {
      enums: [],
      models: [
        {
          name: "A",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
            { name: "bId", type: "Int", isArray: false, isOptional: false, attributes: {} },
            {
              name: "b",
              type: "B",
              isArray: false,
              isOptional: false,
              attributes: { relation: { fields: ["bId"], references: ["id"] } },
            },
          ],
        },
        {
          name: "B",
          fields: [
            { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true } },
            { name: "aId", type: "Int", isArray: false, isOptional: false, attributes: {} },
            {
              name: "a",
              type: "A",
              isArray: false,
              isOptional: false,
              attributes: { relation: { fields: ["aId"], references: ["id"] } },
            },
          ],
        },
      ],
    };

    const order = orderModelsByDependency(schema).map((m) => m.name);
    expect(order).toHaveLength(2);
    expect(new Set(order)).toEqual(new Set(["A", "B"]));
  });
});
