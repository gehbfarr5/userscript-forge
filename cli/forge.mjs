#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  ".github/workflows/ci.yml",
  "schemas/project.schema.json",
  "schemas/result.schema.json",
  "schemas/capability.schema.json",
  "schemas/work-order.schema.json",
  "schemas/mobile-userscript-probe.schema.json",
  "schemas/greasyfork-publication-probe.schema.json",
  "policies/public-boundary.json",
  "docs/contracts/lifecycle.md",
  "docs/contracts/intake.md",
  "registry/capabilities.json",
  "probes/mobile/README.md",
  "probes/mobile/userscript-canary.manifest.json",
  "probes/mobile/oneplus-userscript.manifest.json",
  "probes/publication/greasyfork.manifest.json",
  "probes/publication/README.md",
  "templates/work-order.example.json",
];

function usage() {
  console.log("mobile-handoff <path> --candidate PATH [--target emulator|oneplus] [--base-url URL] [--port NUMBER]: validate and emit the external mobile userscript handoff");
  console.log("greasyfork-handoff <path> --candidate PATH --script-id ID [--base-url URL]: validate and emit the browser publication handoff");
  console.log("release-check <path> [options]: provide --candidate, --require, and matching --manager/--device/--emulator/--oneplus/--github/--greasyfork evidence paths");
  console.log("record-capability <id> <evidence> [--dry-run] [--json]: promote one validated private evidence record into the public capability registry");
  console.log("validate-work-order <path> [--json]: validate one private structured intake work order");
  console.log("new --verify ID (repeatable): declare a concrete required verification target such as android-emulator-firefox-manager or oneplus-15-firefox-manager");
  console.log(`Userscript Forge CLI (Stage B2)\n\nCommands:\n  doctor [--json]    Check runtime and repository prerequisites\n  validate [--json] Check the public scaffold and policy files\n  validate-project <path> [--json]  Check one independent script repository\n  validate-evidence <path> [--json] Validate one private structured result\n  build <path> [--json]             Build a bundle project into its tracked dist artifact\n  new <id> [options] Create an independent userscript project\n  candidate <path> [--json] Lock a clean static candidate and write private evidence\n  release-check <path> [options]   Run the fail-closed pre-publication gate\n  publish-github <path> [options] Publish a checked candidate to a GitHub Release\n  status [--json]   Show the current local stage\n\nnew options:\n  --name TEXT --description TEXT --repository URL --match PATTERN (repeatable)\n  --grant NAME --grant-reason NAME=TEXT (repeatable, paired)\n  --connect HOST --connect-reason HOST=TEXT (repeatable, paired)\n  --namespace URL --release-branch NAME --mode direct|bundle --greasy-fork | --no-greasy-fork\n  --dry-run (render without writing) --no-git (do not initialize Git)\n\nrelease-check evidence options:\n  --manager PATH --device PATH (legacy generic device slot)\n  --emulator PATH --oneplus PATH (explicit Android userscript targets)\n  --github PATH --greasyfork PATH\n\npublish-github options:\n  --release-evidence PATH (required; a matching release-check PASS result)\n  --tag vX.Y.Z --title TEXT --notes TEXT --dry-run\n`);
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

const MOBILE_MANIFEST_PATHS = {
  emulator: "probes/mobile/userscript-canary.manifest.json",
  oneplus: "probes/mobile/oneplus-userscript.manifest.json",
};

function mobileManifestPath(target) {
  if (!MOBILE_MANIFEST_PATHS[target]) throw new Error(`Unknown mobile userscript target '${target}'`);
  return MOBILE_MANIFEST_PATHS[target];
}

async function loadMobileManifest(target) {
  return loadJson(mobileManifestPath(target));
}

function mobileManifestForEvidence(evidence, manifests) {
  const target = evidence?.environment?.target;
  if (target === "oneplus-15-firefox-manager" || evidence?.probe === "oneplus-15-firefox-manager") return manifests.oneplus;
  if (target === "android-emulator-firefox-manager" || evidence?.probe === "android-emulator-manager") return manifests.emulator;
  return null;
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

async function findEvidenceByRunId(runId) {
  if (!runId) return null;
  const evidenceRoot = path.resolve(ROOT, "..", "private", "evidence");
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await walk(entryPath);
        if (nested) return nested;
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const evidence = JSON.parse(await readFile(entryPath, "utf8"));
          if (evidence.runId === runId) return evidence;
        } catch {
          // Status is a read-only summary; malformed historical files are reported as unavailable.
        }
      }
    }
    return null;
  }
  return walk(evidenceRoot);
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
  const workOrderSchema = await loadJson("schemas/work-order.schema.json");
  const mobileProbeSchema = await loadJson("schemas/mobile-userscript-probe.schema.json");
  const greasyForkProbeSchema = await loadJson("schemas/greasyfork-publication-probe.schema.json");
  const workOrderExample = await loadJson("templates/work-order.example.json");
  const mobileProbeManifest = await loadMobileManifest("emulator");
  const oneplusProbeManifest = await loadMobileManifest("oneplus");
  const greasyForkProbeManifest = await loadJson("probes/publication/greasyfork.manifest.json");
  const capabilities = await loadJson("registry/capabilities.json");
  const capabilityValidator = new Ajv2020({ allErrors: true, strict: false }).compile(capabilitySchema);
  const workOrderValidator = new Ajv2020({ allErrors: true, strict: false }).compile(workOrderSchema);
  const mobileProbeValidator = new Ajv2020({ allErrors: true, strict: false }).compile(mobileProbeSchema);
  const greasyForkProbeValidator = new Ajv2020({ allErrors: true, strict: false }).compile(greasyForkProbeSchema);
  const policy = await loadJson("policies/public-boundary.json");
  const packageJson = await loadJson("package.json");
  const nodeVersion = (await readFile(path.join(ROOT, ".node-version"), "utf8")).trim();
  const checks = {
    schemaFiles: Boolean(projectSchema.$schema && resultSchema.$schema && capabilitySchema.$schema && workOrderSchema.$schema && mobileProbeSchema.$schema && greasyForkProbeSchema.$schema),
    schemaVersions: projectSchema.schemaVersion === 1 && resultSchema.schemaVersion === 1 && capabilitySchema.schemaVersion === 1 && workOrderSchema.schemaVersion === 1 && mobileProbeSchema.schemaVersion === 1 && greasyForkProbeSchema.schemaVersion === 1,
    workOrderExampleSchema: workOrderValidator(workOrderExample),
    mobileProbeManifestSchema: mobileProbeValidator(mobileProbeManifest) && mobileProbeValidator(oneplusProbeManifest),
    greasyForkProbeManifestSchema: greasyForkProbeValidator(greasyForkProbeManifest),
    capabilityRegistryVersion: capabilities.schemaVersion === 1 && Array.isArray(capabilities.capabilities),
    capabilityRegistrySchema: capabilityValidator(capabilities),
    policyVersion: policy.version === 1,
    packageType: packageJson.type === "module",
    packageManagerPinned: packageJson.packageManager === "pnpm@11.1.1",
    nodeRangePinned: packageJson.engines?.node === ">=24 <25",
    nodeVersionPinned: nodeVersion === "24.18.0",
    noPrivateTree: !(await exists("private")),
  };
  const publicFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "LICENSE",
    ".node-version",
    "package.json",
    "cli/forge.mjs",
    "schemas/work-order.schema.json",
    "templates/work-order.example.json",
    "docs/contracts/intake.md",
    "registry/capabilities.json",
    "probes/mobile/userscript-canary.manifest.json",
    "probes/mobile/oneplus-userscript.manifest.json",
    "probes/publication/greasyfork.manifest.json",
  ];
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
  const capabilityRegistry = await loadJson("registry/capabilities.json");
  const capabilities = Object.fromEntries(await Promise.all(capabilityRegistry.capabilities.map(async (capability) => {
    const evidence = await findEvidenceByRunId(capability.evidenceRunId);
    const evidenceStatus = evidence?.status ?? null;
    const evidenceCompatible = !evidenceStatus
      || (capability.status === "CONDITIONAL_PASS" && ["PASS", "BLOCKED"].includes(evidenceStatus))
      || evidenceStatus === capability.status;
    const status = evidenceCompatible ? capability.status : "INCONSISTENT";
    return [capability.id, {
      status,
      registryStatus: capability.status,
      evidenceStatus,
      evidenceRunId: capability.evidenceRunId ?? null,
    }];
  })));
  const capabilityStatus = (id) => capabilities[id]?.status ?? "NOT_RUN";
  const directProbe = capabilityStatus("desktop-direct-browser");
  const managerProbe = capabilityStatus("desktop-tampermonkey-manager");
  const androidProbe = capabilityStatus("android-emulator-firefox-manager");
  const onePlusProbe = capabilityStatus("oneplus-15-firefox-manager");
  const iphoneProbe = capabilityStatus("iphone-safari-stay");
  const githubProbe = capabilityStatus("github-public-repository-push");
  const greasyForkProbe = capabilityStatus("greasyfork-publication");
  const publicationStatus = githubProbe === "PASS" && greasyForkProbe === "PASS"
    ? "PASS"
    : githubProbe === "PASS" || greasyForkProbe === "PASS"
      ? "PARTIAL"
      : greasyForkProbe;
  const result = {
    stage: "B2",
    remoteConfigured: Boolean(remoteMatch),
    remoteUrl: remoteMatch?.[1] ?? null,
    directProbe,
    directBrowserVerified: directProbe === "PASS",
    managerProbe,
    managerInjectionVerified: managerProbe === "PASS",
    mobile: { androidEmulator: androidProbe, onePlus15: onePlusProbe, iphoneSafariStay: iphoneProbe },
    publication: { github: githubProbe, greasyFork: greasyForkProbe, status: publicationStatus },
    capabilities,
    deviceConnected: false,
    publicationEnabled: publicationStatus === "PASS",
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log([
    `Stage: ${result.stage}`,
    `Remote: ${result.remoteConfigured ? result.remoteUrl : "not configured"}`,
    `Direct probe: ${result.directProbe}`,
    `Direct browser: ${result.directBrowserVerified ? "verified" : "not verified"}`,
    `Manager probe: ${result.managerProbe}`,
    `Manager injection: ${result.managerInjectionVerified ? "verified" : "not verified"}`,
    `Android emulator: ${result.mobile.androidEmulator}`,
    `OnePlus 15: ${result.mobile.onePlus15}`,
    `iPhone Safari + Stay: ${result.mobile.iphoneSafariStay}`,
    `GitHub: ${result.publication.github}`,
    `Greasy Fork: ${result.publication.greasyFork}`,
    `Publication gate: ${result.publication.status}`,
  ].join("\n"));
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

function workOrderPathFromArg(argument) {
  if (!argument) throw new Error("validate-work-order requires a work-order.json path");
  const privateRoot = path.resolve(ROOT, "..", "private");
  const workOrdersRoot = path.join(privateRoot, "work-orders");
  const candidate = path.resolve(ROOT, argument);
  if (candidate !== workOrdersRoot && !candidate.startsWith(`${workOrdersRoot}${path.sep}`)) {
    throw new Error(`Work-order path must be inside ${workOrdersRoot}`);
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
    verifications: [],
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
    else if (["--name", "--description", "--repository", "--namespace", "--release-branch", "--mode", "--match", "--verify", "--grant", "--connect", "--grant-reason", "--connect-reason"].includes(option)) {
      const value = takeOptionValue(args, index, option);
      index += 1;
      if (option === "--name") options.name = singleLine(value, "--name");
      else if (option === "--description") options.description = singleLine(value, "--description");
      else if (option === "--repository") options.repository = singleLine(value, "--repository");
      else if (option === "--namespace") options.namespace = singleLine(value, "--namespace");
      else if (option === "--release-branch") options.releaseBranch = singleLine(value, "--release-branch");
      else if (option === "--mode") options.mode = value;
      else if (option === "--match") options.matches.push(singleLine(value, "--match"));
      else if (option === "--verify") {
        const verification = singleLine(value, "--verify");
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(verification)) throw new Error("--verify must be a lowercase kebab-case capability id");
        options.verifications.push(verification);
      }
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
    targets: { matches: options.matches, requiredVerification: [...new Set(["local-static", "local-direct-browser", "declared-platforms", ...options.verifications])] },
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
  const requiredVerification = [...new Set(["local-static", "local-direct-browser", "declared-platforms", ...options.verifications])];
  return `# ${options.name}\n\n${options.description}\n\n- Mode: \`${options.mode}\`\n- Declared matches: ${options.matches.map((match) => `\`${match}\``).join(", ")}\n- Required verification: ${requiredVerification.map((item) => `\`${item}\``).join(", ")}\n- GitHub: ${options.repository}\n- Greasy Fork required: ${options.greasyForkRequired ? "yes" : "no"}\n\n## Local workflow\n\nRun the central project validator before creating a release candidate:\n\n\`\`\`text\npnpm run forge -- validate-project ../projects/${options.id} --json\n\`\`\`\n${bundleSteps}\nThe generated script is a scaffold. Add behavior only after the target matrix and permission reasons are confirmed.\n`;
}

function projectWorkflow(options) {
  const verification = options.mode === "bundle"
    ? `      - name: Set up pnpm\n        uses: pnpm/action-setup@v4\n        with:\n          version: 11.1.1\n      - name: Install dependencies\n        run: pnpm install --frozen-lockfile\n      - name: Build readable artifact\n        run: pnpm run build\n      - name: Run project tests\n        run: pnpm test\n      - name: Check bundle syntax\n        run: node --check dist/${options.id}.user.js`
    : `      - name: Run project tests\n        run: node --test\n      - name: Check userscript syntax\n        run: node --check userscripts/${options.id}.user.js`;
  return `name: Userscript project CI\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Check out\n        uses: actions/checkout@v4\n      - name: Set up Node 24\n        uses: actions/setup-node@v4\n        with:\n          node-version: 24.18.0\n${verification}\n`;
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
    ...(bundle ? { pnpm: { onlyBuiltDependencies: ["esbuild"] } } : {}),
    ...(bundle ? { devDependencies: { esbuild: "0.28.1" } } : {}),
  };
  const files = bundle ? {
    "README.md": generatedReadme(options),
    ".github/workflows/ci.yml": projectWorkflow(options),
    ".gitignore": "node_modules/\n.pnpm-store/\n.playwright-cli/\n.DS_Store\n",
    "package.json": JSON.stringify(packageJson, null, 2) + "\n",
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: true\n",
    "userscript.project.json": JSON.stringify(manifest, null, 2) + "\n",
    "build.mjs": `import { build } from "esbuild";\nimport { mkdir, readFile } from "node:fs/promises";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));\nconst project = JSON.parse(await readFile(path.join(ROOT, "userscript.project.json"), "utf8"));\nconst packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));\nif (project.mode !== "bundle" || project.build?.adapter !== "esbuild") throw new Error("Bundle project must use the esbuild adapter");\nif (project.build.minify !== false) throw new Error("Userscript bundle output must remain unminified");\nconst metadata = [\n  "// ==UserScript==",\n  "// @name         " + project.name,\n  "// @namespace    " + project.release.githubRepository,\n  "// @version      " + packageJson.version,\n  "// @description  " + project.description,\n  ...project.targets.matches.map((match) => "// @match        " + match),\n  ...project.permissions.grants.map((grant) => "// @grant        " + grant),\n  ...project.permissions.connect.map((host) => "// @connect      " + host),\n  "// @run-at       document-idle",\n  "// @license      MIT",\n  "// ==/UserScript==",\n  ""\n].join("\\n");\nconst output = path.resolve(ROOT, project.build.output);\nawait mkdir(path.dirname(output), { recursive: true });\nawait build({\n  entryPoints: [path.resolve(ROOT, project.build.entry)],\n  outfile: output,\n  bundle: true,\n  format: "iife",\n  target: "es2020",\n  minify: false,\n  sourcemap: false,\n  legalComments: "inline",\n  banner: { js: metadata },\n  logLevel: "info"\n});\nconsole.log(project.id + ": " + project.build.output + " (version " + packageJson.version + ")");\n`,
    "src/index.ts": `const panel = document.createElement("aside");\npanel.textContent = "Bundle project scaffold";\npanel.dataset.userscriptForge = "bundle";\ndocument.documentElement.append(panel);\n`,
    "tests/source.test.mjs": `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst project = JSON.parse(await readFile(new URL("../userscript.project.json", import.meta.url), "utf8"));\nconst source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");\n\ntest("bundle project declares the central esbuild adapter", () => {\n  assert.equal(project.mode, "bundle");\n  assert.equal(project.build.adapter, "esbuild");\n  assert.equal(project.build.minify, false);\n  assert.match(source, /userscriptForge/);\n});\n`,
  } : {
    "README.md": generatedReadme(options),
    ".github/workflows/ci.yml": projectWorkflow(options),
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
    if (!options.dryRun) {
      try {
        execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        const details = String(error?.stderr || error?.stdout || error?.message || "lockfile generation failed").trim();
        throw new Error(`Unable to generate pnpm-lock.yaml: ${details}`);
      }
      if (options.gitInit) execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
    }
  }
  const result = { id: options.id, mode: options.mode, requiredVerification: manifest.targets.requiredVerification, projectRoot: options.dryRun ? null : projectRoot, files: Object.keys(files).concat("LICENSE", ...(!options.dryRun ? ["pnpm-lock.yaml"] : [])), gitInitialized: !options.dryRun && options.gitInit, lockfileGenerated: !options.dryRun, dryRun: options.dryRun };
  if (json || options.dryRun) console.log(JSON.stringify(result, null, 2));
  else console.log(`Created ${projectRoot}\nRun: pnpm run forge -- validate-project ../projects/${options.id} --json`);
}

function inspectEvidence(evidence, validator, evidencePath, mobileManifest = null) {
  const schemaValid = validator(evidence);
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const ids = checks.map((check) => check.id);
  const uniqueCheckIds = new Set(ids).size === ids.length;
  const passStatusHasOnlyPassChecks = evidence.status !== "PASS" || checks.every((check) => check.status === "PASS");
  const isMobileManagerEvidence = ["android-emulator-manager", "oneplus-15-firefox-manager"].includes(evidence.probe);
  const requiredMobileChecks = isMobileManagerEvidence && mobileManifest ? mobileManifest.requiredChecks : [];
  const checksById = new Map(checks.map((check) => [check.id, check]));
  const mobileTargetMatches = !isMobileManagerEvidence || (mobileManifest && evidence.environment?.target === mobileManifest.target.id);
  const mobileRequiredChecksPresent = requiredMobileChecks.every((id) => checksById.has(id));
  const mobileRequiredChecksPass = requiredMobileChecks.every((id) => checksById.get(id)?.status === "PASS");
  const mobileContract = {
    applicable: isMobileManagerEvidence,
    targetMatches: Boolean(mobileTargetMatches),
    requiredChecksPresent: mobileRequiredChecksPresent,
    requiredChecksPass: mobileRequiredChecksPass,
    // A non-PASS result is still useful evidence when the probe reached a real
    // environment boundary. Only PASS evidence must prove every required check.
    // release-check separately enforces PASS for any platform needed to publish.
    pass: !isMobileManagerEvidence || Boolean(mobileManifest && mobileTargetMatches && mobileRequiredChecksPresent && (evidence.status !== "PASS" || mobileRequiredChecksPass)),
  };
  return {
    path: path.relative(path.resolve(ROOT, ".."), evidencePath),
    schemaValid,
    uniqueCheckIds,
    passStatusHasOnlyPassChecks,
    mobileContract,
    errors: validator.errors ?? [],
    pass: schemaValid && uniqueCheckIds && passStatusHasOnlyPassChecks && mobileContract.pass,
  };
}

function releaseEvidenceProbeMatches(kind, probe) {
  if (typeof probe !== "string") return false;
  if (kind === "manager") return ["stage-b-manager", "stage-b-manager-v012", "stage-b-manager-v013"].includes(probe);
  if (kind === "device") return ["android-emulator-manager", "oneplus-15-firefox-manager"].includes(probe);
  if (kind === "emulator") return probe === "android-emulator-manager";
  if (kind === "oneplus") return probe === "oneplus-15-firefox-manager";
  if (kind === "github") return ["github-publish", "github-publish-adapter"].includes(probe);
  if (kind === "greasyfork") return ["greasyfork-first-import", "greasyfork-version-sync"].includes(probe);
  return false;
}

const CAPABILITY_PROBE_ALLOWLIST = {
  "desktop-direct-browser": ["stage-b-direct"],
  "desktop-tampermonkey-manager": ["stage-b-manager", "stage-b-manager-v012", "stage-b-manager-v013"],
  "android-emulator-firefox-manager": ["android-emulator-manager"],
  "android-emulator-appium-backend": ["mobile-backend-android-emulator"],
  "oneplus-15-firefox-manager": ["oneplus-15-firefox-manager"],
  "oneplus-15-appium-backend": ["mobile-backend-oneplus-real"],
  "iphone-safari-stay": ["iphone-safari-stay"],
  "ios-simulator-appium-backend": ["mobile-backend-ios-simulator"],
  "iphone-real-appium-backend": ["mobile-backend-iphone-real"],
  "github-public-repository-push": ["github-publish", "github-publish-adapter", "github-release-v012"],
  "greasyfork-publication": ["greasyfork-first-import", "greasyfork-version-sync"],
  "codex-claude-cli-core": ["agent-cli-core-readonly"],
  "codex-cli-readonly-contract": ["agent-cli-codex-readonly"],
  "claude-cli-readonly-auth": ["agent-cli-claude-readonly"],
};

const DECLARED_RELEASE_REQUIREMENTS = {
  "desktop-tampermonkey-manager": "manager",
  "android-emulator-firefox-manager": "emulator",
  "oneplus-15-firefox-manager": "oneplus",
  "github-public-repository-push": "github",
  "greasyfork-publication": "greasyfork",
};

function capabilityProbeMatches(capabilityId, probe) {
  return CAPABILITY_PROBE_ALLOWLIST[capabilityId]?.includes(probe) ?? false;
}

function forbiddenEvidenceKeys(value, forbiddenFields, prefix = "") {
  if (!value || typeof value !== "object") return [];
  const violations = [];
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (forbiddenFields.includes(key)) violations.push(keyPath);
    violations.push(...forbiddenEvidenceKeys(nested, forbiddenFields, keyPath));
  }
  return violations;
}

function parseReleaseCheckOptions(args) {
  const options = { candidate: null, required: new Set(), evidence: {} };
  const evidenceOptions = new Map([
    ["--manager", "manager"],
    ["--device", "device"],
    ["--emulator", "emulator"],
    ["--oneplus", "oneplus"],
    ["--github", "github"],
    ["--greasyfork", "greasyfork"],
  ]);
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
        if (!["manager", "device", "emulator", "oneplus", "github", "greasyfork"].includes(kind)) throw new Error(`Unknown release evidence kind '${kind}'`);
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
  const mobileManifests = {
    emulator: await loadMobileManifest("emulator"),
    oneplus: await loadMobileManifest("oneplus"),
  };
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const result = inspectEvidence(evidence, validator, evidencePath, mobileManifestForEvidence(evidence, mobileManifests));
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

async function validateWorkOrder(args, json) {
  requireSupportedRuntime("validate-work-order");
  const workOrderPath = workOrderPathFromArg(args[0]);
  const schema = await loadJson("schemas/work-order.schema.json");
  const workOrder = JSON.parse(await readFile(workOrderPath, "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const schemaValid = validator(workOrder);
  const result = {
    path: path.relative(path.resolve(ROOT, ".."), workOrderPath),
    projectId: workOrder.projectId ?? null,
    schemaVersion: workOrder.schemaVersion ?? null,
    schemaValid,
    errors: validator.errors ?? [],
    pass: schemaValid,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Work-order schema: ${result.schemaValid ? "PASS" : "FAIL"}`);
    if (result.errors.length) console.log(JSON.stringify(result.errors, null, 2));
    console.log(`Work-order validate: ${result.pass ? "PASS" : "FAIL"}`);
  }
  if (!result.pass) process.exitCode = 1;
}

async function recordCapability(args, json) {
  requireSupportedRuntime("record-capability");
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((item) => item !== "--dry-run");
  if (!positional[0] || positional[0].startsWith("--")) throw new Error("record-capability requires a capability id");
  if (!positional[1] || positional[1].startsWith("--")) throw new Error("record-capability requires a private evidence path");
  if (positional.length > 2) throw new Error("Unknown record-capability option");
  const capabilityId = positional[0];
  const evidencePath = evidencePathFromArg(positional[1]);
  const registryPath = path.join(ROOT, "registry", "capabilities.json");
  const dirty = gitOutput(ROOT, ["status", "--porcelain"]);
  if (dirty.error || dirty.value) throw new Error("record-capability requires a clean central repository; commit or stash existing changes first");
  const registry = await loadJson("registry/capabilities.json");
  const capability = registry.capabilities.find((item) => item.id === capabilityId);
  if (!capability) throw new Error(`Unknown capability '${capabilityId}'`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const evidenceSchema = await loadJson("schemas/result.schema.json");
  const mobileManifests = {
    emulator: await loadMobileManifest("emulator"),
    oneplus: await loadMobileManifest("oneplus"),
  };
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(evidenceSchema);
  const mobileManifest = mobileManifestForEvidence(evidence, mobileManifests);
  const inspection = inspectEvidence(evidence, validator, evidencePath, mobileManifest);
  if (!inspection.pass) throw new Error(`Evidence validation failed: ${JSON.stringify(inspection)}`);
  if (!capabilityProbeMatches(capabilityId, evidence.probe)) {
    throw new Error(`Evidence probe '${evidence.probe}' is not allowed for capability '${capabilityId}'`);
  }
  const forbiddenFields = mobileManifest?.evidence?.forbiddenFields || [];
  const forbiddenKeys = forbiddenEvidenceKeys(evidence, forbiddenFields);
  if (forbiddenKeys.length) throw new Error(`Evidence contains forbidden private fields: ${forbiddenKeys.join(", ")}`);
  if (!["PASS", "FAIL", "BLOCKED", "NOT_RUN"].includes(evidence.status)) throw new Error(`Unsupported capability evidence status '${evidence.status}'`);
  const nextRegistry = {
    ...registry,
    capabilities: registry.capabilities.map((item) => item.id === capabilityId ? {
      ...item,
      status: evidence.status,
      verification: evidence.status === "NOT_RUN" ? "not-run" : "structured-evidence",
      evidenceRunId: evidence.runId,
      note: `Current evidence: ${evidence.probe} ${evidence.status}. Previous runs remain in private evidence.`,
    } : item),
  };
  const capabilitySchema = await loadJson("schemas/capability.schema.json");
  const capabilityValidator = new Ajv2020({ allErrors: true, strict: false }).compile(capabilitySchema);
  if (!capabilityValidator(nextRegistry)) throw new Error(`Updated capability registry is invalid: ${JSON.stringify(capabilityValidator.errors)}`);
  if (!dryRun) {
    const temporaryPath = `${registryPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${JSON.stringify(nextRegistry, null, 2)}\n`, { mode: 0o644 });
    await rename(temporaryPath, registryPath);
  }
  const result = {
    capabilityId,
    status: evidence.status,
    probe: evidence.probe,
    evidenceRunId: evidence.runId,
    evidencePath: path.relative(path.resolve(ROOT, ".."), evidencePath),
    registryPath: path.relative(path.resolve(ROOT, ".."), registryPath),
    dryRun,
    pass: true,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${dryRun ? "Capability preview" : "Capability recorded"}: ${capabilityId} = ${evidence.status}\nEvidence: ${evidence.runId}${dryRun ? "" : "\nCommit the registry change before pushing it publicly."}`);
}

async function releaseCheck(args, json) {
  requireSupportedRuntime("release-check");
  const options = parseReleaseCheckOptions(args);
  const projectRoot = projectPathFromArg(options.project);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const evidenceSchema = await loadJson("schemas/result.schema.json");
  const mobileManifests = {
    emulator: await loadMobileManifest("emulator"),
    oneplus: await loadMobileManifest("oneplus"),
  };
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(evidenceSchema);
  const checks = [];
  const addCheck = (id, status, details = undefined) => checks.push({ id, status, ...(details ? { details } : {}) });
  const validation = await collectProjectValidation(projectRoot);
  const declaredMobileTargets = new Set((project.targets?.requiredVerification || []).filter((item) => ["android-emulator-firefox-manager", "oneplus-15-firefox-manager"].includes(item)));
  addCheck("project-validation", validation.pass ? "PASS" : "FAIL", validation.checks);
  if (project.release?.githubRepository && !options.required.has("github")) {
    addCheck("release-github-evidence-required", "FAIL", {
      reason: "Every project with a GitHub repository must include --require github.",
      repository: project.release.githubRepository,
    });
  }
  if (project.release?.greasyForkRequired && !options.required.has("greasyfork")) {
    addCheck("release-greasyfork-evidence-required", "FAIL", {
      reason: "This project declares Greasy Fork as required; include --require greasyfork.",
    });
  }
  for (const declaredTarget of project.targets?.requiredVerification || []) {
    const requiredKind = DECLARED_RELEASE_REQUIREMENTS[declaredTarget];
    if (requiredKind && !options.required.has(requiredKind)) {
      addCheck(`declared-${requiredKind}-evidence-required`, "FAIL", {
        declaredTarget,
        requiredKind,
        reason: "The project declares this verification target; release-check must include its explicit evidence kind.",
      });
    }
  }
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
    if (kind === "device" && declaredMobileTargets.size > 0) {
      addCheck("device-target-explicit", "FAIL", {
        reason: "Project declares explicit mobile userscript targets; use --emulator and/or --oneplus instead of generic --device.",
        declaredTargets: [...declaredMobileTargets],
      });
    }
    const evidenceArgument = options.evidence[kind];
    if (!evidenceArgument) {
      addCheck(`${kind}-evidence-present`, "FAIL", { reason: "required evidence path was not supplied" });
      continue;
    }
    const evidencePath = evidencePathFromArg(evidenceArgument);
    let evidence;
    try { evidence = JSON.parse(await readFile(evidencePath, "utf8")); }
    catch (error) { addCheck(`${kind}-evidence-readable`, "FAIL", { error: String(error?.message || error) }); continue; }
    const inspection = inspectEvidence(evidence, validator, evidencePath, mobileManifestForEvidence(evidence, mobileManifests));
    addCheck(`${kind}-evidence-schema`, inspection.pass ? "PASS" : "FAIL", inspection);
    addCheck(`${kind}-probe`, releaseEvidenceProbeMatches(kind, evidence.probe) ? "PASS" : "FAIL", {
      expected: kind === "manager"
        ? ["stage-b-manager", "stage-b-manager-v012", "stage-b-manager-v013"]
        : kind === "device"
          ? ["android-emulator-manager", "oneplus-15-firefox-manager"]
          : kind === "emulator"
            ? ["android-emulator-manager"]
            : kind === "oneplus"
              ? ["oneplus-15-firefox-manager"]
          : kind === "github"
            ? ["github-publish", "github-publish-adapter"]
            : ["greasyfork-first-import", "greasyfork-version-sync"],
      actual: evidence.probe,
    });
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

function parsePublishGithubOptions(args) {
  if (!args[0] || args[0].startsWith("--")) throw new Error("publish-github requires a project path");
  const options = { project: args[0], releaseEvidence: null, tag: null, title: null, notes: null, dryRun: false };
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--release-evidence") {
      options.releaseEvidence = takeOptionValue(args, index, option);
      index += 1;
    } else if (option === "--tag" || option === "--title" || option === "--notes") {
      const value = takeOptionValue(args, index, option);
      index += 1;
      if (option === "--tag") options.tag = singleLine(value, option);
      if (option === "--title") options.title = singleLine(value, option);
      if (option === "--notes") options.notes = singleLine(value, option);
    } else if (option === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown publish-github option '${option}'`);
  }
  if (!options.releaseEvidence) throw new Error("publish-github requires --release-evidence");
  return options;
}

function sanitizeExternalError(error) {
  return String(error?.stderr || error?.stdout || error?.message || "external command failed")
    .replace(/gho_[A-Za-z0-9_\-]+/g, "gho_<redacted>")
    .trim();
}

function ghRun(args) {
  try {
    return { ok: true, output: execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), error: null };
  } catch (error) {
    return { ok: false, output: String(error?.stdout || "").trim(), error: sanitizeExternalError(error) };
  }
}

function githubRepositoryName(repository) {
  if (typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return repository;
  let parsed;
  try { parsed = new URL(repository); }
  catch { throw new Error("release.githubRepository must be a valid GitHub URL"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") throw new Error("release.githubRepository must use https://github.com");
  const name = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) throw new Error("release.githubRepository must contain exactly owner/repository");
  return name;
}

function releaseVersion(script) {
  const match = script.match(/@version\s+([^\s]+)/);
  if (!match || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(match[1])) throw new Error("Userscript artifact must contain a semver @version");
  return match[1];
}

function inspectGithubRelease(output, tag, sourceCommit, artifactName, artifactSha256) {
  let release;
  try { release = JSON.parse(output); }
  catch { throw new Error("GitHub release view returned invalid JSON"); }
  const asset = Array.isArray(release.assets) ? release.assets.find((item) => item.name === artifactName) : null;
  const checks = [
    { id: "github-release-tag", status: release.tagName === tag ? "PASS" : "FAIL", details: { expected: tag, actual: release.tagName } },
    { id: "github-release-target", status: release.targetCommitish === sourceCommit ? "PASS" : "FAIL", details: { expected: sourceCommit, actual: release.targetCommitish } },
    { id: "github-release-asset", status: asset?.state === "uploaded" ? "PASS" : "FAIL", details: { name: artifactName, state: asset?.state ?? null } },
    { id: "github-release-asset-sha256", status: asset?.digest === `sha256:${artifactSha256}` ? "PASS" : "FAIL", details: { expected: `sha256:${artifactSha256}`, actual: asset?.digest ?? null } },
  ];
  return { release, asset, checks, pass: checks.every((check) => check.status === "PASS") };
}

async function publishGithub(args, json) {
  requireSupportedRuntime("publish-github");
  const options = parsePublishGithubOptions(args);
  const projectRoot = projectPathFromArg(options.project);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const validation = await collectProjectValidation(projectRoot);
  if (!validation.pass) throw new Error("Project validation failed; publish-github stopped");
  const headResult = gitOutput(projectRoot, ["rev-parse", "HEAD"]);
  const cleanResult = gitOutput(projectRoot, ["status", "--porcelain"]);
  if (!headResult.value || cleanResult.value !== "") throw new Error("publish-github requires a clean Git worktree with a source commit");
  const candidateArtifactPath = validation.artifactRelative ? path.join(projectRoot, validation.artifactRelative) : null;
  if (!candidateArtifactPath) throw new Error("publish-github requires one validated userscript artifact");
  const artifact = await readFile(candidateArtifactPath, "utf8");
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  const artifactName = path.basename(candidateArtifactPath);
  const version = releaseVersion(artifact);
  const tag = options.tag ?? `v${version}`;
  if (tag !== `v${version}`) throw new Error(`GitHub tag '${tag}' must match artifact version v${version}`);
  const repository = githubRepositoryName(project.release?.githubRepository);
  const evidencePath = evidencePathFromArg(options.releaseEvidence);
  const evidenceSchema = await loadJson("schemas/result.schema.json");
  const releaseEvidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: false }).compile(evidenceSchema);
  const inspection = inspectEvidence(releaseEvidence, validator, evidencePath);
  if (!inspection.pass || releaseEvidence.status !== "PASS" || releaseEvidence.probe !== "release-check") throw new Error("publish-github requires a valid release-check PASS evidence record");
  if (releaseEvidence.project !== project.id || releaseEvidence.sourceCommit !== headResult.value || releaseEvidence.artifact?.sha256 !== artifactSha256) {
    throw new Error("release-check evidence does not match the current project commit and artifact SHA-256");
  }
  const auth = ghRun(["auth", "status", "--hostname", "github.com"]);
  if (!auth.ok) throw new Error(`GitHub CLI authentication failed: ${auth.error}`);
  const title = options.title ?? `${project.name} v${version}`;
  const notes = options.notes ?? "Automated release after a passing Userscript Forge release-check.";
  const existing = ghRun(["release", "view", tag, "--repo", repository, "--json", "tagName,targetCommitish,assets,url"]);
  const releaseMissing = !existing.ok && /not found|404|no release/i.test(existing.error ?? "");
  if (!existing.ok && !releaseMissing) throw new Error(`GitHub release lookup failed: ${existing.error}`);
  if (existing.ok) {
    const inspected = inspectGithubRelease(existing.output, tag, headResult.value, artifactName, artifactSha256);
    if (!inspected.pass) throw new Error(`Existing GitHub release '${tag}' does not match the locked candidate`);
    const result = {
      status: options.dryRun ? "DRY_RUN" : "PASS",
      action: "already-present",
      project: project.id,
      repository,
      tag,
      sourceCommit: headResult.value,
      artifact: { path: `projects/${project.id}/${validation.artifactRelative}`, sha256: artifactSha256 },
      releaseUrl: inspected.release.url,
      checks: inspected.checks,
      note: "No external write was needed because the exact release and asset already exist.",
    };
    if (json) console.log(JSON.stringify(result, null, 2)); else console.log(`GitHub publish: ${result.status}\nAction: already-present\nRelease: ${result.releaseUrl}`);
    return;
  }
  if (options.dryRun) {
    const result = {
      status: "DRY_RUN",
      action: "would-create",
      project: project.id,
      repository,
      tag,
      sourceCommit: headResult.value,
      artifact: { path: `projects/${project.id}/${validation.artifactRelative}`, sha256: artifactSha256 },
      checks: [{ id: "github-release-absent", status: "PASS" }],
      note: "Dry-run performed no GitHub write and produced no PASS publication evidence.",
    };
    if (json) console.log(JSON.stringify(result, null, 2)); else console.log(`GitHub publish: DRY_RUN\nWould create: ${repository} ${tag}`);
    return;
  }
  const create = ghRun(["release", "create", tag, candidateArtifactPath, "--repo", repository, "--target", headResult.value, "--title", title, "--notes", notes]);
  if (!create.ok) throw new Error(`GitHub release creation failed: ${create.error}`);
  const published = ghRun(["release", "view", tag, "--repo", repository, "--json", "tagName,targetCommitish,assets,url"]);
  if (!published.ok) throw new Error(`GitHub release verification lookup failed: ${published.error}`);
  const inspected = inspectGithubRelease(published.output, tag, headResult.value, artifactName, artifactSha256);
  if (!inspected.pass) throw new Error(`GitHub release '${tag}' was created but failed exact commit/asset verification`);
  const timestamp = new Date().toISOString();
  const runId = `github-publish-${project.id}-${tag}-${timestamp.replace(/[:.]/g, "-")}`;
  const publicationEvidence = {
    schemaVersion: 1,
    runId,
    status: "PASS",
    project: project.id,
    probe: "github-publish",
    startedAt: timestamp,
    finishedAt: new Date().toISOString(),
    sourceCommit: headResult.value,
    artifact: { path: `projects/${project.id}/${validation.artifactRelative}`, sha256: artifactSha256 },
    environment: { provider: "GitHub", repository, tag, releaseUrl: inspected.release.url },
    checks: inspected.checks,
    notes: ["GitHub publication used the exact artifact bound by a passing release-check evidence record.", "No private evidence, browser state, credentials, or device data was published."]
  };
  const privateEvidenceDir = path.resolve(ROOT, "..", "private", "evidence", project.id, "publication");
  await mkdir(privateEvidenceDir, { recursive: true, mode: 0o700 });
  const publicationEvidencePath = path.join(privateEvidenceDir, `${runId}.json`);
  await writeFile(publicationEvidencePath, `${JSON.stringify(publicationEvidence, null, 2)}\n`, { mode: 0o600 });
  const result = { ...publicationEvidence, evidencePath: path.relative(path.resolve(ROOT, ".."), publicationEvidencePath) };
  if (json) console.log(JSON.stringify(result, null, 2)); else console.log(`GitHub publish: PASS\nRelease: ${inspected.release.url}\nEvidence: ${result.evidencePath}`);
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

function parseMobileHandoffOptions(args) {
  if (!args[0] || args[0].startsWith("--")) throw new Error("mobile-handoff requires a project path");
  const options = { project: args[0], candidate: null, port: 8765, target: "emulator", baseUrl: null };
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--candidate") {
      options.candidate = takeOptionValue(args, index, option);
      index += 1;
    } else if (option === "--port") {
      const value = takeOptionValue(args, index, option);
      index += 1;
      if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error("--port must be an integer between 1024 and 65535");
      options.port = Number(value);
    } else if (option === "--target") {
      options.target = takeOptionValue(args, index, option);
      index += 1;
      if (!MOBILE_MANIFEST_PATHS[options.target]) throw new Error("--target must be emulator or oneplus");
    } else if (option === "--base-url") {
      options.baseUrl = takeOptionValue(args, index, option).replace(/\/$/, "");
      index += 1;
    } else {
      throw new Error(`Unknown mobile-handoff option '${option}'`);
    }
  }
  if (!options.candidate) throw new Error("mobile-handoff requires --candidate");
  if (options.target === "oneplus") {
    if (!options.baseUrl) throw new Error("mobile-handoff --target oneplus requires --base-url");
    let parsedBaseUrl;
    try { parsedBaseUrl = new URL(options.baseUrl); } catch { throw new Error("--base-url must be a valid http(s) URL"); }
    if (parsedBaseUrl.protocol !== "http:" || !parsedBaseUrl.hostname || parsedBaseUrl.pathname !== "/" || parsedBaseUrl.search || parsedBaseUrl.hash) throw new Error("--base-url must be an http origin reachable from the phone (for example http://192.168.1.10:8765)");
    if (!parsedBaseUrl.port || Number(parsedBaseUrl.port) !== options.port) throw new Error(`--base-url must include the same port as --port (${options.port})`);
    if (["localhost", "127.0.0.1", "::1", "10.0.2.2"].includes(parsedBaseUrl.hostname)) throw new Error("--base-url for oneplus must be reachable from the phone, not a loopback/emulator mapping");
  } else if (options.baseUrl) {
    throw new Error("--base-url is only valid with --target oneplus");
  }
  return options;
}

async function mobileHandoff(args, json) {
  requireSupportedRuntime("mobile-handoff");
  const options = parseMobileHandoffOptions(args);
  const projectRoot = projectPathFromArg(options.project);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const manifest = await loadMobileManifest(options.target);
  const manifestSchema = await loadJson("schemas/mobile-userscript-probe.schema.json");
  const manifestValidator = new Ajv2020({ allErrors: true, strict: false }).compile(manifestSchema);
  if (!manifestValidator(manifest)) throw new Error(`Mobile userscript probe manifest is invalid: ${JSON.stringify(manifestValidator.errors)}`);
  if (manifest.project !== project.id) throw new Error(`Mobile probe manifest targets '${manifest.project}', not '${project.id}'`);
  const validation = await collectProjectValidation(projectRoot);
  if (!validation.pass) throw new Error("Project validation failed; mobile-handoff stopped");
  const candidatePath = evidencePathFromArg(options.candidate);
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const resultSchema = await loadJson("schemas/result.schema.json");
  const resultValidator = new Ajv2020({ allErrors: true, strict: false }).compile(resultSchema);
  const inspection = inspectEvidence(candidate, resultValidator, candidatePath);
  if (!inspection.pass || candidate.status !== "PASS" || candidate.probe !== "candidate") throw new Error("mobile-handoff requires a valid candidate PASS evidence record");
  const sourceCommit = gitOutput(projectRoot, ["rev-parse", "HEAD"]).value;
  const artifactRelative = validation.artifactRelative;
  const artifactPath = artifactRelative ? path.join(projectRoot, artifactRelative) : null;
  const artifactSha256 = artifactPath ? createHash("sha256").update(await readFile(artifactPath)).digest("hex") : null;
  if (candidate.project !== project.id || candidate.sourceCommit !== sourceCommit || candidate.artifact?.sha256 !== artifactSha256) {
    throw new Error("Candidate evidence does not match the current project commit and artifact SHA-256");
  }
  const manifestArtifactRelative = manifest.artifact.relativePath.replace(`projects/${project.id}/`, "");
  if (artifactRelative !== manifestArtifactRelative) {
    throw new Error(`Mobile probe artifact '${manifest.artifact.relativePath}' does not match project artifact '${artifactRelative}'`);
  }
  const version = releaseVersion(await readFile(artifactPath, "utf8"));
  const base = options.target === "emulator" ? `http://${manifest.target.hostMapping}:${options.port}` : options.baseUrl;
  const result = {
    schemaVersion: 1,
    status: "PASS",
    project: project.id,
    probe: "mobile-handoff",
    sourceCommit,
    artifact: { path: `projects/${project.id}/${artifactRelative}`, sha256: artifactSha256 },
    environment: {
      execution: "external-orchestrator-required",
      target: manifest.target,
      candidateVersion: version,
      candidateEvidence: path.relative(path.resolve(ROOT, ".."), candidatePath),
    },
    handoff: {
      serviceCommand: `python3 probes/mobile/serve.py --directory projects/${project.id} --host 0.0.0.0 --port ${options.port}`,
      installUrl: `${base}${manifest.paths.install}?v=${encodeURIComponent(version)}`,
      smokeUrl: `${base}${manifest.paths.smoke}?v=${encodeURIComponent(version)}`,
      requiredChecks: manifest.requiredChecks,
      evidenceDirectory: manifest.evidence.relativeDirectory,
    },
    checks: [
      { id: "manifest-schema", status: "PASS" },
      { id: "project-validation", status: "PASS" },
      { id: "candidate-source-commit", status: "PASS" },
      { id: "candidate-artifact-sha256", status: "PASS" },
      { id: "external-orchestrator-boundary", status: "PASS", details: { deviceIoPerformed: false } },
    ],
    notes: [
      "This command performs no emulator, ADB, Appium, Firefox, or manager I/O.",
      "The external orchestrator must execute every required check and write a separate result.json bound to this source commit and artifact SHA-256.",
      "Device serials, Firefox profile data, cookies, and session identifiers are forbidden in the resulting public handoff or evidence summary.",
    ],
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Mobile handoff: PASS\nInstall: ${result.handoff.installUrl}\nSmoke: ${result.handoff.smokeUrl}\nEvidence directory: ${result.handoff.evidenceDirectory}`);
}

function parseGreasyForkHandoffOptions(args) {
  if (!args[0] || args[0].startsWith("--")) throw new Error("greasyfork-handoff requires a project path");
  const options = { project: args[0], candidate: null, scriptId: null, baseUrl: "https://greasyfork.org" };
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--candidate") {
      options.candidate = takeOptionValue(args, index, option);
      index += 1;
    } else if (option === "--script-id") {
      options.scriptId = takeOptionValue(args, index, option);
      index += 1;
    } else if (option === "--base-url") {
      options.baseUrl = takeOptionValue(args, index, option).replace(/\/$/, "");
      index += 1;
    } else {
      throw new Error(`Unknown greasyfork-handoff option '${option}'`);
    }
  }
  if (!options.candidate) throw new Error("greasyfork-handoff requires --candidate");
  if (!options.scriptId || !/^\d+$/.test(options.scriptId)) throw new Error("greasyfork-handoff requires a numeric --script-id");
  let parsedBaseUrl;
  try { parsedBaseUrl = new URL(options.baseUrl); } catch { throw new Error("--base-url must be a valid HTTPS Greasy Fork URL"); }
  if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== "greasyfork.org" || (parsedBaseUrl.pathname !== "/" && parsedBaseUrl.pathname !== "")) {
    throw new Error("--base-url must be https://greasyfork.org");
  }
  return options;
}

async function greasyForkHandoff(args, json) {
  requireSupportedRuntime("greasyfork-handoff");
  const options = parseGreasyForkHandoffOptions(args);
  const projectRoot = projectPathFromArg(options.project);
  const project = JSON.parse(await readFile(path.join(projectRoot, "userscript.project.json"), "utf8"));
  const manifest = await loadJson("probes/publication/greasyfork.manifest.json");
  const manifestSchema = await loadJson("schemas/greasyfork-publication-probe.schema.json");
  const manifestValidator = new Ajv2020({ allErrors: true, strict: false }).compile(manifestSchema);
  if (!manifestValidator(manifest)) throw new Error(`Greasy Fork publication manifest is invalid: ${JSON.stringify(manifestValidator.errors)}`);
  const validation = await collectProjectValidation(projectRoot);
  if (!validation.pass) throw new Error("Project validation failed; greasyfork-handoff stopped");
  const candidatePath = evidencePathFromArg(options.candidate);
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const resultSchema = await loadJson("schemas/result.schema.json");
  const resultValidator = new Ajv2020({ allErrors: true, strict: false }).compile(resultSchema);
  const inspection = inspectEvidence(candidate, resultValidator, candidatePath);
  if (!inspection.pass || candidate.status !== "PASS" || candidate.probe !== "candidate") throw new Error("greasyfork-handoff requires a valid candidate PASS evidence record");
  const sourceCommit = gitOutput(projectRoot, ["rev-parse", "HEAD"]).value;
  const artifactRelative = validation.artifactRelative;
  const artifactPath = artifactRelative ? path.join(projectRoot, artifactRelative) : null;
  const artifactSha256 = artifactPath ? createHash("sha256").update(await readFile(artifactPath)).digest("hex") : null;
  if (candidate.project !== project.id || candidate.sourceCommit !== sourceCommit || candidate.artifact?.sha256 !== artifactSha256) {
    throw new Error("Candidate evidence does not match the current project commit and artifact SHA-256");
  }
  const version = releaseVersion(await readFile(artifactPath, "utf8"));
  const fillPath = (template) => template.replaceAll("{scriptId}", options.scriptId);
  const base = options.baseUrl;
  const result = {
    schemaVersion: 1,
    status: "PASS",
    project: project.id,
    probe: "greasyfork-handoff",
    sourceCommit,
    artifact: { path: `projects/${project.id}/${artifactRelative}`, sha256: artifactSha256 },
    environment: {
      execution: "external-browser-orchestrator-required",
      candidateVersion: version,
      candidateEvidence: path.relative(path.resolve(ROOT, ".."), candidatePath),
      scriptId: options.scriptId,
    },
    handoff: {
      createUrl: `${base}${manifest.paths.create}`,
      updateUrl: `${base}${fillPath(manifest.paths.update)}`,
      scriptPageUrl: `${base}${fillPath(manifest.paths.scriptPage)}`,
      codePageUrl: `${base}${fillPath(manifest.paths.codePage)}`,
      requiredChecks: manifest.requiredChecks,
      evidenceDirectory: manifest.evidence.relativeDirectory.replace("<project>", project.id),
    },
    checks: [
      { id: "manifest-schema", status: "PASS" },
      { id: "project-validation", status: "PASS" },
      { id: "candidate-source-commit", status: "PASS" },
      { id: "candidate-artifact-sha256", status: "PASS" },
      { id: "external-browser-orchestrator-boundary", status: "PASS", details: { publicationPerformed: false } },
    ],
    notes: [
      "This command performs no Greasy Fork login, form submission, upload, or external write.",
      "The external browser orchestrator must execute the required checks and write a separate result.json bound to this source commit and artifact SHA-256.",
      "Credentials, cookies, OTP values, passwords, and account-security secrets are forbidden in evidence.",
    ],
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Greasy Fork handoff: PASS\nCreate: ${result.handoff.createUrl}\nUpdate: ${result.handoff.updateUrl}\nPublic code: ${result.handoff.codePageUrl}\nEvidence directory: ${result.handoff.evidenceDirectory}`);
}

async function main() {
  const { command, json, rest } = parseArgs(process.argv.slice(2));
  if (command === "doctor") return doctor(json);
  if (command === "validate") return validate(json);
  if (command === "validate-project") return validateProject(rest, json);
  if (command === "validate-evidence") return validateEvidence(rest, json);
  if (command === "validate-work-order") return validateWorkOrder(rest, json);
  if (command === "record-capability") return recordCapability(rest, json);
  if (command === "release-check") return releaseCheck(rest, json);
  if (command === "publish-github") return publishGithub(rest, json);
  if (command === "build") return buildProject(rest, json);
  if (command === "new") return newProject(rest, json);
  if (command === "candidate") return candidate(rest, json);
  if (command === "mobile-handoff") return mobileHandoff(rest, json);
  if (command === "greasyfork-handoff") return greasyForkHandoff(rest, json);
  if (command === "status") return status(json);
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
