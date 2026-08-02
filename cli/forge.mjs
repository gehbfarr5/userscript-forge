#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  "schemas/capability.schema.json",
  "policies/public-boundary.json",
  "docs/contracts/lifecycle.md",
  "registry/capabilities.json",
  "probes/mobile/README.md",
];

function usage() {
  console.log("release-check <path> [options]: provide --candidate, --require, and matching --manager/--device/--github/--greasyfork evidence paths");
  console.log(`Userscript Forge CLI (Stage B2)\n\nCommands:\n  doctor [--json]    Check runtime and repository prerequisites\n  validate [--json] Check the public scaffold and policy files\n  validate-project <path> [--json]  Check one independent script repository\n  validate-evidence <path> [--json] Validate one private structured result\n  build <path> [--json]             Build a bundle project into its tracked dist artifact\n  new <id> [options] Create an independent userscript project\n  candidate <path> [--json] Lock a clean static candidate and write private evidence\n  status [--json]   Show the current local stage\n\nnew options:\n  --name TEXT --description TEXT --repository URL --match PATTERN (repeatable)\n  --grant NAME --grant-reason NAME=TEXT (repeatable, paired)\n  --connect HOST --connect-reason HOST=TEXT (repeatable, paired)\n  --namespace URL --release-branch NAME --mode direct|bundle --greasy-fork | --no-greasy-fork\n  --dry-run (render without writing) --no-git (do not initialize Git)\n`);
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

function runtimePass() {
  return nodeMajor() >= 24 && nodeMajor() < 25;
}

function requireSupportedRuntime(command) {
  if (!runtimePass()) throw new Error(`${command} requires Node >=24 <25; current runtime is ${process.versions.node}`);
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
  const capabilitySchema = await loadJson("schemas/capability.schema.json");
  const capabilities = await loadJson("registry/capabilities.json");
  const capabilityValidator = new Ajv2020({ allErrors: true, strict: false }).compile(capabilitySchema);
  const policy = await loadJson("policies/public-boundary.json");
  const packageJson = await loadJson("package.json");
  const nodeVersion = (await readFile(path.join(ROOT, ".node-version"), "utf8")).trim();
  const checks = {
    schemaFiles: Boolean(projectSchema.$schema && resultSchema.$schema && capabilitySchema.$schema),
    schemaVersions: projectSchema.schemaVersion === 1 && resultSchema.schemaVersion === 1 && capabilitySchema.schemaVersion === 1,
    capabilityRegistryVersion: capabilities.schemaVersion === 1 && Array.isArray(capabilities.capabilities),
    capabilityRegistrySchema: capabilityValidator(capabilities),
    policyVersion: policy.version === 1,
    packageType: packageJson.type === "module",
    packageManagerPinned: packageJson.packageManager === "pnpm@11.1.1",
    nodeRangePinned: packageJson.engines?.node === ">=24 <25",
    nodeVersionPinned: nodeVersion === "24.18.0",
    noPrivateTree: !(await exists("private")),
  };
  const publicFiles = ["AGENTS.md", "CLAUDE.md", "README.md", "LICENSE", ".node-version", "package.json", "cli/forge.mjs", "registry/capabilities.json"];
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
  const directEvidencePath = path.resolve(ROOT, "..", "private", "evidence", "userscript-environment-check", "stage-b-direct", "result.json");
  const managerEvidencePath = path.resolve(ROOT, "..", "private", "evidence", "userscript-environment-check", "stage-b-manager", "result.json");
  let directProbe = "NOT_RUN";
  let managerProbe = "NOT_RUN";
  try {
    const directEvidence = JSON.parse(await readFile(directEvidencePath, "utf8"));
    directProbe = directEvidence.status ?? "NOT_RUN";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
    directProbe,
    directBrowserVerified: directProbe === "PASS",
    managerProbe,
    managerInjectionVerified: managerProbe === "PASS",
    deviceConnected: false,
    publicationEnabled: false,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log([`Stage: ${result.stage}`, `Remote: ${result.remoteConfigured ? result.remoteUrl : "not configured"}`, `Direct probe: ${result.directProbe}`, `Direct browser: ${result.directBrowserVerified ? "verified" : "not verified"}`, `Manager probe: ${result.managerProbe}`, `Manager injection: ${result.managerInjectionVerified ? "verified" : "not verified"}`, "Device: not connected", "Publication: disabled"].join("\n"));
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

function singleLine(value, label) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`${label} must be a non-empty single-line value`);
  return value;
}

function takeOptionValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseKeyValue(value, label) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`${label} must use NAME=REASON`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseNewOptions(args) {
  const options = {
    mode: "direct",
    matches: [],
    grants: [],
    grantReasons: new Map(),
    connects: [],
    connectReasons: new Map(),
    greasyForkRequired: true,
    dryRun: false,
    gitInit: true,
  };
  if (!args[0] || args[0].startsWith("--")) throw new Error("new requires a kebab-case project id");
  options.id = args[0];
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--dry-run") options.dryRun = true;
    else if (option === "--no-git") options.gitInit = false;
    else if (option === "--greasy-fork") options.greasyForkRequired = true;
    else if (option === "--no-greasy-fork") options.greasyForkRequired = false;
    else if (["--name", "--description", "--repository", "--namespace", "--release-branch", "--mode", "--match", "--grant", "--connect", "--grant-reason", "--connect-reason"].includes(option)) {
      const value = takeOptionValue(args, index, option);
      index += 1;
      if (option === "--name") options.name = singleLine(value, "--name");
      else if (option === "--description") options.description = singleLine(value, "--description");
      else if (option === "--repository") options.repository = singleLine(value, "--repository");
      else if (option === "--namespace") options.namespace = singleLine(value, "--namespace");
      else if (option === "--release-branch") options.releaseBranch = singleLine(value, "--release-branch");
      else if (option === "--mode") options.mode = value;
      else if (option === "--match") options.matches.push(singleLine(value, "--match"));
      else if (option === "--grant") options.grants.push(singleLine(value, "--grant"));
      else if (option === "--connect") options.connects.push(singleLine(value, "--connect"));
      else if (option === "--grant-reason") {
        const [name, reason] = parseKeyValue(value, "--grant-reason");
        options.grantReasons.set(singleLine(name, "grant name"), singleLine(reason, "grant reason"));
      } else if (option === "--connect-reason") {
        const [host, reason] = parseKeyValue(value, "--connect-reason");
        options.connectReasons.set(singleLine(host, "connect host"), singleLine(reason, "connect reason"));
      }
    } else throw new Error(`Unknown new option '${option}'`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id)) throw new Error("Project id must be kebab-case lowercase ASCII");
  if (!options.name) throw new Error("new requires --name");
  if (!options.description) throw new Error("new requires --description");
  if (!options.repository) throw new Error("new requires --repository");
  if (!options.matches.length) throw new Error("new requires at least one --match");
  if (!new Set(["direct", "bundle"]).has(options.mode)) throw new Error("--mode must be direct or bundle");
  for (const grant of options.grants) if (!options.grantReasons.has(grant)) throw new Error(`Missing --grant-reason for ${grant}`);
  for (const host of options.connects) if (!options.connectReasons.has(host)) throw new Error(`Missing --connect-reason for ${host}`);
  return options;
}

function metadataLines(options) {
  const lines = [
    "// ==UserScript==",
    `// @name         ${options.name}`,
    `// @namespace    ${options.namespace ?? options.repository}`,
    "// @version      0.1.0",
    `// @description  ${options.description}`,
    ...options.matches.map((match) => `// @match        ${match}`),
    ...options.grants.map((grant) => `// @grant        ${grant}`),
    ...options.connects.map((host) => `// @connect      ${host}`),
    "// @run-at       document-idle",
    "// @license      MIT",
    "// ==/UserScript==",
    "",
  ];
  return lines.join("\n");
}

function projectManifest(options) {
  const justifications = Object.fromEntries([
    ...options.grants.map((grant) => [grant, options.grantReasons.get(grant)]),
    ...options.connects.map((host) => [`connect:${host}`, options.connectReasons.get(host)]),
  ]);
  const manifest = {
    schemaVersion: 1,
    id: options.id,
    name: options.name,
    description: options.description,
    mode: options.mode,
    targets: { matches: options.matches, requiredVerification: ["local-static", "local-direct-browser", "declared-platforms"] },
    permissions: { grants: options.grants, connect: options.connects, justifications },
    release: { githubRepository: options.repository, greasyForkRequired: options.greasyForkRequired, releaseBranch: options.releaseBranch ?? "release" },
  };
  if (options.mode === "bundle") {
    manifest.build = { adapter: "esbuild", entry: "src/index.ts", output: `dist/${options.id}.user.js`, minify: false };
  }
  return manifest;
}

function generatedReadme(options) {
  const bundleSteps = options.mode === "bundle"
    ? "\n## Build\n\nInstall the pinned build dependency, then create the readable release artifact:\n\nCommands:\npnpm install\npnpm run build\npnpm test\n\nTracked output: dist/" + options.id + ".user.js\nThe output is intentionally unminified and carries metadata generated from userscript.project.json and package.json.\n"
    : "";
  return `# ${options.name}\n\n${options.description}\n\n- Mode: \`${options.mode}\`\n- Declared matches: ${options.matches.map((match) => `\`${match}\``).join(", ")}\n- GitHub: ${options.repository}\n- Greasy Fork required: ${options.greasyForkRequired ? "yes" : "no"}\n\n## Local workflow\n\nRun the central project validator before creating a release candidate:\n\n\`\`\`text\npnpm run forge -- validate-project ../projects/${options.id} --json\n\`\`\`\n${bundleSteps}\nThe generated script is a scaffold. Add behavior only after the target matrix and permission reasons are confirmed.\n`;
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function newProject(args, json) {
  requireSupportedRuntime("new");
  const options = parseNewOptions(args);
  const projectsRoot = path.resolve(ROOT, "..", "projects");
  const projectRoot = path.join(projectsRoot, options.id);
  const manifest = projectManifest(options);
  const namePattern = JSON.stringify(`@name\\s+${regexEscape(options.name)}`);
  const matchAssertions = options.matches.map((match) => `assert.match(script, new RegExp(${JSON.stringify(`@match\\s+${regexEscape(match)}`)}));`).join("\n  ");
  const bundle = options.mode === "bundle";
  const packageJson = {
    name: options.id,
    version: "0.1.0",
    private: false,
    type: "module",
    license: "MIT",
    scripts: bundle ? { build: "node build.mjs", test: "node --test" } : { test: "node --test" },
    engines: { node: ">=24 <25" },
    packageManager: "pnpm@11.1.1",
    ...(bundle ? { devDependencies: { esbuild: "0.28.1" } } : {}),
  };
  const files = bundle ? {
    "README.md": generatedReadme(options),
    ".gitignore": "node_modules/\n.pnpm-store/\n.playwright-cli/\n.DS_Store\n",
    "package.json": JSON.stringify(packageJson, null, 2) + "\n",
    "userscript.project.json": JSON.stringify(manifest, null, 2) + "\n",
    "build.mjs": `import { build } from "esbuild";\nimport { mkdir, readFile } from "node:fs/promises";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));\nconst project = JSON.parse(await readFile(path.join(ROOT, "userscript.project.json"), "utf8"));\nconst packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));\nif (project.mode !== "bundle" || project.build?.adapter !== "esbuild") throw new Error("Bundle project must use the esbuild adapter");\nif (project.build.minify !== false) throw new Error("Userscript bundle output must remain unminified");\nconst metadata = [\n  "// ==UserScript==",\n  "// @name         " + project.name,\n  "// @namespace    " + project.release.githubRepository,\n  "// @version      " + packageJson.version,\n  "// @description  " + project.description,\n  ...project.targets.matches.map((match) => "// @match        " + match),\n  ...project.permissions.grants.map((grant) => "// @grant        " + grant),\n  ...project.permissions.connect.map((host) => "// @connect      " + host),\n  "// @run-at       document-idle",\n  "// @license      MIT",\n  "// ==/UserScript==",\n  ""\n].join("\\n");\nconst output = path.resolve(ROOT, project.build.output);\nawait mkdir(path.dirname(output), { recursive: true });\nawait build({\n  entryPoints: [path.resolve(ROOT, project.build.entry)],\n  outfile: output,\n  bundle: true,\n  format: "iife",\n  target: "es2020",\n  minify: false,\n  sourcemap: false,\n  legalComments: "inline",\n  banner: { js: metadata },\n  logLevel: "info"\n});\nconsole.log(project.id + ": " + project.build.output + " (version " + packageJson.version + ")");\n`,
    "src/index.ts": `const panel = document.createElement("aside");\npanel.textContent = "Bundle project scaffold";\npanel.dataset.userscriptForge = "bundle";\ndocument.documentElement.append(panel);\n`,
    "tests/source.test.mjs": `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst project = JSON.parse(await readFile(new URL("../userscript.project.json", import.meta.url), "utf8"));\nconst source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");\n\ntest("bundle project declares the central esbuild adapter", () => {\n  assert.equal(project.mode, "bundle");\n  assert.equal(project.build.adapter, "esbuild");\n  assert.equal(project.build.minify, false);\n  assert.match(source, /userscriptForge/);\n});\n`,
  } : {
    "README.md": generatedReadme(options),
    ".gitignore": "node_modules/\ndist/\n.playwright-cli/\n.DS_Store\n",
    "package.json": JSON.stringify(packageJson, null, 2) + "\n",
    "userscript.project.json": JSON.stringify(manifest, null, 2) + "\n",
    [`userscripts/${options.id}.user.js`]: `${metadataLines(options)}(() => {\n  "use strict";\n\n  // TODO: implement the requested behavior after the local target fixture exists.\n})();\n`,
    "tests/metadata.test.mjs": `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst script = await readFile(new URL("../userscripts/${options.id}.user.js", import.meta.url), "utf8");\n\ntest("generated userscript metadata matches the project declaration", () => {\n  assert.match(script, new RegExp(${namePattern}));\n  ${matchAssertions}\n});\n`,
  };
  if (!options.dryRun) {
    try {
      await access(projectRoot, constants.F_OK);
      throw new Error(`Project already exists: ${projectRoot}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(path.join(projectRoot, "userscripts"), { recursive: true });
    await mkdir(path.join(projectRoot, "tests"), { recursive: true });
    await writeFile(path.join(projectRoot, "LICENSE"), await readFile(path.join(ROOT, "LICENSE"), "utf8"));
    for (const [relativePath, contents] of Object.entries(files)) {
      const destination = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, { mode: 0o644 });
    }
    if (options.gitInit) {
      execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
    }
  }
  const result = { id: options.id, mode: options.mode, projectRoot: options.dryRun ? null : projectRoot, files: Object.keys(files).concat("LICENSE"), gitInitialized: !options.dryRun && options.gitInit, dryRun: options.dryRun };
  if (json || options.dryRun) console.log(JSON.stringify(result, null, 2));
  else console.log(`Created ${projectRoot}\nRun: pnpm run forge -- validate-project ../projects/${options.id} --json`);
}

function inspectEvidence(evidence, validator, evidencePath) {
  const schemaValid = validator(evidence);
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const ids = checks.map((check) => check.id);
  const uniqueCheckIds = new Set(ids).size === ids.length;
  const passStatusHasOnlyPassChecks = evidence.status !== "PASS" || checks.every((check) => check.status === "PASS");
  return {
    path: path.relative(path.resolve(ROOT, ".."), evidencePath),
    schemaValid,
    uniqueCheckIds,
    passStatusHasOnlyPassChecks,
    errors: validator.errors ?? [],
    pass: schemaValid && uniqueCheckIds && passStatusHasOnlyPassChecks,
  };
}

function parseReleaseCheckOptions(args) {
  const options = { candidate: null, required: new Set(), evidence: {} };
  const evidenceOptions = new Map([["--manager", "manager"], ["--device", "device"], ["--github", "github"], ["--greasyfork", "greasyfork"]]);
  if (!args[0] || args[0].startsWith("--")) throw new Error("release-check requires a project path");
  options.project = args[0];
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--candidate") {
      options.candidate = takeOptionValue(args, index, option);
      index += 1;
    } else if (option === "--require") {
      const value = takeOptionValue(args, index, option);
      index += 1;
      for (const kind of value.split(",").map((item) => item.trim()).filter(Boolean)) {
        if (!["manager", "device", "github", "greasyfork"].includes(kind)) throw new Error(`Unknown release evidence kind '${kind}'`);
        options.required.add(kind);
      }
    } else if (evidenceOptions.has(option)) {
      options.evidence[evidenceOptions.get(option)] = takeOptionValue(args, index, option);
      index += 1;
    } else throw new Error(`Unknown release-check option '${option}'`);
  }
  if (!options.candidate) throw new Error("release-check requires --candidate");
  if (!options.required.size) throw new Error("release-check requires at least one --require kind");
  return options;
}

async function validateEvidence(args, json) {
  const evidencePath = evidencePathFromArg(args[0]);
  const schema = await loadJson("schemas/result.schema.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const result = inspectEvidence(evidence, validator, evidencePath);
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

async function releaseCheck(args, json) {
  requireSupportedRuntime("release-check");
  const options = parseReleaseCheckOptions(args);
  const projectRoot = projectPathFromArg(options.project);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const evidenceSchema = await loadJson("schemas/result.schema.json");
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(evidenceSchema);
  const checks = [];
  const addCheck = (id, status, details = undefined) => checks.push({ id, status, ...(details ? { details } : {}) });
  const validation = await collectProjectValidation(projectRoot);
  addCheck("project-validation", validation.pass ? "PASS" : "FAIL", validation.checks);
  const headResult = gitOutput(projectRoot, ["rev-parse", "HEAD"]);
  const cleanResult = gitOutput(projectRoot, ["status", "--porcelain"]);
  addCheck("project-git-clean", cleanResult.value === "" ? "PASS" : "FAIL", cleanResult.error ? { error: cleanResult.error } : undefined);
  const candidatePath = evidencePathFromArg(options.candidate);
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const candidateInspection = inspectEvidence(candidate, validator, candidatePath);
  addCheck("candidate-evidence-schema", candidateInspection.pass ? "PASS" : "FAIL", candidateInspection);
  addCheck("candidate-status", candidate.status === "PASS" ? "PASS" : "FAIL", { status: candidate.status });
  addCheck("candidate-project", candidate.project === project.id ? "PASS" : "FAIL", { expected: project.id, actual: candidate.project });
  addCheck("candidate-source-commit", Boolean(headResult.value) && candidate.sourceCommit === headResult.value ? "PASS" : "FAIL", { expected: headResult.value, actual: candidate.sourceCommit });
  const artifactRelative = validation.artifactRelative;
  const artifactPath = artifactRelative ? path.join(projectRoot, artifactRelative) : null;
  const currentArtifactSha = artifactPath
    ? await access(artifactPath, constants.F_OK).then(async () => createHash("sha256").update(await readFile(artifactPath)).digest("hex")).catch(() => null)
    : null;
  addCheck("candidate-artifact-sha256", Boolean(currentArtifactSha) && candidate.artifact?.sha256 === currentArtifactSha ? "PASS" : "FAIL", { expected: currentArtifactSha, actual: candidate.artifact?.sha256 });
  for (const kind of options.required) {
    const evidenceArgument = options.evidence[kind];
    if (!evidenceArgument) {
      addCheck(`${kind}-evidence-present`, "FAIL", { reason: "required evidence path was not supplied" });
      continue;
    }
    const evidencePath = evidencePathFromArg(evidenceArgument);
    let evidence;
    try { evidence = JSON.parse(await readFile(evidencePath, "utf8")); }
    catch (error) { addCheck(`${kind}-evidence-readable`, "FAIL", { error: String(error?.message || error) }); continue; }
    const inspection = inspectEvidence(evidence, validator, evidencePath);
    addCheck(`${kind}-evidence-schema`, inspection.pass ? "PASS" : "FAIL", inspection);
    addCheck(`${kind}-status`, evidence.status === "PASS" ? "PASS" : "FAIL", { status: evidence.status });
    addCheck(`${kind}-project`, evidence.project === project.id ? "PASS" : "FAIL", { expected: project.id, actual: evidence.project });
    addCheck(`${kind}-source-commit`, evidence.sourceCommit === candidate.sourceCommit ? "PASS" : "FAIL", { expected: candidate.sourceCommit, actual: evidence.sourceCommit });
    addCheck(`${kind}-artifact-sha256`, evidence.artifact?.sha256 === candidate.artifact?.sha256 ? "PASS" : "FAIL", { expected: candidate.artifact?.sha256, actual: evidence.artifact?.sha256 });
  }
  const status = checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
  const timestamp = new Date().toISOString();
  const runId = `release-check-${project.id}-${timestamp.replace(/[:.]/g, "-")}`;
  const evidence = {
    schemaVersion: 1,
    runId,
    status,
    project: project.id,
    probe: "release-check",
    ...(headResult.value ? { sourceCommit: headResult.value } : {}),
    ...(currentArtifactSha && artifactRelative ? { artifact: { path: `projects/${project.id}/${artifactRelative}`, sha256: currentArtifactSha } } : {}),
    environment: { requiredEvidence: [...options.required], candidate: path.relative(path.resolve(ROOT, ".."), candidatePath) },
    checks,
    notes: [
      "This is a fail-closed pre-publication gate. It performs no external publication action.",
      "Every required platform evidence record must be PASS and match the current project commit and artifact SHA-256.",
    ],
    startedAt: timestamp,
    finishedAt: new Date().toISOString(),
  };
  const privateEvidenceDir = path.resolve(ROOT, "..", "private", "evidence", project.id, "release-check");
  await mkdir(privateEvidenceDir, { recursive: true, mode: 0o700 });
  const evidencePath = path.join(privateEvidenceDir, `${runId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const result = { ...evidence, evidencePath: path.relative(path.resolve(ROOT, ".."), evidencePath) };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Release check: ${status}\nEvidence: ${result.evidencePath}`);
  if (status !== "PASS") process.exitCode = 1;
}

async function collectProjectValidation(projectRoot) {
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const policy = await loadJson("policies/public-boundary.json");
  const scriptRoot = path.join(projectRoot, "userscripts");
  const scriptFiles = await readdir(scriptRoot).catch((error) => (error?.code === "ENOENT" ? [] : Promise.reject(error)));
  const directScriptFiles = scriptFiles.filter((item) => item.endsWith(".user.js"));
  const bundleOutput = project.mode === "bundle" && typeof project.build?.output === "string" ? project.build.output : null;
  const bundleOutputSafe = bundleOutput && !path.isAbsolute(bundleOutput) && !bundleOutput.split("/").includes("..") && bundleOutput.startsWith("dist/") && bundleOutput.endsWith(".user.js");
  const artifactRelative = project.mode === "bundle" ? (bundleOutputSafe ? bundleOutput : null) : (directScriptFiles.length === 1 ? path.join("userscripts", directScriptFiles[0]) : null);
  const artifactPath = artifactRelative ? path.join(projectRoot, artifactRelative) : null;
  const artifactExists = artifactPath ? await access(artifactPath, constants.F_OK).then(() => true).catch(() => false) : false;
  const script = artifactExists ? await readFile(artifactPath, "utf8") : "";
  const checks = {
    schemaVersion: project.schemaVersion === 1,
    id: typeof project.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id),
    name: typeof project.name === "string" && project.name.length > 0,
    description: typeof project.description === "string" && project.description.length > 0,
    mode: project.mode === "direct" || project.mode === "bundle",
    targets: Array.isArray(project.targets?.matches) && project.targets.matches.length > 0 && Array.isArray(project.targets?.requiredVerification),
    permissions: Array.isArray(project.permissions?.grants) && Array.isArray(project.permissions?.connect) && typeof project.permissions?.justifications === "object",
    permissionReasons: Array.isArray(project.permissions?.grants) && project.permissions.grants.every((grant) => typeof project.permissions.justifications?.[grant] === "string" && project.permissions.justifications[grant].length > 0),
    release: typeof project.release?.githubRepository === "string" && typeof project.release?.greasyForkRequired === "boolean",
    singleDirectScript: project.mode === "direct" ? directScriptFiles.length === 1 : true,
    bundleConfig: project.mode !== "bundle" || (project.build?.adapter === "esbuild" && project.build?.entry === "src/index.ts" && bundleOutputSafe && project.build?.minify === false),
    bundleArtifact: project.mode !== "bundle" || artifactExists,
    metadataBlock: /\/\/ ==UserScript==[\s\S]*\/\/ ==\/UserScript==/.test(script),
    metadataRequired: ["name", "namespace", "version", "description", "license"].every((key) => new RegExp(`@${key}\\s+\\S+`).test(script)) && /@match\s+\S+/.test(script),
    targetMatchesDeclared: Array.isArray(project.targets?.matches) && project.targets.matches.every((match) => script.includes(`@match        ${match}`) || script.includes(`@match ${match}`)),
  };
  const publicFiles = ["README.md", "LICENSE", "userscript.project.json", ...directScriptFiles.map((file) => path.join("userscripts", file))];
  if (project.mode === "bundle") publicFiles.push("build.mjs", project.build?.entry, project.build?.output);
  const forbidden = [];
  for (const relativePath of publicFiles) {
    if (!relativePath) continue;
    const contents = await readFile(path.join(projectRoot, relativePath), "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    for (const pattern of policy.forbiddenTextPatterns) {
      if (contents.includes(pattern)) forbidden.push({ file: relativePath, pattern });
    }
  }
  checks.forbiddenText = forbidden;
  checks.pass = Object.entries(checks)
    .filter(([key]) => key !== "forbiddenText")
    .every(([, value]) => value === true) && forbidden.length === 0;
  return { project: project.id ?? null, checks, pass: checks.pass, artifactRelative };
}

async function validateProject(args, json) {
  const projectRoot = projectPathFromArg(args[0]);
  const result = await collectProjectValidation(projectRoot);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const [key, value] of Object.entries(result.checks)) console.log(`${key}: ${Array.isArray(value) ? (value.length ? "FAIL" : "PASS") : value ? "PASS" : "FAIL"}`);
    console.log(`Project validate: ${result.pass ? "PASS" : "FAIL"}`);
  }
  if (!result.pass) process.exitCode = 1;
  return result;
}

async function buildProject(args, json) {
  requireSupportedRuntime("build");
  const projectRoot = projectPathFromArg(args[0]);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  if (project.mode !== "bundle") throw new Error("build only applies to bundle projects");
  if (project.build?.adapter !== "esbuild") throw new Error("Bundle project must declare the esbuild adapter");
  const validation = await collectProjectValidation(projectRoot);
  if (!validation.checks.bundleConfig) throw new Error("Bundle project manifest has an unsafe or unsupported build configuration");
  const buildScript = path.join(projectRoot, "build.mjs");
  await access(buildScript, constants.F_OK);
  let output;
  try {
    output = execFileSync(process.execPath, [buildScript], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const details = String(error?.stderr || error?.stdout || error?.message || "bundle build failed").trim();
    throw new Error(`Bundle build failed: ${details}`);
  }
  const outputRelative = project.build.output;
  const outputPath = path.join(projectRoot, outputRelative);
  const artifactSha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  const result = { project: project.id, adapter: project.build.adapter, output: outputRelative, sha256: artifactSha256, pass: true };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${output.trim()}\nBundle: PASS\nArtifact: ${outputRelative}\nSHA-256: ${artifactSha256}`);
}

function gitOutput(projectRoot, args) {
  try {
    return { value: execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), error: null };
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Git is required for candidate locking but was not found on PATH");
    return { value: null, error: String(error?.stderr || error?.message || "git command failed").trim() };
  }
}

async function candidate(args, json) {
  const projectRoot = projectPathFromArg(args[0]);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const validation = await collectProjectValidation(projectRoot);
  const scriptRoot = path.join(projectRoot, "userscripts");
  const scriptFiles = await readdir(scriptRoot).catch((error) => (error?.code === "ENOENT" ? [] : Promise.reject(error)));
  const directScriptFiles = scriptFiles.filter((item) => item.endsWith(".user.js"));
  const bundleOutput = project.mode === "bundle" && typeof project.build?.output === "string" ? project.build.output : null;
  const bundleOutputSafe = bundleOutput && !path.isAbsolute(bundleOutput) && !bundleOutput.split("/").includes("..") && bundleOutput.startsWith("dist/") && bundleOutput.endsWith(".user.js");
  const artifactRelative = project.mode === "bundle" ? (bundleOutputSafe ? bundleOutput : null) : (directScriptFiles.length === 1 ? path.join("userscripts", directScriptFiles[0]) : null);
  const sourceCommitResult = gitOutput(projectRoot, ["rev-parse", "HEAD"]);
  const gitStatusResult = gitOutput(projectRoot, ["status", "--porcelain"]);
  const sourceCommit = sourceCommitResult.value;
  const gitStatus = gitStatusResult.value;
  const artifactPath = artifactRelative ? path.join(projectRoot, artifactRelative) : null;
  const artifactExists = artifactPath ? await access(artifactPath, constants.F_OK).then(() => true).catch(() => false) : false;
  const artifactSha256 = artifactExists ? createHash("sha256").update(await readFile(artifactPath)).digest("hex") : null;
  const checks = [
    { id: "runtime-baseline", status: runtimePass() ? "PASS" : "FAIL" },
    { id: "project-validation", status: validation.pass ? "PASS" : "FAIL" },
    { id: "single-artifact", status: artifactExists ? "PASS" : "FAIL" },
    { id: "git-source-commit", status: sourceCommit ? "PASS" : "FAIL" },
    { id: "git-clean", status: gitStatus === "" ? "PASS" : "FAIL" },
    { id: "artifact-sha256", status: artifactSha256 ? "PASS" : "FAIL" },
  ];
  const status = checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
  const timestamp = new Date().toISOString();
  const runId = `candidate-${project.id}-${timestamp.replace(/[:.]/g, "-")}`;
  const notes = ["This is a static candidate lock. Manager, device, and publication gates remain separate."];
  if (sourceCommitResult.error) notes.push(`Git source commit check: ${sourceCommitResult.error}`);
  if (gitStatusResult.error) notes.push(`Git clean check: ${gitStatusResult.error}`);
  const evidence = {
    schemaVersion: 1,
    runId,
    status,
    project: project.id ?? null,
    probe: "candidate",
    ...(sourceCommit ? { sourceCommit } : {}),
    artifact: {
      ...(artifactRelative ? { path: `projects/${project.id}/${artifactRelative}` } : {}),
      ...(artifactSha256 ? { sha256: artifactSha256 } : {}),
    },
    environment: {
      staticValidation: status,
      managerInjection: "NOT_RUN",
      releaseReady: false,
    },
    checks,
    notes,
    startedAt: timestamp,
    finishedAt: new Date().toISOString(),
  };
  const privateEvidenceDir = path.resolve(ROOT, "..", "private", "evidence", project.id, "candidate");
  await mkdir(privateEvidenceDir, { recursive: true, mode: 0o700 });
  const evidencePath = path.join(privateEvidenceDir, `${runId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const result = { ...evidence, evidencePath: path.relative(path.resolve(ROOT, ".."), evidencePath) };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Candidate: ${status}\nEvidence: ${result.evidencePath}\nRelease ready: no (manager/device/publication gates remain)`);
  if (status !== "PASS") process.exitCode = 1;
}

async function main() {
  const { command, json, rest } = parseArgs(process.argv.slice(2));
  if (command === "doctor") return doctor(json);
  if (command === "validate") return validate(json);
 if (command === "validate-project") return validateProject(rest, json);
 if (command === "validate-evidence") return validateEvidence(rest, json);
  if (command === "release-check") return releaseCheck(rest, json);
 if (command === "build") return buildProject(rest, json);
  if (command === "new") return newProject(rest, json);
  if (command === "candidate") return candidate(rest, json);
  if (command === "status") return status(json);
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
