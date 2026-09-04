import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePrismaSchema } from "../src/prismaParser.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parsePrismaSchema", () => {
  it("parses enums, scalar fields, ids, unique, optional, defaults, and relations exactly", () => {
    const schema = parsePrismaSchema(fixture("blog.prisma"));

    expect(schema.enums).toEqual([{ name: "Role", values: ["ADMIN", "USER"] }]);

    expect(schema.models).toHaveLength(2);
    const user = schema.models.find((m) => m.name === "User");
    const post = schema.models.find((m) => m.name === "Post");
    expect(user).toBeDefined();
    expect(post).toBeDefined();

    expect(user?.fields).toEqual([
      { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true, default: "autoincrement()" } },
      { name: "email", type: "String", isArray: false, isOptional: false, attributes: { unique: true } },
      { name: "name", type: "String", isArray: false, isOptional: false, attributes: {} },
      { name: "city", type: "String", isArray: false, isOptional: true, attributes: {} },
      { name: "role", type: "Role", isArray: false, isOptional: false, attributes: { default: "USER" } },
      { name: "createdAt", type: "DateTime", isArray: false, isOptional: false, attributes: { default: "now()" } },
      { name: "posts", type: "Post", isArray: true, isOptional: false, attributes: {} },
    ]);

    expect(post?.fields).toEqual([
      { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true, default: "autoincrement()" } },
      { name: "title", type: "String", isArray: false, isOptional: false, attributes: {} },
      { name: "authorId", type: "Int", isArray: false, isOptional: false, attributes: {} },
      {
        name: "author",
        type: "User",
        isArray: false,
        isOptional: false,
        attributes: { relation: { fields: ["authorId"], references: ["id"] } },
      },
    ]);
  });

  it("skips @@ block-level attributes and // comments without crashing", () => {
    const source = `
      // a leading comment
      model Widget {
        id Int @id @default(autoincrement()) // trailing comment
        sku String @unique
        @@map("widgets")
        @@unique([sku])
      }
    `;
    const schema = parsePrismaSchema(source);
    expect(schema.models).toHaveLength(1);
    expect(schema.models[0]?.fields).toEqual([
      { name: "id", type: "Int", isArray: false, isOptional: false, attributes: { id: true, default: "autoincrement()" } },
      { name: "sku", type: "String", isArray: false, isOptional: false, attributes: { unique: true } },
    ]);
  });
});
