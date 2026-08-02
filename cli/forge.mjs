#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE",
  ".gitignore",
  "package.json",
  "schemas/project.schema.json",
  "schemas/result.schema.json",
  "policies/public-boundary.json",
  "docs/contracts/lifecycle.md",
];

function usage() {
  console.log(`Userscript Forge CLI (Stage A)\n\nCommands:\n  doctor [--json]    Check runtime and repository prerequisites\n  validate [--json] Check the public scaffold and policy files\n  status [--json]   Show the current local stage\n`);
}

function parseArgs(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "help", ...rest] = normalized;
  return { command, json: rest.includes("--json") };
}

async function exists(relativePath) {
  try {
    await access(path.join(ROOT, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

async function doctor(json) {
  const checks = {
    node: {
      version: process.versions.node,
      required: ">=24 <25",
      pass: nodeMajor() >= 24 && nodeMajor() < 25,
    },
    gitRepository: await exists(".git"),
    requiredPaths: Object.fromEntries(
      await Promise.all(REQUIRED_PATHS.map(async (item) => [item, await exists(item)])),
    ),
  };
  checks.pass = checks.node.pass && checks.gitRepository && Object.values(checks.requiredPaths).every(Boolean);
  if (json) console.log(JSON.stringify(checks, null, 2));
  else {
    console.log(`Node ${checks.node.version}: ${checks.node.pass ? "PASS" : "FAIL"}`);
    console.log(`Git repository: ${checks.gitRepository ? "PASS" : "FAIL"}`);
    for (const [item, pass] of Object.entries(checks.requiredPaths)) console.log(`${item}: ${pass ? "PASS" : "FAIL"}`);
    console.log(`Doctor: ${checks.pass ? "PASS" : "FAIL"}`);
  }
  if (!checks.pass) process.exitCode = 1;
}

async function validate(json) {
  const projectSchema = await loadJson("schemas/project.schema.json");
  const resultSchema = await loadJson("schemas/result.schema.json");
  const policy = await loadJson("policies/public-boundary.json");
  const packageJson = await loadJson("package.json");
  const checks = {
    schemaFiles: Boolean(projectSchema.$schema && resultSchema.$schema),
    schemaVersions: projectSchema.schemaVersion === 1 && resultSchema.schemaVersion === 1,
    policyVersion: policy.version === 1,
    packageType: packageJson.type === "module",
    packageManagerPinned: packageJson.packageManager === "pnpm@11.1.1",
    nodeRangePinned: packageJson.engines?.node === ">=24 <25",
    noPrivateTree: !(await exists("private")),
  };
  const publicFiles = ["AGENTS.md", "CLAUDE.md", "README.md", "LICENSE", "package.json", "cli/forge.mjs"];
  const forbidden = [];
  for (const relativePath of publicFiles) {
    const contents = await readFile(path.join(ROOT, relativePath), "utf8");
    for (const pattern of policy.forbiddenTextPatterns) {
      if (contents.includes(pattern)) forbidden.push({ file: relativePath, pattern });
    }
  }
  checks.forbiddenText = forbidden;
  checks.pass = Object.entries(checks)
    .filter(([key]) => key !== "forbiddenText")
    .every(([, value]) => value === true) && forbidden.length === 0;
  if (json) console.log(JSON.stringify(checks, null, 2));
  else {
    for (const [key, value] of Object.entries(checks)) console.log(`${key}: ${Array.isArray(value) ? (value.length ? "FAIL" : "PASS") : value ? "PASS" : "FAIL"}`);
    console.log(`Validate: ${checks.pass ? "PASS" : "FAIL"}`);
  }
  if (!checks.pass) process.exitCode = 1;
}

async function status(json) {
  const result = {
    stage: "A",
    remoteConfigured: false,
    browserConnected: false,
    deviceConnected: false,
    publicationEnabled: false,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log([`Stage: ${result.stage}`, "Remote: not configured", "Browser: not connected", "Device: not connected", "Publication: disabled"].join("\n"));
}

async function main() {
  const { command, json } = parseArgs(process.argv.slice(2));
  if (command === "doctor") return doctor(json);
  if (command === "validate") return validate(json);
  if (command === "status") return status(json);
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
