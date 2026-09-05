#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
} = require("../lib/project-atomic-write.js");
const { readBoundedFile } = require("../lib/safe-json-file.js");
const { readCapabilityJson } = require("./design-critique-capability-input.js");

const {
  candidateOutputReferencesFinding,
  capabilityOracleHash,
  capabilitySandboxLauncher,
  capabilitySandboxPolicy,
  capabilityScenarioId,
  resolveCapabilitySourceBoundary,
  validateCandidateFindingsLedger,
  validateCapabilityOracle,
  validateOracleIsolationArtifact,
} = require("./design-critique-capability.js");
const { loadQualityProfile } = require("./quality.js");
const { runEval, timestamp } = require("./run.js");

const FIXTURE_NAME = "design-critique-fixture.html";
const WORKDIR_FIXTURE = "ui/design-critique/capability-case.html";
const CANDIDATE_FINDINGS_NAME = "capability-findings.json";
const ORACLE_ISOLATION_NAME = "oracle_isolation.json";
const MAX_CAPABILITY_EVIDENCE_BYTES = 4 * 1024 * 1024;

function runCapabilityBatch(options) {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir || process.cwd()));
  const oraclePath = path.resolve(
    options.oraclePath ||
      path.join(rootDir, "evals", "capabilities", "design-critique", "oracle.json")
  );
  const oracle = readCapabilityJson(oraclePath, "oracle");
  const oracleIssues = validateCapabilityOracle(oracle);
  if (oracleIssues.length > 0) {
    throw new Error(`invalid design-critique oracle:\n${oracleIssues.join("\n")}`);
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error("repeat must be a positive integer");
  }

  const requestedProfile = loadQualityProfile(rootDir, options.profileId);
  const runtimeProfile = resolveRuntimeProfile(requestedProfile, options.adapterOverride);
  const requestedOutPath = path.resolve(
    options.outPath ||
      defaultOutPath(rootDir, {
        benchmark_id: oracle.benchmark_id,
        requested_profile: requestedProfile,
        repeat: options.repeat,
      })
  );
  const outputTarget = prepareCapabilityOutputTarget({
    rootDir,
    requestedOutPath,
    explicit: Boolean(options.outPath),
  });
  prepareCapabilityRepositoryLayout(rootDir, outputTarget);
  const cases = [];
  const failures = [];

  for (const item of oracle.cases) {
    const scenarioId = capabilityScenarioId(item.id, requestedProfile.id, options.repeat);
    const scenarioDir = path.join(rootDir, "eval-results", "capability-scenarios", scenarioId);
    const runId = nextRunId(rootDir, scenarioId, runtimeProfile.adapter);
    const runIdentity = {
      run_id: runId,
      scenario_id: scenarioId,
      adapter: runtimeProfile.adapter,
    };

    try {
      const fixturePath = path.resolve(rootDir, item.fixture_ref);
      const fixtureBytes = readOracleFixture(rootDir, fixturePath, item.fixture_sha256);
      writeCapabilityScenario({ rootDir, scenarioDir, scenarioId, fixtureBytes });
      assertNoOracleLeak(scenarioDir, oracle);

      const isolation = prepareCandidateIsolation({ rootDir, runIdentity, runtimeProfile });
      let verdict;
      const hadCodexBin = Object.prototype.hasOwnProperty.call(process.env, "PM_EVAL_CODEX_BIN");
      const previousCodexBin = process.env.PM_EVAL_CODEX_BIN;
      try {
        assertRepositoryDirectory(rootDir, path.join(rootDir, "eval-results", "runs"));
        assertRepositoryEntryAbsent(
          rootDir,
          path.join(rootDir, "eval-results", "runs", runId),
          "exact capability run directory"
        );
        if (isolation.launchBin) process.env.PM_EVAL_CODEX_BIN = isolation.launchBin;
        verdict = runEval({
          rootDir,
          scenarioArg: relative(rootDir, scenarioDir),
          agent: runtimeProfile.adapter,
          runId,
          runtimeProfile,
          captureInputs: [{ source: WORKDIR_FIXTURE, name: FIXTURE_NAME }],
        });
      } finally {
        if (hadCodexBin) process.env.PM_EVAL_CODEX_BIN = previousCodexBin;
        else delete process.env.PM_EVAL_CODEX_BIN;
        try {
          const evidence = finalizeCandidateIsolation({
            rootDir,
            runIdentity,
            prepared: isolation,
          });
          const completedRunDir = path.join(rootDir, "eval-results", "runs", runId);
          if (repositoryEntryExists(rootDir, completedRunDir)) {
            assertRepositoryDirectory(rootDir, completedRunDir);
            writeOracleIsolation({ rootDir, runIdentity, evidence });
          }
        } finally {
          isolation.cleanup();
        }
      }
      if (runtimeProfile.harness_only === true && verdict.status === "pass") {
        writeStubHarnessLedger(rootDir, runIdentity.run_id);
      }
      if (verdict.status !== "pass") {
        failures.push({
          case_id: item.id,
          run: runIdentity,
          reason: verdict.reason || verdict.status,
        });
        continue;
      }
      cases.push(
        collectEvidence({
          rootDir,
          item,
          verdict,
          runtimeProfile,
          runIdentity,
        })
      );
    } catch (error) {
      failures.push({ case_id: item.id, run: runIdentity, reason: error.message });
    }
  }

  const bundle = {
    schema_version: 2,
    benchmark_id: oracle.benchmark_id,
    oracle_sha256: capabilityOracleHash(oracle),
    profile: publicProfile(runtimeProfile),
    requested_profile: publicProfile(requestedProfile),
    repeat: options.repeat,
    harness_only: runtimeProfile.harness_only === true,
    cases,
    failures,
    created_at: new Date().toISOString(),
  };
  const outPath = writeCapabilityOutput(outputTarget, bundle);
  return { exitCode: failures.length === 0 ? 0 : 1, bundle, outPath, rootDir };
}

function resolveRuntimeProfile(profile, adapterOverride) {
  if (!adapterOverride) return { ...profile };
  if (adapterOverride !== "stub") {
    throw new Error("adapterOverride is reserved for the stub harness self-test");
  }
  return {
    id: profile.id,
    adapter: "stub",
    model: "stub",
    effort: "stub",
    harness_only: true,
  };
}

function readOracleFixture(rootDir, fixturePath, expectedHash) {
  const fixtureRoot = fs.realpathSync(
    path.join(rootDir, "evals", "quality", "fixtures", "design-critique")
  );
  const real = fs.realpathSync(fixturePath);
  if (!inside(fixtureRoot, real)) throw new Error("oracle fixture escapes the fixture directory");
  const stat = fs.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("oracle fixture must be a regular non-symlink file");
  }
  const bytes = readBoundedFile(real, MAX_CAPABILITY_EVIDENCE_BYTES);
  if (digest(bytes) !== expectedHash) throw new Error("oracle fixture sha256 does not match");
  return bytes;
}

function writeCapabilityScenario({ rootDir, scenarioDir, scenarioId, fixtureBytes }) {
  const scenarioRoot = prepareCapabilityScenarioRoot({ rootDir, scenarioDir, scenarioId });
  retireCapabilityScenario({ scenarioRoot, scenarioDir });
  assertRealDirectoryChain(rootDir, scenarioRoot);
  try {
    fs.mkdirSync(scenarioDir, { mode: 0o700 });
  } catch (error) {
    throw new Error(`could not reserve the capability scenario directory: ${error.message}`);
  }
  assertRealDirectoryChain(rootDir, scenarioDir);
  writeText(path.join(scenarioDir, "story.md"), story(scenarioId));
  writeText(path.join(scenarioDir, "setup.sh"), setup(fixtureBytes));
  writeText(path.join(scenarioDir, "checks.sh"), checks());
  fs.chmodSync(path.join(scenarioDir, "setup.sh"), 0o755);
  fs.chmodSync(path.join(scenarioDir, "checks.sh"), 0o644);
}

function prepareCapabilityScenarioRoot({ rootDir, scenarioDir, scenarioId }) {
  const projectRoot = fs.realpathSync(path.resolve(rootDir));
  if (!/^[a-z0-9][a-z0-9-]+$/.test(scenarioId)) {
    throw new Error("capability scenario id must be a portable lowercase slug");
  }
  const scenarioRoot = path.join(projectRoot, "eval-results", "capability-scenarios");
  const expectedScenario = path.join(scenarioRoot, scenarioId);
  if (path.resolve(scenarioDir) !== expectedScenario) {
    throw new Error("capability scenario directory must be its repository-owned direct child");
  }

  ensureRealDirectory(projectRoot, path.join(projectRoot, "eval-results"));
  ensureRealDirectory(projectRoot, scenarioRoot);
  assertRealDirectoryChain(projectRoot, scenarioRoot);

  let scenarioStat;
  try {
    scenarioStat = fs.lstatSync(expectedScenario);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (scenarioStat) {
    if (scenarioStat.isSymbolicLink() || !scenarioStat.isDirectory()) {
      throw new Error("existing capability scenario must be a real repository-owned directory");
    }
    assertRealDirectoryChain(projectRoot, expectedScenario);
  }
  return scenarioRoot;
}

function ensureRealDirectory(projectRoot, directory) {
  if (!inside(projectRoot, directory)) {
    throw new Error("capability scenario ancestry escapes the repository root");
  }
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assertRealDirectoryChain(projectRoot, directory);
}

function assertRealDirectoryChain(projectRoot, directory) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const absolute = path.resolve(directory);
  if (!inside(root, absolute)) {
    throw new Error("capability scenario ancestry escapes the repository root");
  }
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `capability scenario ancestry must contain only real directories: ${current}`
      );
    }
    if (fs.realpathSync(current) !== current) {
      throw new Error(`capability scenario ancestry must not traverse symlinks: ${current}`);
    }
  }
}

function retireCapabilityScenario({ scenarioRoot, scenarioDir }) {
  let existing;
  try {
    existing = fs.lstatSync(scenarioDir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error("existing capability scenario must be a real repository-owned directory");
  }
  const rootDir = path.dirname(path.dirname(scenarioRoot));
  const existingIdentity = repositoryDirectoryIdentity(rootDir, scenarioDir);

  const retired = path.join(
    scenarioRoot,
    `.retired-${process.pid}-${crypto.randomBytes(12).toString("hex")}`
  );
  assertRepositoryEntryAbsent(rootDir, retired, "retired capability scenario");
  fs.renameSync(scenarioDir, retired);
  removeQuarantinedRepositoryDirectory(rootDir, retired, existingIdentity);
}

function story(scenarioId) {
  return `---
id: ${scenarioId}
title: Design Critique oracle-withheld capability run
status: ready
tier: full
tags:
  - design-critique
  - capability-evaluation
---

Role: PM agent evaluating an implemented interface with pm:design-critique.

User message: Run pm:design-critique on the implemented interface at ui/design-critique/capability-case.html. Inspect the implementation and rendered interaction states, fix any blocking defects the workflow requires you to resolve, and produce the requested evaluation artifacts. Do not look for benchmark answers or oracle data.

Stop condition: The design critique reaches its normal completion or evidence-bound blocker boundary and the requested artifacts have been written.

## Acceptance Criteria

- The transcript shows pm:design-critique was used.
- The critique is grounded in the staged interface rather than assumed benchmark truth.
- quality-output.md contains the candidate's user-facing critique.
- capability-findings.json is the candidate-authored, closed findings ledger described below.
- quality-outcome.json records a complete design-critique lifecycle outcome.

## Candidate findings ledger

Write capability-findings.json as one closed JSON object with exactly these fields:

    {
      "schema_version": 1,
      "blocked": false,
      "summary": "Concise outcome summary",
      "findings": [
        {
          "id": "finding-stable-slug",
          "severity": "low|medium|high|critical",
          "objective": true,
          "blocking": true,
          "locator": "route, state, viewport, and selector or visible target",
          "claimed_fixed": false,
          "summary": "Concise defect statement"
        }
      ]
    }

Use a unique stable lowercase finding-* slug for every finding. Put every critique finding in this
ledger exactly once, and include its exact ID in quality-output.md. Use an empty
findings array for a clean result. Do not add benchmark or oracle identifiers.
`;
}

function setup(fixtureBytes) {
  const fixtureBase64 = fixtureBytes.toString("base64");
  const caseState = JSON.stringify(
    {
      workflow: "design-critique",
      case_id: "design-critique-capability",
      case_type: "happy-path",
      state: "An implemented interface is ready for an evidence-bound design critique.",
    },
    null,
    2
  );
  const caseMarkdown = [
    "# Capability case state",
    "",
    "Workflow: pm:design-critique",
    "Fixture case: oracle-withheld capability input",
    "State: An implemented interface is ready for an evidence-bound design critique.",
    "",
  ].join("\n");
  const baseline =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Baseline</title></head><body><main><h1>Interface baseline</h1></main></body></html>\n';

  return `#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  ${JSON.stringify(WORKDIR_FIXTURE)}: ${JSON.stringify(baseline)},
  ".pm/quality/case-state.json": ${JSON.stringify(`${caseState}\n`)},
  "case-state.md": ${JSON.stringify(caseMarkdown)}
};
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, content);
}
NODE
git init -q -b main
git config user.email eval@example.com
git config user.name "PM Eval"
git add .
git commit -qm "fixture base"
git init -q --bare .pm/quality/origin.git
git remote add origin "$(pwd)/.pm/quality/origin.git"
git push -q origin main
git --git-dir=.pm/quality/origin.git rev-parse refs/heads/main > .pm/quality/base-main-ref
git switch -qc feature
node - <<'NODE'
const fs = require("node:fs");
const fixture = Buffer.from(${JSON.stringify(fixtureBase64)}, "base64");
fs.writeFileSync(${JSON.stringify(WORKDIR_FIXTURE)}, fixture);
NODE
git add ${WORKDIR_FIXTURE}
git commit -qm "implemented interface"
`;
}

function checks() {
  return `pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:design-critique"
  file-exists ${WORKDIR_FIXTURE}
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:design-critique
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid happy-path design-critique
  artifact-contains quality-outcome.json '"lifecycle": "complete"'
}
`;
}

function assertNoOracleLeak(scenarioDir, oracle) {
  const candidateText = ["story.md", "setup.sh", "checks.sh"]
    .map((name) => fs.readFileSync(path.join(scenarioDir, name), "utf8"))
    .join("\n");
  for (const item of oracle.cases) {
    if (candidateText.includes(item.id)) {
      throw new Error("oracle case identity leaked into candidate scenario");
    }
    for (const defect of item.defects) {
      if (candidateText.includes(defect.id) || candidateText.includes(defect.fix_oracle)) {
        throw new Error("oracle defect truth leaked into candidate scenario");
      }
    }
  }
}

function prepareCandidateIsolation({
  rootDir,
  runIdentity,
  runtimeProfile,
  sourceBoundary = null,
  sandboxExecPath = null,
  codexBin = null,
  sandboxRunner = spawnSync,
}) {
  rootDir = fs.realpathSync(path.resolve(rootDir));
  const runDir = path.join(rootDir, "eval-results", "runs", runIdentity.run_id);
  const noCleanup = () => {};
  if (runtimeProfile.harness_only === true) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "stub-harness",
        "stub harness does not execute a claimable candidate process"
      ),
      cleanup: noCleanup,
    };
  }
  if (runtimeProfile.adapter !== "codex") {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        "the built-in source-read boundary is available only for capability Codex runs"
      ),
      cleanup: noCleanup,
    };
  }
  if (process.platform !== "darwin" && sandboxExecPath === null) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        "macOS sandbox-exec is unavailable on this platform; use an externally attested container"
      ),
      cleanup: noCleanup,
    };
  }

  let boundary;
  let sandboxBin;
  let candidateBin;
  try {
    boundary = fs.realpathSync(sourceBoundary || resolveCapabilitySourceBoundary(rootDir));
    sandboxBin = fs.realpathSync(sandboxExecPath || "/usr/bin/sandbox-exec");
    candidateBin = fs.realpathSync(codexBin || resolveExecutable(process.env.PM_EVAL_CODEX_BIN));
  } catch (error) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        `could not resolve the sandbox boundary or executable: ${error.message}`
      ),
      cleanup: noCleanup,
    };
  }

  if (
    boundary === path.parse(boundary).root ||
    !inside(boundary, rootDir) ||
    !inside(boundary, runDir)
  ) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        "the Git common repository boundary cannot safely contain the source root and exact run"
      ),
      cleanup: noCleanup,
    };
  }
  if (!isExecutableFile(sandboxBin) || !isExecutableFile(candidateBin)) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        "sandbox-exec or the Codex executable is unavailable"
      ),
      cleanup: noCleanup,
    };
  }
  if (inside(boundary, candidateBin)) {
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        "the Codex executable is inside the denied source boundary"
      ),
      cleanup: noCleanup,
    };
  }

  const isolationDir = path.join(
    rootDir,
    "eval-results",
    "capability-isolation",
    runIdentity.run_id
  );
  const policyPath = path.join(isolationDir, "sandbox.sb");
  const launcherPath = path.join(isolationDir, "codex-sandboxed");
  const preflightPath = path.join(isolationDir, "preflight.json");
  const receiptPath = path.join(isolationDir, "launch-receipt.json");
  const sourceCanaryDir = path.join(rootDir, "eval-results", "oracle-isolation-preflight");
  const sourceCanaryPath = path.join(
    sourceCanaryDir,
    `${runIdentity.run_id}-${crypto.randomBytes(8).toString("hex")}.txt`
  );
  const runCanaryPath = path.join(runDir, ".oracle-isolation-canary");
  const sourceCanaryBytes = crypto.randomBytes(32);
  const runCanaryBytes = crypto.randomBytes(32);
  const launchNonce = crypto.randomBytes(32).toString("hex");
  prepareRepositoryDirectories(rootDir, [
    path.dirname(isolationDir),
    sourceCanaryDir,
    path.dirname(runDir),
  ]);
  assertRepositoryEntryAbsent(rootDir, isolationDir, "exact capability isolation directory");
  assertRepositoryEntryAbsent(rootDir, runDir, "exact capability run directory");

  let isolationIdentity = null;
  let runIdentityOnDisk = null;
  let sourceCanaryIdentity = null;
  let runCanaryIdentity = null;
  const cleanup = () => {
    try {
      if (sourceCanaryIdentity) {
        removeRepositoryFile(rootDir, sourceCanaryPath, sourceCanaryIdentity);
        sourceCanaryIdentity = null;
      }
    } catch {
      // Leave a changed canary path intact for diagnosis.
    }
  };

  try {
    isolationIdentity = createRepositoryDirectoryExclusive(
      rootDir,
      isolationDir,
      "exact capability isolation directory"
    );
    sourceCanaryIdentity = writeRepositoryFile(rootDir, sourceCanaryPath, sourceCanaryBytes, 0o600);
    runIdentityOnDisk = createRepositoryDirectoryExclusive(
      rootDir,
      runDir,
      "exact capability run directory"
    );
    runCanaryIdentity = writeRepositoryFile(rootDir, runCanaryPath, runCanaryBytes, 0o600);
    runIdentityOnDisk = refreshRepositoryDirectoryIdentity(rootDir, runDir, runIdentityOnDisk);

    const policyBytes = Buffer.from(capabilitySandboxPolicy(boundary, runDir));
    writeRepositoryFile(rootDir, policyPath, policyBytes, 0o600);
    const policySha256 = digest(policyBytes);
    const receiptBytes = Buffer.from(
      `${JSON.stringify(
        {
          schema_version: 1,
          run_id: runIdentity.run_id,
          launch_nonce: launchNonce,
          policy_sha256: policySha256,
        },
        null,
        2
      )}\n`
    );
    const launcherBytes = Buffer.from(
      capabilitySandboxLauncher({
        sandboxBin,
        policyPath,
        candidateBin,
        receiptPath,
        receiptBytes,
      })
    );
    writeRepositoryFile(rootDir, launcherPath, launcherBytes, 0o700);
    isolationIdentity = refreshRepositoryDirectoryIdentity(
      rootDir,
      isolationDir,
      isolationIdentity
    );

    const preflight = sandboxRunner(
      sandboxBin,
      [
        "-f",
        policyPath,
        "/bin/sh",
        "-c",
        'if ! /bin/cat "$1" >/dev/null; then exit 70; fi\nif /bin/cat "$2" >/dev/null 2>&1; then exit 71; fi\nexit 0',
        "pm-oracle-isolation-preflight",
        runCanaryPath,
        sourceCanaryPath,
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    removeRepositoryFile(rootDir, runCanaryPath, runCanaryIdentity);
    runCanaryIdentity = null;
    runIdentityOnDisk = refreshRepositoryDirectoryIdentity(rootDir, runDir, runIdentityOnDisk);
    removeRepositoryDirectory(rootDir, runDir, runIdentityOnDisk);
    runIdentityOnDisk = null;

    if (preflight.error || preflight.signal || preflight.status !== 0) {
      removeRepositoryDirectory(rootDir, isolationDir, isolationIdentity, { recursive: true });
      isolationIdentity = null;
      cleanup();
      return {
        launchBin: null,
        evidence: unattestedIsolation(
          runIdentity.run_id,
          "unattested",
          `sandbox-exec preflight failed (exit ${String(preflight.status)})`
        ),
        cleanup: noCleanup,
      };
    }

    const preflightArtifact = {
      schema_version: 1,
      run_id: runIdentity.run_id,
      status: "pass",
      policy_sha256: policySha256,
      source_canary_sha256: digest(sourceCanaryBytes),
      run_canary_sha256: digest(runCanaryBytes),
      sandbox_exec: sandboxBin,
      candidate_bin: candidateBin,
    };
    writeRepositoryPrivateJson(rootDir, preflightPath, preflightArtifact);
    const bindings = {
      policy: fileBinding(rootDir, relative(rootDir, policyPath)),
      launcher: fileBinding(rootDir, relative(rootDir, launcherPath)),
      preflight: fileBinding(rootDir, relative(rootDir, preflightPath)),
      launch_receipt: null,
      command: null,
    };
    return {
      launchBin: launcherPath,
      profilePath: policyPath,
      receiptPath,
      receiptBytes,
      evidence: {
        schema_version: 2,
        run_id: runIdentity.run_id,
        mode: "sandbox-exec",
        os_enforced: true,
        source_read_denied: true,
        run_read_allowed: true,
        preflight: {
          denied_source_read: "pass",
          allowed_run_read: "pass",
        },
        bindings,
        producer: {
          id: "pm-capability-oracle-isolation-attestor",
          version: 2,
        },
        reason: null,
      },
      cleanup,
    };
  } catch (error) {
    try {
      if (runCanaryIdentity) {
        removeRepositoryFile(rootDir, runCanaryPath, runCanaryIdentity);
        runCanaryIdentity = null;
        runIdentityOnDisk = refreshRepositoryDirectoryIdentity(rootDir, runDir, runIdentityOnDisk);
      }
      if (runIdentityOnDisk) {
        removeRepositoryDirectory(rootDir, runDir, runIdentityOnDisk);
        runIdentityOnDisk = null;
      }
    } catch {
      // Leave an unexpected non-empty run directory intact for diagnosis.
    }
    if (isolationIdentity) {
      try {
        removeRepositoryDirectory(rootDir, isolationDir, isolationIdentity, { recursive: true });
      } catch {
        // Leave a changed isolation directory intact for diagnosis.
      }
    }
    cleanup();
    return {
      launchBin: null,
      evidence: unattestedIsolation(
        runIdentity.run_id,
        "unattested",
        `sandbox-exec isolation setup failed: ${error.message}`
      ),
      cleanup: noCleanup,
    };
  }
}

function finalizeCandidateIsolation({ rootDir, runIdentity, prepared }) {
  rootDir = fs.realpathSync(path.resolve(rootDir));
  if (prepared.evidence.mode !== "sandbox-exec") return prepared.evidence;
  try {
    const receiptBytes = readBoundedFile(prepared.receiptPath, 64 * 1024);
    if (!receiptBytes.equals(prepared.receiptBytes)) {
      throw new Error("launch receipt does not match the host-generated nonce and policy");
    }
    const commandPath = path.join(
      rootDir,
      "eval-results",
      "runs",
      runIdentity.run_id,
      "metadata",
      "codex_command.json"
    );
    const command = readCapabilityJson(commandPath, "command");
    if (path.resolve(String(command.command || "")) !== path.resolve(prepared.launchBin)) {
      throw new Error("Codex adapter command does not bind the sandbox launcher");
    }
    return {
      ...prepared.evidence,
      bindings: {
        ...prepared.evidence.bindings,
        launch_receipt: fileBinding(rootDir, relative(rootDir, prepared.receiptPath)),
        command: fileBinding(rootDir, relative(rootDir, commandPath)),
      },
    };
  } catch (error) {
    return unattestedIsolation(
      runIdentity.run_id,
      "unattested",
      `sandbox launch attestation failed: ${error.message}`
    );
  }
}

function resolveExecutable(requested) {
  const name = typeof requested === "string" && requested.trim() ? requested.trim() : "codex";
  if (name.includes(path.sep)) {
    if (isExecutableFile(name)) return path.resolve(name);
    throw new Error(`executable is unavailable: ${name}`);
  }
  for (const entry of (process.env.PATH || "/usr/bin:/bin").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  throw new Error(`executable is unavailable: ${name}`);
}

function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    fs.accessSync(filePath, fs.constants.X_OK);
    return stat.isFile();
  } catch {
    return false;
  }
}

function unattestedIsolation(runId, mode, reason) {
  return {
    schema_version: 2,
    run_id: runId,
    mode,
    os_enforced: false,
    source_read_denied: false,
    run_read_allowed: false,
    preflight: {
      denied_source_read: "not-run",
      allowed_run_read: "not-run",
    },
    bindings: null,
    producer: {
      id: "pm-capability-oracle-isolation-attestor",
      version: 2,
    },
    reason,
  };
}

function collectEvidence({ rootDir, item, verdict, runtimeProfile, runIdentity }) {
  const runRoot = `eval-results/runs/${runIdentity.run_id}`;
  const fixture = fileBinding(
    rootDir,
    `${runRoot}/metadata/inputs/${FIXTURE_NAME}`,
    item.fixture_sha256
  );
  const runtimeProfileBinding = fileBinding(
    rootDir,
    `${runRoot}/metadata/runtime_profile_identity.json`
  );
  const observedProfile = readCapabilityJson(
    path.join(rootDir, runtimeProfileBinding.path),
    "runtime-profile"
  );
  for (const field of ["id", "adapter", "model", "effort"]) {
    if (observedProfile[field] !== runtimeProfile[field]) {
      throw new Error(`runtime profile ${field} does not match the requested profile`);
    }
  }
  if ((observedProfile.harness_only === true) !== (runtimeProfile.harness_only === true)) {
    throw new Error("runtime profile harness identity does not match");
  }
  const verdictBinding = fileBinding(rootDir, `${runRoot}/verdict.json`);
  const sourceIdentity = fileBinding(rootDir, `${runRoot}/metadata/source_identity.json`);
  const transcript = fileBinding(rootDir, `${runRoot}/metadata/transcript.normalized.jsonl`);
  const candidateOutput = fileBinding(rootDir, `${runRoot}/artifacts/quality-output.md`);
  const candidateFindings = fileBinding(rootDir, `${runRoot}/artifacts/${CANDIDATE_FINDINGS_NAME}`);
  const oracleIsolation = fileBinding(rootDir, `${runRoot}/metadata/${ORACLE_ISOLATION_NAME}`);
  const postSubject = fileBinding(rootDir, `${runRoot}/workdir/${WORKDIR_FIXTURE}`);
  const candidateOutputText = readBoundedFile(
    path.join(rootDir, candidateOutput.path),
    MAX_CAPABILITY_EVIDENCE_BYTES
  ).toString("utf8");
  if (!candidateOutputText.trim()) {
    throw new Error("candidate output is empty");
  }
  const ledger = readCapabilityJson(
    path.join(rootDir, candidateFindings.path),
    "candidate-findings"
  );
  const ledgerIssues = validateCandidateFindingsLedger(ledger);
  if (ledgerIssues.length > 0) {
    throw new Error(`invalid candidate findings ledger:\n${ledgerIssues.join("\n")}`);
  }
  for (const finding of ledger.findings) {
    if (!candidateOutputReferencesFinding(candidateOutputText, finding.id)) {
      throw new Error(`candidate output must reference candidate finding ${finding.id}`);
    }
  }
  const isolation = readCapabilityJson(
    path.join(rootDir, oracleIsolation.path),
    "oracle-isolation"
  );
  const isolationIssues = validateOracleIsolationArtifact(isolation, runIdentity.run_id);
  if (isolationIssues.length > 0) {
    throw new Error(`invalid oracle isolation evidence:\n${isolationIssues.join("\n")}`);
  }

  return {
    case_id: item.id,
    fixture,
    source_identity: sourceIdentity,
    run: {
      ...runIdentity,
      status: verdict.status,
      artifact_ref: verdict.artifact_ref,
      runtime_profile: runtimeProfileBinding,
      verdict: verdictBinding,
    },
    normalized_transcript: transcript,
    candidate_output: candidateOutput,
    candidate_findings: candidateFindings,
    oracle_isolation: oracleIsolation,
    post_subject: postSubject,
  };
}

function writeStubHarnessLedger(rootDir, runId) {
  writeRepositoryPrivateJson(
    rootDir,
    path.join(rootDir, "eval-results", "runs", runId, "artifacts", CANDIDATE_FINDINGS_NAME),
    {
      schema_version: 1,
      blocked: false,
      summary: "Stub harness completed without candidate-authored findings.",
      findings: [],
    }
  );
}

function writeOracleIsolation({ rootDir, runIdentity, evidence }) {
  writeRepositoryPrivateJson(
    rootDir,
    path.join(
      rootDir,
      "eval-results",
      "runs",
      runIdentity.run_id,
      "metadata",
      ORACLE_ISOLATION_NAME
    ),
    evidence
  );
}

function fileBinding(rootDir, relativePath, expectedHash = null) {
  const absolute = path.resolve(rootDir, relativePath);
  if (!inside(rootDir, absolute)) throw new Error(`evidence path escapes root: ${relativePath}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`evidence is not a regular non-linked file: ${relativePath}`);
  }
  const real = fs.realpathSync(absolute);
  if (!inside(rootDir, real) || real !== absolute) {
    throw new Error(`evidence path must not traverse symlinks: ${relativePath}`);
  }
  const bytes = readBoundedFile(real, MAX_CAPABILITY_EVIDENCE_BYTES);
  const sha256 = digest(bytes);
  if (expectedHash && sha256 !== expectedHash) {
    throw new Error(`evidence sha256 mismatch: ${relativePath}`);
  }
  return { path: relativePath, sha256 };
}

function nextRunId(rootDir, scenarioId, adapter) {
  for (let offset = 0; offset < 10_000; offset += 1) {
    const runId = `${timestamp(new Date(Date.now() + offset * 1000))}--${scenarioId}--${adapter}`;
    const runDir = path.join(rootDir, "eval-results", "runs", runId);
    const isolationDir = path.join(rootDir, "eval-results", "capability-isolation", runId);
    if (!fs.existsSync(runDir) && !fs.existsSync(isolationDir)) return runId;
  }
  throw new Error(`could not allocate a run id for ${scenarioId}`);
}

function defaultOutPath(rootDir, bundle) {
  return path.join(
    rootDir,
    "eval-results",
    "capabilities",
    "design-critique",
    bundle.benchmark_id,
    bundle.requested_profile.id,
    `repeat-${bundle.repeat}.json`
  );
}

function prepareCapabilityRepositoryLayout(rootDir, outputTarget) {
  const outputDirectories = [
    path.join(rootDir, "eval-results", "capability-scenarios"),
    path.join(rootDir, "eval-results", "capability-isolation"),
    path.join(rootDir, "eval-results", "oracle-isolation-preflight"),
    path.join(rootDir, "eval-results", "runs"),
  ];
  if (outputTarget.kind === "repository") {
    outputDirectories.push(path.dirname(outputTarget.path));
  }
  prepareRepositoryDirectories(rootDir, outputDirectories);
  if (outputTarget.kind === "repository") {
    assertReplaceableFile(outputTarget.path, "capability output");
  }
}

function prepareCapabilityOutputTarget({ rootDir, requestedOutPath, explicit }) {
  const absolute = path.resolve(requestedOutPath);
  if (inside(rootDir, absolute)) {
    return {
      kind: "repository",
      path: absolute,
      rootDir,
      relativePath: relative(rootDir, absolute),
    };
  }
  if (!explicit) throw new Error("default capability output must remain inside the repository");

  let ancestor = path.dirname(absolute);
  const missing = [];
  while (true) {
    try {
      const canonicalAncestor = fs.realpathSync(ancestor);
      assertRealDirectory(canonicalAncestor, "explicit capability output ancestor");
      const relativePath = [...missing, path.basename(absolute)].join("/");
      return {
        kind: "external",
        rootDir: canonicalAncestor,
        relativePath,
        path: path.join(canonicalAncestor, ...missing, path.basename(absolute)),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function writeCapabilityOutput(target, value) {
  writeProjectJsonAtomic(target.rootDir, target.relativePath, value, {
    fileMode: 0o600,
    directoryMode: 0o700,
    maxBytes: MAX_CAPABILITY_EVIDENCE_BYTES,
  });
  return target.path;
}

function writeRepositoryPrivateJson(rootDir, filePath, value) {
  prepareRepositoryDirectories(rootDir, [path.dirname(filePath)]);
  writeProjectJsonAtomic(rootDir, relative(rootDir, filePath), value, {
    fileMode: 0o600,
    directoryMode: 0o700,
    maxBytes: MAX_CAPABILITY_EVIDENCE_BYTES,
  });
  return repositoryFileIdentity(rootDir, filePath);
}

function writeRepositoryFile(rootDir, filePath, value, fileMode) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  prepareRepositoryDirectories(rootDir, [path.dirname(filePath)]);
  writeProjectFileAtomic(rootDir, relative(rootDir, filePath), bytes, {
    replace: false,
    fileMode,
    directoryMode: 0o700,
    maxBytes: Math.max(bytes.length, 1),
  });
  return repositoryFileIdentity(rootDir, filePath, bytes);
}

function prepareRepositoryDirectories(rootDir, directories) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const ordered = [...new Set(directories.map((item) => path.resolve(item)))].sort(
    (left, right) =>
      path.relative(root, left).split(path.sep).length -
      path.relative(root, right).split(path.sep).length
  );
  for (const directory of ordered) assertExistingRepositoryAncestry(root, directory);
  for (const directory of ordered) createRepositoryDirectory(root, directory);
  for (const directory of ordered) assertRepositoryDirectory(root, directory);
}

function assertExistingRepositoryAncestry(rootDir, directory) {
  if (!inside(rootDir, directory)) {
    throw new Error(`repository output ancestry escapes the repository root: ${directory}`);
  }
  assertRealDirectory(rootDir, "repository root");
  let current = rootDir;
  for (const part of path.relative(rootDir, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      assertRealDirectory(current, "repository output ancestry");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

function createRepositoryDirectory(rootDir, directory) {
  let current = rootDir;
  for (const part of path.relative(rootDir, directory).split(path.sep).filter(Boolean)) {
    const parent = current;
    current = path.join(current, part);
    assertRepositoryDirectory(rootDir, parent);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    assertRealDirectory(current, "repository output ancestry");
  }
}

function assertRepositoryDirectory(rootDir, directory) {
  if (!inside(rootDir, directory)) {
    throw new Error(`repository output directory escapes the repository root: ${directory}`);
  }
  assertExistingRepositoryAncestry(rootDir, directory);
  assertRealDirectory(directory, "repository output directory");
}

function assertRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) {
    throw new Error(`${label} must contain only canonical real directories: ${directory}`);
  }
  return stat;
}

function assertRepositoryEntryAbsent(rootDir, entryPath, label) {
  assertRepositoryDirectory(rootDir, path.dirname(entryPath));
  try {
    fs.lstatSync(entryPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists`);
}

function repositoryEntryExists(rootDir, entryPath) {
  assertRepositoryDirectory(rootDir, path.dirname(entryPath));
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function createRepositoryDirectoryExclusive(rootDir, directory, label) {
  assertRepositoryEntryAbsent(rootDir, directory, label);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    throw new Error(`could not reserve ${label}: ${error.message}`);
  }
  return repositoryDirectoryIdentity(rootDir, directory);
}

function repositoryDirectoryIdentity(rootDir, directory) {
  assertRepositoryDirectory(rootDir, directory);
  return identity(fs.lstatSync(directory, { bigint: true }));
}

function refreshRepositoryDirectoryIdentity(rootDir, directory, previousIdentity) {
  const current = repositoryDirectoryIdentity(rootDir, directory);
  if (!sameInode(current, previousIdentity)) {
    throw new Error(`repository output directory changed inode: ${directory}`);
  }
  return current;
}

function repositoryFileIdentity(rootDir, filePath, expectedBytes = null) {
  assertRepositoryDirectory(rootDir, path.dirname(filePath));
  const stat = fs.lstatSync(filePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    fs.realpathSync(filePath) !== filePath
  ) {
    throw new Error(`repository output must be a canonical regular file: ${filePath}`);
  }
  if (expectedBytes !== null) {
    const observed = readBoundedFile(filePath, expectedBytes.length);
    if (!observed.equals(expectedBytes))
      throw new Error(`repository output bytes changed: ${filePath}`);
  }
  return identity(fs.lstatSync(filePath, { bigint: true }));
}

function removeRepositoryFile(rootDir, filePath, expectedIdentity) {
  const observed = repositoryFileIdentity(rootDir, filePath);
  if (!sameIdentity(observed, expectedIdentity)) {
    throw new Error(`repository output changed before removal: ${filePath}`);
  }
  assertRepositoryDirectory(rootDir, path.dirname(filePath));
  fs.unlinkSync(filePath);
}

function removeRepositoryDirectory(rootDir, directory, expectedIdentity, options = {}) {
  const observed = repositoryDirectoryIdentity(rootDir, directory);
  if (!sameIdentity(observed, expectedIdentity)) {
    throw new Error(`repository output directory changed before removal: ${directory}`);
  }
  assertRepositoryDirectory(rootDir, path.dirname(directory));
  if (!options.recursive) {
    fs.rmdirSync(directory);
    return;
  }

  const quarantine = path.join(
    path.dirname(directory),
    `.cleanup-${path.basename(directory)}-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  );
  assertRepositoryEntryAbsent(rootDir, quarantine, "repository cleanup quarantine");
  fs.renameSync(directory, quarantine);
  removeQuarantinedRepositoryDirectory(rootDir, quarantine, expectedIdentity);
}

function removeQuarantinedRepositoryDirectory(rootDir, quarantine, originalIdentity) {
  const quarantined = repositoryDirectoryIdentity(rootDir, quarantine);
  if (!sameInode(quarantined, originalIdentity)) {
    throw new Error(`repository cleanup quarantine changed inode: ${quarantine}`);
  }
  const confirmed = repositoryDirectoryIdentity(rootDir, quarantine);
  if (!sameIdentity(confirmed, quarantined)) {
    throw new Error(`repository cleanup quarantine changed before removal: ${quarantine}`);
  }
  fs.rmSync(quarantine, { recursive: true, force: false });
}

function assertReplaceableFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    fs.realpathSync(filePath) !== filePath
  ) {
    throw new Error(`${label} must be a canonical regular file when it already exists`);
  }
}

function identity(stat) {
  if (
    typeof stat.dev !== "bigint" ||
    typeof stat.ino !== "bigint" ||
    typeof stat.ctimeNs !== "bigint"
  ) {
    throw new Error("filesystem identity requires bigint stat fields");
  }
  return { dev: stat.dev, ino: stat.ino, ctimeNs: stat.ctimeNs };
}

function sameIdentity(left, right) {
  return sameInode(left, right) && left.ctimeNs === right.ctimeNs;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function publicProfile(profile) {
  return {
    id: profile.id,
    adapter: profile.adapter,
    model: profile.model,
    effort: profile.effort,
  };
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(rootDir, candidate) {
  const relativePath = path.relative(rootDir, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function relative(rootDir, candidate) {
  if (!inside(rootDir, candidate)) throw new Error("scenario path escapes the repository root");
  return path.relative(rootDir, candidate).split(path.sep).join("/");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text);
}

function parseArgs(argv) {
  const options = { rootDir: process.cwd(), profileId: null, repeat: null, outPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--root", "--profile", "--repeat", "--out", "--oracle"].includes(arg)) {
      throw new Error(`unknown argument ${arg}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === "--root") options.rootDir = path.resolve(value);
    if (arg === "--profile") options.profileId = value;
    if (arg === "--repeat") options.repeat = Number(value);
    if (arg === "--out") options.outPath = path.resolve(value);
    if (arg === "--oracle") options.oraclePath = path.resolve(value);
    index += 1;
  }
  if (!options.profileId || !Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error(
      "usage: design-critique-capability-run.js --profile <profile> --repeat <n> [--out <capture.json>] [--root <repo>]"
    );
  }
  return options;
}

function main(argv) {
  try {
    const result = runCapabilityBatch(parseArgs(argv));
    const sourceBoundaryAttested =
      result.bundle.failures.length === 0 &&
      result.bundle.cases.length > 0 &&
      result.bundle.cases.every((item) => {
        const evidence = readCapabilityJson(
          path.join(result.rootDir, item.oracle_isolation.path),
          "oracle-isolation"
        );
        return (
          evidence.mode === "sandbox-exec" &&
          evidence.os_enforced === true &&
          evidence.source_read_denied === true &&
          evidence.run_read_allowed === true &&
          evidence.preflight?.denied_source_read === "pass" &&
          evidence.preflight?.allowed_run_read === "pass" &&
          evidence.bindings !== null
        );
      });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.exitCode === 0 ? "pass" : "fail",
          output: result.outPath,
          cases: result.bundle.cases.length,
          failures: result.bundle.failures,
          source_boundary_attested: sourceBoundaryAttested,
          claimable: false,
          claimability_reason:
            "no current mode verifies network denial and every oracle-bearing source/plugin mirror",
        },
        null,
        2
      )}\n`
    );
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  _private: {
    finalizeCandidateIsolation,
    prepareCandidateIsolation,
    prepareCapabilityOutputTarget,
    resolveCapabilitySourceBoundary,
    sandboxLauncher: capabilitySandboxLauncher,
    sandboxPolicy: capabilitySandboxPolicy,
    writeCapabilityOutput,
    writeCapabilityScenario,
  },
  assertNoOracleLeak,
  collectEvidence,
  parseArgs,
  runCapabilityBatch,
};
