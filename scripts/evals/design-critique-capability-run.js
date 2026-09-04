#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  capabilityOracleHash,
  capabilityScenarioId,
  validateCapabilityOracle,
} = require("./design-critique-capability.js");
const { loadQualityProfile } = require("./quality.js");
const { runEval, timestamp } = require("./run.js");

const FIXTURE_NAME = "design-critique-fixture.html";
const WORKDIR_FIXTURE = "ui/design-critique/capability-case.html";

function runCapabilityBatch(options) {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir || process.cwd()));
  const oraclePath = path.resolve(
    options.oraclePath ||
      path.join(rootDir, "evals", "capabilities", "design-critique", "oracle.json")
  );
  const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
  const oracleIssues = validateCapabilityOracle(oracle);
  if (oracleIssues.length > 0) {
    throw new Error(`invalid design-critique oracle:\n${oracleIssues.join("\n")}`);
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error("repeat must be a positive integer");
  }

  const requestedProfile = loadQualityProfile(rootDir, options.profileId);
  const runtimeProfile = resolveRuntimeProfile(requestedProfile, options.adapterOverride);
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
      writeCapabilityScenario({ scenarioDir, scenarioId, fixtureBytes });
      assertNoOracleLeak(scenarioDir, oracle);

      const verdict = runEval({
        rootDir,
        scenarioArg: relative(rootDir, scenarioDir),
        agent: runtimeProfile.adapter,
        runId,
        runtimeProfile,
        captureInputs: [{ source: WORKDIR_FIXTURE, name: FIXTURE_NAME }],
      });
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
    schema_version: 1,
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
  const outPath = path.resolve(options.outPath || defaultOutPath(rootDir, bundle));
  writePrivateJson(outPath, bundle);
  return { exitCode: failures.length === 0 ? 0 : 1, bundle, outPath };
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
  const bytes = fs.readFileSync(real);
  if (digest(bytes) !== expectedHash) throw new Error("oracle fixture sha256 does not match");
  return bytes;
}

function writeCapabilityScenario({ scenarioDir, scenarioId, fixtureBytes }) {
  fs.rmSync(scenarioDir, { recursive: true, force: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  writeText(path.join(scenarioDir, "story.md"), story(scenarioId));
  writeText(path.join(scenarioDir, "setup.sh"), setup(fixtureBytes));
  writeText(path.join(scenarioDir, "checks.sh"), checks());
  fs.chmodSync(path.join(scenarioDir, "setup.sh"), 0o755);
  fs.chmodSync(path.join(scenarioDir, "checks.sh"), 0o644);
}

function story(scenarioId) {
  return `---
id: ${scenarioId}
title: Design Critique hidden-fixture capability run
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
- quality-outcome.json records a complete design-critique lifecycle outcome.
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
    "Fixture case: hidden capability input",
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
  const observedProfile = JSON.parse(
    fs.readFileSync(path.join(rootDir, runtimeProfileBinding.path), "utf8")
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
  const transcript = fileBinding(rootDir, `${runRoot}/metadata/transcript.normalized.jsonl`);
  const candidateOutput = fileBinding(rootDir, `${runRoot}/artifacts/quality-output.md`);
  const postSubject = fileBinding(rootDir, `${runRoot}/workdir/${WORKDIR_FIXTURE}`);
  if (!fs.readFileSync(path.join(rootDir, candidateOutput.path), "utf8").trim()) {
    throw new Error("candidate output is empty");
  }

  return {
    case_id: item.id,
    fixture,
    run: {
      ...runIdentity,
      status: verdict.status,
      artifact_ref: verdict.artifact_ref,
      runtime_profile: runtimeProfileBinding,
      verdict: verdictBinding,
    },
    normalized_transcript: transcript,
    candidate_output: candidateOutput,
    post_subject: postSubject,
  };
}

function fileBinding(rootDir, relativePath, expectedHash = null) {
  const absolute = path.resolve(rootDir, relativePath);
  if (!inside(rootDir, absolute)) throw new Error(`evidence path escapes root: ${relativePath}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`evidence is not a regular non-linked file: ${relativePath}`);
  }
  const bytes = fs.readFileSync(absolute);
  const sha256 = digest(bytes);
  if (expectedHash && sha256 !== expectedHash) {
    throw new Error(`evidence sha256 mismatch: ${relativePath}`);
  }
  return { path: relativePath, sha256 };
}

function nextRunId(rootDir, scenarioId, adapter) {
  for (let offset = 0; offset < 10_000; offset += 1) {
    const runId = `${timestamp(new Date(Date.now() + offset * 1000))}--${scenarioId}--${adapter}`;
    if (!fs.existsSync(path.join(rootDir, "eval-results", "runs", runId))) return runId;
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

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
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
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.exitCode === 0 ? "pass" : "fail",
          output: result.outPath,
          cases: result.bundle.cases.length,
          failures: result.bundle.failures,
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
  assertNoOracleLeak,
  collectEvidence,
  parseArgs,
  runCapabilityBatch,
};
