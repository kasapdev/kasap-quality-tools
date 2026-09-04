#!/usr/bin/env node
import { Command } from "commander";
import type { Change } from "./types.js";
import { loadSpec } from "./parse.js";
import { diffSpecs } from "./diff.js";

function printSection(title: string, changes: Change[]): void {
  console.log(title);
  console.log("=".repeat(title.length));
  if (changes.length === 0) {
    console.log("(none)");
  } else {
    for (const change of changes) {
      console.log(`- [${change.category}] ${change.path}`);
      console.log(`  ${change.message}`);
    }
  }
  console.log("");
}

function printReport(breaking: Change[], safe: Change[]): void {
  printSection("Breaking changes", breaking);
  printSection("Safe changes", safe);
  console.log(`Summary: ${breaking.length} breaking change(s), ${safe.length} safe change(s)`);
}

const program = new Command();

program
  .name("api-contract-diff")
  .description("Structurally compare two OpenAPI 3.x specs and report breaking vs. safe changes")
  .argument("<before-spec>", "path to the 'before' OpenAPI spec (YAML or JSON)")
  .argument("<after-spec>", "path to the 'after' OpenAPI spec (YAML or JSON)")
  .option("--json", "print machine-readable JSON instead of a human-readable report")
  .action((beforeSpecPath: string, afterSpecPath: string, options: { json?: boolean }) => {
    try {
      const before = loadSpec(beforeSpecPath);
      const after = loadSpec(afterSpecPath);
      const { breaking, safe } = diffSpecs(before, after);

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ breaking, safe }, null, 2)}\n`);
      } else {
        printReport(breaking, safe);
      }

      process.exitCode = breaking.length > 0 ? 1 : 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`api-contract-diff: ${message}`);
      process.exitCode = 2;
    }
  });

program.parse();
