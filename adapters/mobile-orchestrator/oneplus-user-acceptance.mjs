const REQUIRED_OBSERVATION_CHECKS = [
  "firefox-launched",
  "manager-install-surface",
  "script-installed",
];

function checksById(evidence) {
  return new Map((Array.isArray(evidence?.checks) ? evidence.checks : []).map((check) => [check.id, check]));
}

function sameCandidate(evidence, candidate) {
  return evidence?.project === candidate?.project
    && evidence?.sourceCommit === candidate?.sourceCommit
    && evidence?.artifact?.sha256 === candidate?.artifact?.sha256;
}

export function inspectOnePlusAcceptanceInputs({ project, candidate, emulator, deviceObservation }) {
  const failures = [];
  const observationChecks = checksById(deviceObservation);
  const acceptanceChecks = project?.targets?.mobileVerification?.acceptanceChecks;

  if (candidate?.status !== "PASS" || candidate?.probe !== "candidate") failures.push("candidate must be a candidate PASS");
  if (emulator?.status !== "PASS" || emulator?.probe !== "android-emulator-manager") failures.push("emulator evidence must be an android-emulator-manager PASS");
  if (emulator?.environment?.target !== "android-emulator-firefox-manager") failures.push("emulator target is not the Android emulator manager");
  if (deviceObservation?.probe !== "oneplus-15-firefox-manager") failures.push("device observation must use the oneplus-15-firefox-manager probe");
  if (deviceObservation?.status !== "BLOCKED") failures.push("device observation must remain BLOCKED until explicit user acceptance");
  if (deviceObservation?.environment?.target !== "oneplus-15-firefox-manager") failures.push("device observation target is not OnePlus 15 Firefox");
  if (!sameCandidate(emulator, candidate)) failures.push("emulator evidence is not bound to the candidate");
  if (!sameCandidate(deviceObservation, candidate)) failures.push("device observation is not bound to the candidate");
  for (const id of REQUIRED_OBSERVATION_CHECKS) {
    if (observationChecks.get(id)?.status !== "PASS") failures.push(`device observation check '${id}' must be PASS`);
  }
  if (observationChecks.get("manager-injection")?.status !== "BLOCKED") failures.push("device observation check 'manager-injection' must remain BLOCKED until explicit user acceptance");
  if (!Array.isArray(acceptanceChecks) || acceptanceChecks.length === 0) failures.push("project must declare mobileVerification.acceptanceChecks");

  return {
    pass: failures.length === 0,
    failures,
    acceptanceChecks: Array.isArray(acceptanceChecks) ? [...acceptanceChecks] : [],
    observationChecks,
  };
}

export function buildOnePlusAcceptanceEvidence({ project, candidate, emulator, deviceObservation, confirmedAt, runId }) {
  const inspection = inspectOnePlusAcceptanceInputs({ project, candidate, emulator, deviceObservation });
  if (!inspection.pass) throw new Error(`OnePlus acceptance preconditions failed: ${inspection.failures.join("; ")}`);
  if (typeof confirmedAt !== "string" || Number.isNaN(Date.parse(confirmedAt))) throw new Error("confirmedAt must be an ISO timestamp");
  if (typeof runId !== "string" || runId.length === 0) throw new Error("runId is required");

  const inheritedChecks = REQUIRED_OBSERVATION_CHECKS.map((id) => {
    const check = inspection.observationChecks.get(id);
    return { ...check, details: { ...(check.details || {}), evidenceSource: "external-device-observation" } };
  });
  const userChecks = inspection.acceptanceChecks.map((id) => ({
    id,
    status: "PASS",
    details: { evidenceSource: "user-final-acceptance" },
  }));
  const startedAt = confirmedAt;
  const finishedAt = new Date().toISOString();

  return {
    schemaVersion: 1,
    runId,
    status: "PASS",
    project: candidate.project,
    probe: "oneplus-15-firefox-manager",
    sourceCommit: candidate.sourceCommit,
    artifact: { ...candidate.artifact },
    environment: {
      target: "oneplus-15-firefox-manager",
      browserPackage: "org.mozilla.firefox",
      deviceModel: "PLK110",
      verificationMode: "instrumented-emulator-plus-stock-device-user-acceptance",
      emulatorEvidenceRunId: emulator.runId,
      deviceObservationRunId: deviceObservation.runId,
      acceptance: {
        mode: "user-final-acceptance",
        confirmed: true,
        confirmedAt,
      },
    },
    checks: [
      ...inheritedChecks,
      {
        id: "manager-injection",
        status: "PASS",
        details: { evidenceSource: "user-final-acceptance", productionBrowser: "stock-firefox" },
      },
      ...userChecks,
      {
        id: "user-final-acceptance",
        status: "PASS",
        details: { evidenceSource: "explicit-user-confirmation", confirmedAt },
      },
    ],
    notes: [
      "The instrumented emulator evidence proves the technical Tampermonkey/DOM gate; it does not replace this stock-device acceptance.",
      "The user performed the final visible behavior acceptance on stock Firefox. No account credentials or device serial are recorded.",
    ],
    startedAt,
    finishedAt,
  };
}
