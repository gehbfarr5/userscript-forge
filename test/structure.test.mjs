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
    ".github/workflows/ci.yml",
    "CLAUDE.md",
    "schemas/project.schema.json",
    "schemas/result.schema.json",
    "schemas/capability.schema.json",
    "schemas/mobile-userscript-probe.schema.json",
    "schemas/greasyfork-publication-probe.schema.json",
    "policies/public-boundary.json",
    "docs/contracts/lifecycle.md",
    "docs/contracts/legacy-oneplus-skill.md",
    "registry/capabilities.json",
    "probes/mobile/README.md",
    "probes/mobile/serve.py",
    "probes/mobile/open-firefox-url.sh",
    "probes/mobile/userscript-canary.manifest.json",
    "probes/mobile/oneplus-userscript.manifest.json",
    "probes/publication/greasyfork.manifest.json",
    "probes/publication/README.md",
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

test("mobile userscript canary manifest is explicit and privacy-safe", async () => {
  const schema = JSON.parse(await read("schemas/mobile-userscript-probe.schema.json"));
  const manifest = JSON.parse(await read("probes/mobile/userscript-canary.manifest.json"));
  const oneplusManifest = JSON.parse(await read("probes/mobile/oneplus-userscript.manifest.json"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(manifest), true);
  assert.equal(validate(oneplusManifest), true);
  assert.equal(manifest.target.id, "android-emulator-firefox-manager");
  assert.equal(manifest.target.serialPolicy, "explicit-emulator-serial");
  assert.equal(manifest.target.hostMapping, "10.0.2.2");
  assert.equal(oneplusManifest.target.id, "oneplus-15-firefox-manager");
  assert.equal(oneplusManifest.target.serialPolicy, "explicit-real-serial");
  assert.equal(oneplusManifest.target.hostMapping, "explicit-host-url");
  assert.ok(manifest.evidence.forbiddenFields.includes("cookies"));
  assert.ok(manifest.evidence.forbiddenFields.includes("sessionId"));
  assert.ok(oneplusManifest.evidence.forbiddenFields.includes("udid"));
});

test("Greasy Fork publication manifest is browser-only and privacy-safe", async () => {
  const schema = JSON.parse(await read("schemas/greasyfork-publication-probe.schema.json"));
  const manifest = JSON.parse(await read("probes/publication/greasyfork.manifest.json"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(manifest), true);
  assert.equal(manifest.mode, "browser-orchestrated");
  assert.match(manifest.paths.update, /\{scriptId\}/);
  assert.ok(manifest.evidence.forbiddenFields.includes("otp"));
  assert.ok(manifest.evidence.forbiddenFields.includes("password"));
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
  assert.equal(validate({ ...project, targets: { ...project.targets, requiredVerification: ["OnePlus-15"] } }), false);
  const cli = await read("cli/forge.mjs");
  assert.match(cli, /build <path> \[--json\]/);
  assert.match(cli, /--verify ID/);
  assert.match(cli, /--lockfile-only/);
  assert.match(cli, /release-check <path> \[options\]/);
  assert.match(cli, /record-capability <id> <evidence>/);
  assert.match(cli, /forbiddenEvidenceKeys/);
  assert.match(cli, /--emulator PATH --oneplus PATH/);
  assert.match(cli, /device-target-explicit/);
  assert.match(cli, /declared-\$\{requiredKind\}-evidence-required/);
  assert.match(cli, /release-github-evidence-required/);
  assert.match(cli, /release-greasyfork-evidence-required/);
  assert.match(cli, /publish-github <path> \[options\]/);
  assert.match(cli, /mobile-handoff <path>/);
  assert.match(cli, /--target emulator\|oneplus/);
  assert.match(cli, /external-orchestrator-required/);
  assert.match(cli, /greasyfork-handoff <path>/);
  assert.match(cli, /release-check PASS evidence record/);
  assert.match(cli, /release", "create"/);
  assert.match(cli, /Every required platform evidence record must be PASS/);
  assert.match(cli, /@description  " \+ project\.description/);
  assert.match(cli, /requires Node >=24 <25/);
  assert.match(cli, /capabilityRegistry = await loadJson\("registry\/capabilities\.json"\)/);
  assert.match(cli, /Publication gate: \$\{result\.publication\.status\}/);
});

test("capability registry keeps verified and unverified platforms explicit", async () => {
  const registry = JSON.parse(await read("registry/capabilities.json"));
  const byId = new Map(registry.capabilities.map((item) => [item.id, item]));
  assert.equal(byId.get("desktop-direct-browser")?.status, "PASS");
  assert.equal(byId.get("desktop-tampermonkey-manager")?.status, "PASS");
  assert.equal(byId.get("android-emulator-firefox-manager")?.status, "NOT_RUN");
  assert.equal(byId.get("android-emulator-appium-backend")?.status, "PASS");
  assert.equal(byId.get("oneplus-15-appium-backend")?.status, "PASS");
  assert.equal(byId.get("iphone-safari-stay")?.status, "NOT_RUN");
  assert.equal(byId.get("ios-simulator-appium-backend")?.status, "PASS");
  assert.equal(byId.get("iphone-real-appium-backend")?.status, "BLOCKED");
  assert.equal(byId.get("codex-cli-readonly-contract")?.status, "PASS");
  assert.equal(byId.get("claude-cli-readonly-auth")?.status, "BLOCKED");
});
