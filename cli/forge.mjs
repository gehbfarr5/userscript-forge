#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE",
  ".gitignore",
  ".node-version",
  "package.json",
  "schemas/project.schema.json",
  "schemas/result.schema.json",
  "policies/public-boundary.json",
  "docs/contracts/lifecycle.md",
];

function usage() {
  console.log(`Userscript Forge CLI (Stage B2)\n\nCommands:\n  doctor [--json]    Check runtime and repository prerequisites\n  validate [--json] Check the public scaffold and policy files\n  validate-project <path> [--json]  Check one independent script repository\n  validate-evidence <path> [--json] Validate one private structured result\n  status [--json]   Show the current local stage\n`);
}

function parseArgs(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "help", ...rest] = normalized;
  return { command, json: rest.includes("--json"), rest: rest.filter((item) => item !== "--json") };
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
  const nodeVersion = (await readFile(path.join(ROOT, ".node-version"), "utf8")).trim();
  const checks = {
    schemaFiles: Boolean(projectSchema.$schema && resultSchema.$schema),
    schemaVersions: projectSchema.schemaVersion === 1 && resultSchema.schemaVersion === 1,
    policyVersion: policy.version === 1,
    packageType: packageJson.type === "module",
    packageManagerPinned: packageJson.packageManager === "pnpm@11.1.1",
    nodeRangePinned: packageJson.engines?.node === ">=24 <25",
    nodeVersionPinned: nodeVersion === "24.18.0",
    noPrivateTree: !(await exists("private")),
  };
  const publicFiles = ["AGENTS.md", "CLAUDE.md", "README.md", "LICENSE", ".node-version", "package.json", "cli/forge.mjs"];
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
  const gitConfig = await readFile(path.join(ROOT, ".git", "config"), "utf8");
  const remoteMatch = gitConfig.match(/\n\s*url\s*=\s*(\S+)/);
  const managerEvidencePath = path.resolve(ROOT, "..", "private", "evidence", "userscript-environment-check", "stage-b-manager", "result.json");
  let managerProbe = "NOT_RUN";
  try {
    const managerEvidence = JSON.parse(await readFile(managerEvidencePath, "utf8"));
    managerProbe = managerEvidence.status ?? "NOT_RUN";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const result = {
    stage: "B2",
    remoteConfigured: Boolean(remoteMatch),
    remoteUrl: remoteMatch?.[1] ?? null,
    directBrowserVerified: true,
    managerProbe,
    managerInjectionVerified: managerProbe === "PASS",
    deviceConnected: false,
    publicationEnabled: false,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log([`Stage: ${result.stage}`, `Remote: ${result.remoteConfigured ? result.remoteUrl : "not configured"}`, `Direct browser: ${result.directBrowserVerified ? "verified" : "not verified"}`, `Manager probe: ${result.managerProbe}`, `Manager injection: ${result.managerInjectionVerified ? "verified" : "not verified"}`, "Device: not connected", "Publication: disabled"].join("\n"));
}

function projectPathFromArg(argument) {
  if (!argument) throw new Error("validate-project requires a project path");
  const projectsRoot = path.resolve(ROOT, "..", "projects");
  const candidate = path.resolve(ROOT, argument);
  if (candidate !== projectsRoot && !candidate.startsWith(`${projectsRoot}${path.sep}`)) {
    throw new Error(`Project path must be inside ${projectsRoot}`);
  }
  return candidate;
}

function evidencePathFromArg(argument) {
  if (!argument) throw new Error("validate-evidence requires a result.json path");
  const privateRoot = path.resolve(ROOT, "..", "private");
  const candidate = path.resolve(ROOT, argument);
  if (candidate !== privateRoot && !candidate.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(`Evidence path must be inside ${privateRoot}`);
  }
  return candidate;
}

async function validateEvidence(args, json) {
  const evidencePath = evidencePathFromArg(args[0]);
  const schema = await loadJson("schemas/result.schema.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const schemaValid = validate(evidence);
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const ids = checks.map((check) => check.id);
  const uniqueCheckIds = new Set(ids).size === ids.length;
  const passStatusHasOnlyPassChecks = evidence.status !== "PASS" || checks.every((check) => check.status === "PASS");
  const result = {
    path: path.relative(path.resolve(ROOT, ".."), evidencePath),
    schemaValid,
    uniqueCheckIds,
    passStatusHasOnlyPassChecks,
    errors: validate.errors ?? [],
    pass: schemaValid && uniqueCheckIds && passStatusHasOnlyPassChecks,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Schema: ${result.schemaValid ? "PASS" : "FAIL"}`);
    console.log(`Unique check ids: ${result.uniqueCheckIds ? "PASS" : "FAIL"}`);
    console.log(`PASS status integrity: ${result.passStatusHasOnlyPassChecks ? "PASS" : "FAIL"}`);
    if (result.errors.length) console.log(JSON.stringify(result.errors, null, 2));
    console.log(`Evidence validate: ${result.pass ? "PASS" : "FAIL"}`);
  }
  if (!result.pass) process.exitCode = 1;
}

async function validateProject(args, json) {
  const projectRoot = projectPathFromArg(args[0]);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const policy = await loadJson("policies/public-boundary.json");
  const scriptRoot = path.join(projectRoot, "userscripts");
  const scriptFiles = (await readdir(scriptRoot)).filter((item) => item.endsWith(".user.js"));
  const script = scriptFiles.length === 1 ? await readFile(path.join(scriptRoot, scriptFiles[0]), "utf8") : "";
  const checks = {
    schemaVersion: project.schemaVersion === 1,
    id: typeof project.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id),
    name: typeof project.name === "string" && project.name.length > 0,
    mode: project.mode === "direct" || project.mode === "bundle",
    targets: Array.isArray(project.targets?.matches) && project.targets.matches.length > 0 && Array.isArray(project.targets?.requiredVerification),
    permissions: Array.isArray(project.permissions?.grants) && Array.isArray(project.permissions?.connect) && typeof project.permissions?.justifications === "object",
    permissionReasons: Array.isArray(project.permissions?.grants) && project.permissions.grants.every((grant) => typeof project.permissions.justifications?.[grant] === "string" && project.permissions.justifications[grant].length > 0),
    release: typeof project.release?.githubRepository === "string" && typeof project.release?.greasyForkRequired === "boolean",
    singleDirectScript: project.mode === "direct" ? scriptFiles.length === 1 : true,
    metadataBlock: /\/\/ ==UserScript==[\s\S]*\/\/ ==\/UserScript==/.test(script),
    metadataRequired: ["name", "namespace", "version", "description", "license"].every((key) => new RegExp(`@${key}\\s+\\S+`).test(script)) && /@match\s+\S+/.test(script),
    targetMatchesDeclared: Array.isArray(project.targets?.matches) && project.targets.matches.every((match) => script.includes(`@match        ${match}`) || script.includes(`@match ${match}`)),
  };
  const publicFiles = ["README.md", "LICENSE", "userscript.project.json", ...scriptFiles.map((file) => path.join("userscripts", file))];
  const forbidden = [];
  for (const relativePath of publicFiles) {
    const contents = await readFile(path.join(projectRoot, relativePath), "utf8");
    for (const pattern of policy.forbiddenTextPatterns) {
      if (contents.includes(pattern)) forbidden.push({ file: relativePath, pattern });
    }
  }
  checks.forbiddenText = forbidden;
  checks.pass = Object.entries(checks)
    .filter(([key]) => key !== "forbiddenText")
    .every(([, value]) => value === true) && forbidden.length === 0;
  const result = { project: project.id ?? null, checks, pass: checks.pass };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const [key, value] of Object.entries(checks)) console.log(`${key}: ${Array.isArray(value) ? (value.length ? "FAIL" : "PASS") : value ? "PASS" : "FAIL"}`);
    console.log(`Project validate: ${checks.pass ? "PASS" : "FAIL"}`);
  }
  if (!checks.pass) process.exitCode = 1;
}

async function main() {
  const { command, json, rest } = parseArgs(process.argv.slice(2));
  if (command === "doctor") return doctor(json);
  if (command === "validate") return validate(json);
  if (command === "validate-project") return validateProject(rest, json);
  if (command === "validate-evidence") return validateEvidence(rest, json);
  if (command === "status") return status(json);
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
