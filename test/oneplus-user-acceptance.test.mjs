import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOnePlusAcceptanceEvidence,
  inspectOnePlusAcceptanceInputs,
} from "../adapters/mobile-orchestrator/oneplus-user-acceptance.mjs";

const candidate = {
  status: "PASS",
  probe: "candidate",
  project: "fixture",
  sourceCommit: "abcdef1",
  artifact: { path: "projects/fixture/dist/fixture.user.js", sha256: "1".repeat(64) },
};
const project = {
  targets: { mobileVerification: { acceptanceChecks: ["layout-visible", "rollback-toggle"] } },
};
const emulator = {
  status: "PASS",
  probe: "android-emulator-manager",
  runId: "emulator-run",
  project: candidate.project,
  sourceCommit: candidate.sourceCommit,
  artifact: candidate.artifact,
  environment: { target: "android-emulator-firefox-manager" },
};
const deviceObservation = {
  status: "BLOCKED",
  probe: "oneplus-15-firefox-manager",
  runId: "device-run",
  project: candidate.project,
  sourceCommit: candidate.sourceCommit,
  artifact: candidate.artifact,
  environment: { target: "oneplus-15-firefox-manager" },
  checks: [
    { id: "firefox-launched", status: "PASS" },
    { id: "manager-install-surface", status: "PASS" },
    { id: "script-installed", status: "PASS" },
    { id: "manager-injection", status: "BLOCKED" },
  ],
};

function objectKeys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...objectKeys(nested)]);
}

test("OnePlus finalization requires matching emulator and device observations", () => {
  assert.equal(inspectOnePlusAcceptanceInputs({ project, candidate, emulator, deviceObservation }).pass, true);
  const mismatched = { ...emulator, artifact: { ...emulator.artifact, sha256: "2".repeat(64) } };
  const result = inspectOnePlusAcceptanceInputs({ project, candidate, emulator: mismatched, deviceObservation });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("\n"), /emulator evidence is not bound/);
});

test("OnePlus finalization produces explicit user-acceptance evidence without a serial", () => {
  const evidence = buildOnePlusAcceptanceEvidence({
    project,
    candidate,
    emulator,
    deviceObservation,
    confirmedAt: "2026-08-04T12:00:00.000Z",
    runId: "oneplus-user-acceptance-fixture",
  });
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.environment.browserPackage, "org.mozilla.firefox");
  assert.equal(evidence.environment.acceptance.confirmed, true);
  assert.equal(evidence.checks.find((check) => check.id === "manager-injection")?.status, "PASS");
  assert.equal(evidence.checks.find((check) => check.id === "user-final-acceptance")?.status, "PASS");
  assert.equal(objectKeys(evidence).includes("serial"), false);
});

test("OnePlus finalization fails closed without project acceptance checks", () => {
  assert.throws(() => buildOnePlusAcceptanceEvidence({
    project: { targets: { mobileVerification: {} } },
    candidate,
    emulator,
    deviceObservation,
    confirmedAt: "2026-08-04T12:00:00.000Z",
    runId: "missing-acceptance-checks",
  }), /acceptanceChecks/);
});

test("OnePlus device observation cannot pre-claim manager injection or final PASS", () => {
  const preclaimed = {
    ...deviceObservation,
    status: "PASS",
    checks: deviceObservation.checks.map((check) => check.id === "manager-injection" ? { ...check, status: "PASS" } : check),
  };
  const result = inspectOnePlusAcceptanceInputs({ project, candidate, emulator, deviceObservation: preclaimed });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("\n"), /remain BLOCKED/);
});
