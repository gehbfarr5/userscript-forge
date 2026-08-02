import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

test("central scaffold contains the public contract", async () => {
  for (const relativePath of [
    "AGENTS.md",
    "CLAUDE.md",
    "schemas/project.schema.json",
    "schemas/result.schema.json",
    "policies/public-boundary.json",
    "docs/contracts/lifecycle.md",
  ]) {
    await access(path.join(ROOT, relativePath), constants.F_OK);
  }
});

test("public policy does not permit local session material", async () => {
  const policy = JSON.parse(await read("policies/public-boundary.json"));
  assert.equal(policy.version, 1);
  assert.ok(policy.privateRoots.includes("browser-state"));
  assert.ok(policy.forbiddenTextPatterns.includes("Cookie:"));
  assert.ok(policy.forbiddenTextPatterns.includes("/Users/"));
});

test("runtime contract is pinned to Node 24 and pnpm 11.1.1", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.engines.node, ">=24 <25");
  assert.equal(packageJson.packageManager, "pnpm@11.1.1");
  assert.equal((await read(".node-version")).trim(), "24.18.0");
});
