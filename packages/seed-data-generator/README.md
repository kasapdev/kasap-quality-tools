# @kasap/seed-data-generator

A CLI that reads a database schema (a Prisma schema file, or a small JSON
export following a documented "Drizzle export" convention) and generates
realistic fake seed data as JSON or SQL `INSERT` statements — respecting
field types, `@unique` constraints, and foreign-key dependency order.

No Prisma/Drizzle runtime, no `@faker-js/faker` — it ships its own tiny
Prisma-subset parser and its own generators (including a curated Turkish
name/city/address dataset), so it has essentially zero dependencies
(just `commander` for the CLI).

## Install / build

Inside the monorepo:

```sh
pnpm --filter @kasap/seed-data-generator build
```

This compiles `src/` to `dist/` via `tsc`. `pnpm --filter @kasap/seed-data-generator test` runs the vitest suite.

## Usage

### Mode 1: Prisma schema file

```sh
seed-data-generator --schema ./prisma/schema.prisma --count 10 --format json
```

Given:

```prisma
enum Role {
  ADMIN
  USER
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  city      String?
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
```

`--format json` produces (truncated):

```json
{
  "User": [
    { "id": 1, "email": "ayse.yilmaz412@example.com", "name": "Ayşe", "city": "Ankara", "role": "USER", "createdAt": "2025-02-11T08:12:00.000Z" }
  ],
  "Post": [
    { "id": 1, "title": "onyx-482", "authorId": 1 }
  ]
}
```

`--format sql` produces batched `INSERT` statements, one block per model, in
dependency order (`User` before `Post`, since `Post.authorId` references
`User.id`):

```sql
INSERT INTO "User" ("id", "email", "name", "city", "role", "createdAt") VALUES
  (1, 'ayse.yilmaz412@example.com', 'Ayşe', 'Ankara', 'USER', '2025-02-11T08:12:00.000Z');

INSERT INTO "Post" ("id", "title", "authorId") VALUES
  (1, 'onyx-482', 1);
```

### Mode 2: Drizzle JSON export

Fully parsing arbitrary Drizzle TypeScript schema files is out of scope.
Instead, write (or generate with a small script alongside your real Drizzle
schema) a JSON file in this shape:

```json
{
  "enums": [{ "name": "Role", "values": ["ADMIN", "USER"] }],
  "models": [
    {
      "name": "User",
      "fields": [
        { "name": "id", "type": "Int", "isArray": false, "isOptional": false, "attributes": { "id": true, "default": "autoincrement()" } },
        { "name": "email", "type": "String", "isArray": false, "isOptional": false, "attributes": { "unique": true } }
      ]
    },
    {
      "name": "Post",
      "fields": [
        { "name": "id", "type": "Int", "isArray": false, "isOptional": false, "attributes": { "id": true, "default": "autoincrement()" } },
        { "name": "authorId", "type": "Int", "isArray": false, "isOptional": false, "attributes": {} },
        { "name": "author", "type": "User", "isArray": false, "isOptional": false, "attributes": { "relation": { "fields": ["authorId"], "references": ["id"] } } }
      ]
    }
  ]
}
```

This is the exact same internal shape the Prisma parser produces
(`{ enums: EnumDef[], models: ModelDef[] }`), which is why every generation
rule below applies identically to both input modes. `isArray`, `isOptional`,
and every key under `attributes` are optional in the JSON and default to
`false` / `{}` when omitted.

Then:

```sh
seed-data-generator --schema-json ./prisma-seed-schema.json --count 25 --format sql --out seed.sql
```

### CLI flags

```
seed-data-generator --schema <file.prisma> --count 10 --format json [--out <file>]
seed-data-generator --schema-json <file.json> --count 10 --format sql [--out <file>]
```

- Exactly one of `--schema` / `--schema-json` is required.
- `--count <n>` — rows generated per model (default `10`). A single flat
  count applies to every model; per-model counts (e.g.
  `--count Model=10,Other=5`) are a possible future improvement, not
  implemented here.
- `--format json|sql` — default `json`.
- `--out <file>` — write output to a file instead of stdout.

## Generation rules

- **Dependency order**: models are topologically sorted so a parent model
  (referenced by another model's `@relation`) is generated before its
  children, so FK columns can be filled from already-generated parent rows.
  A relation cycle is broken arbitrarily (see `orderModelsByDependency` in
  `src/schema.ts`) rather than looping forever or throwing.
- **`@id` fields**: `Int`/other non-`String` id fields get a sequential
  integer starting at `1` (regardless of the exact `@default(...)`
  expression); `String` id fields get a `crypto.randomUUID()` value.
- **FK scalar fields** (e.g. `authorId`, matched via a field's
  `@relation(fields: [...], references: [...])`): a value is drawn from an
  already-generated row of the parent model, at the field named in
  `references: [...]` — falling back to `id` only when `references` doesn't
  specify one for that position. If the parent model has zero generated
  rows, generation fails with a clear error naming the model/field.
- **`@unique` `String` fields**: real uniqueness is guaranteed, not hoped
  for — a few random retries are attempted first, then an incrementing
  numeric suffix is appended to guarantee a fresh value even at high counts
  against a small heuristic name pool.
- **Enum fields**: always one of the enum's declared values.
- **Optional (`?`) fields**: always get a generated value in this version
  (a documented simplification — no `--allow-nulls` flag is implemented).
- **String field-name heuristics** (case-insensitive, on tokenized field
  names): `email`/`mail` → fake email; `name`/`firstName`/`first_name` →
  Turkish first name; `lastName`/`surname`/`soyad` → Turkish last name;
  `city`/`sehir`/`il` → Turkish city; `address`/`adres`/`street`/`sokak` →
  generated Turkish street address; `phone`/`telefon`/`tel` → Turkish phone
  number; anything else → a generic `word-###` slug.
- **Number field-name heuristics**: `age`/`yas` → 1–90; `price`/`amount`/
  `cost`/`total`/`fiyat`/`tutar` → a currency-like range; everything else →
  1–100000 (`Int`/`BigInt`) or 0–1000 (`Float`/`Decimal`).
- **`DateTime`**: `now()` default → current timestamp; otherwise a random
  ISO date within the last ~2 years.
- **`Json`**: a placeholder empty object (`{}`).

The Turkish first-name, last-name, city, and street-word lists in
`src/data/turkish.ts` are a modest, curated set of common real names/places
for realistic-looking demo data — they are **not** an exhaustive or
official dataset (e.g. not all 81 Turkish provinces are listed).

## Limitations

- `@@` block-level attributes (`@@map(...)`, `@@unique([...])`, etc.) are
  parsed only far enough to be skipped without crashing — they have no
  effect on generation.
- The Prisma parser is a careful line-based parser, not a full grammar —
  it assumes one field per line and non-nested model/enum blocks (true for
  standard Prisma schemas).
- FK target field defaults to `id` when a relation's `references: [...]`
  doesn't specify one for a given position.
- Cycle-breaking in dependency ordering is naive (arbitrary), not a full
  heuristic solver.
- Per-model row counts aren't supported yet — `--count` is a single flat
  number applied to every model.
- No network/DB calls anywhere; this is a pure offline generator.
