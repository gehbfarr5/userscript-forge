import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

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
    "schemas/capability.schema.json",
    "policies/public-boundary.json",
    "docs/contracts/lifecycle.md",
    "registry/capabilities.json",
    "probes/mobile/README.md",
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

test("central repository has a public remote", async () => {
  const gitConfig = await read(".git/config");
  assert.match(gitConfig, /url = https:\/\/github\.com\/[^\s]+\/userscript-forge\.git/);
});

test("structured evidence schema accepts explicit PASS and BLOCKED results", async () => {
  const schema = JSON.parse(await read("schemas/result.schema.json"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate({
    schemaVersion: 1,
    runId: "fixture-pass",
    status: "PASS",
    checks: [{ id: "local-page", status: "PASS" }],
  }), true);
  assert.equal(validate({
    schemaVersion: 1,
    runId: "fixture-blocked",
    status: "BLOCKED",
    checks: [{ id: "manager-injection", status: "BLOCKED" }],
  }), true);
});

test("bundle projects require the readable esbuild adapter", async () => {
  const schema = JSON.parse(await read("schemas/project.schema.json"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const project = {
    schemaVersion: 1,
    id: "bundle-fixture",
    name: "Bundle Fixture",
    description: "Bundle fixture",
    mode: "bundle",
    build: { adapter: "esbuild", entry: "src/index.ts", output: "dist/bundle-fixture.user.js", minify: false },
    targets: { matches: ["https://example.com/*"], requiredVerification: ["local-static"] },
    permissions: { grants: [], connect: [], justifications: {} },
    release: { githubRepository: "https://github.com/example/bundle-fixture", greasyForkRequired: false },
  };
  assert.equal(validate(project), true);
  assert.equal(validate({ ...project, build: { ...project.build, minify: true } }), false);
  assert.match(await read("cli/forge.mjs"), /build <path> \[--json\]/);
});

test("capability registry keeps verified and unverified platforms explicit", async () => {
  const registry = JSON.parse(await read("registry/capabilities.json"));
  const byId = new Map(registry.capabilities.map((item) => [item.id, item]));
  assert.equal(byId.get("desktop-direct-browser")?.status, "PASS");
  assert.equal(byId.get("desktop-tampermonkey-manager")?.status, "PASS");
  assert.equal(byId.get("android-emulator-firefox-manager")?.status, "NOT_RUN");
  assert.equal(byId.get("iphone-safari-stay")?.status, "NOT_RUN");
});
