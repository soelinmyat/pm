"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { _private, runCapabilityBatch } = require("../scripts/evals/design-critique-capability-run");
const { runEval } = require("../scripts/evals/run");
const {
  capabilityScenarioId,
  validateOracleIsolationEvidence,
} = require("../scripts/evals/design-critique-capability");
const {
  CHECKS,
  assertSafePostSubject,
  validateVerifierCoverage,
  verifyPostSubject,
} = require("../evals/capabilities/design-critique/verify");

const ROOT = path.resolve(__dirname, "..");

function childResult(child) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function childReady(child) {
  return new Promise((resolve, reject) => {
    const onExit = (status) => reject(new Error(`child exited before ready with status ${status}`));
    child.once("exit", onExit);
    child.once("error", reject);
    child.once("message", (message) => {
      child.off("exit", onExit);
      if (message !== "ready") reject(new Error(`unexpected child message: ${message}`));
      else resolve();
    });
  });
}

function scenarioDescriptor(rootDir, oracleCase, profileId, repeat) {
  const scenarioId = capabilityScenarioId(oracleCase.id, profileId, repeat);
  const fixtureBytes = fs.readFileSync(path.join(rootDir, oracleCase.fixture_ref));
  return _private.capabilityScenarioDescriptor(rootDir, scenarioId, fixtureBytes);
}

function removeScenarioPublication(descriptor) {
  let published = null;
  try {
    published = _private.readPublishedCapabilityScenario(descriptor, { allowMissing: true });
  } catch {
    // Tests remove only publications they created; malformed remnants stay visible for diagnosis.
  }
  fs.rmSync(descriptor.pointerPath, { force: true });
  if (published) fs.rmSync(published.bundleDir, { recursive: true, force: true });
}

function removeRunDirectory(rootDir, runId) {
  const runDir = path.join(rootDir, "eval-results", "runs", runId);
  const scenarioDir = path.join(runDir, "scenario");
  if (fs.existsSync(scenarioDir)) fs.chmodSync(scenarioDir, 0o755);
  fs.rmSync(runDir, { recursive: true, force: true });
}

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
  assert.deepEqual(JSON.parse(fs.readFileSync(result.outPath, "utf8")), result.bundle);
  assert.equal(fs.statSync(result.outPath).mode & 0o777, 0o600);
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

    const descriptor = scenarioDescriptor(ROOT, expected, "sol-high", 1);
    const candidateScenario = descriptor.files
      .map((file) => file.bytes.toString("utf8"))
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
      removeRunDirectory(ROOT, item.run.run_id);
      fs.rmSync(_private.capabilityRunReservationPath(ROOT, item.run.run_id), { force: true });
    }
    if (item.run?.scenario_id) {
      const expected = oracle.cases.find((candidate) => candidate.id === item.case_id);
      removeScenarioPublication(scenarioDescriptor(ROOT, expected, "sol-high", 1));
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("explicit external output safely creates missing canonical parents", () => {
  const externalRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-external-output-"))
  );
  const requestedOutPath = path.join(externalRoot, "missing", "nested", "repeat-1.json");
  const bundle = { schema_version: 2, result: "bounded" };
  try {
    const target = _private.prepareCapabilityOutputTarget({
      rootDir: ROOT,
      requestedOutPath,
      explicit: true,
    });
    const published = _private.writeCapabilityOutput(target, bundle);
    assert.equal(published, requestedOutPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(published, "utf8")), bundle);
    assert.equal(fs.statSync(published).mode & 0o777, 0o600);
    assert.equal(fs.lstatSync(path.dirname(published)).isSymbolicLink(), false);
  } finally {
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("external output stays bound to its prepared root identity", (t) => {
  const parent = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-external-root-swap-"))
  );
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const externalRoot = path.join(parent, "external");
  const parkedRoot = path.join(parent, "external-parked");
  const protectedRoot = path.join(parent, "protected");
  fs.mkdirSync(externalRoot);
  fs.mkdirSync(protectedRoot);
  const protectedPath = path.join(protectedRoot, "oracle.json");
  const protectedBytes = Buffer.from("protected oracle bytes\n");
  fs.writeFileSync(protectedPath, protectedBytes);
  const target = _private.prepareCapabilityOutputTarget({
    rootDir: ROOT,
    requestedOutPath: path.join(externalRoot, "oracle.json"),
    explicit: true,
  });

  fs.renameSync(externalRoot, parkedRoot);
  fs.symlinkSync(protectedRoot, externalRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => _private.writeCapabilityOutput(target, { schema_version: 2, result: "unsafe" }),
    /project root identity changed before atomic write/
  );
  assert.deepEqual(fs.readFileSync(protectedPath), protectedBytes);
  assert.equal(fs.existsSync(path.join(parkedRoot, "oracle.json")), false);
});

test("capability output cannot replace oracle, suite, fixture, or repository source inputs", () => {
  const oraclePath = path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json");
  const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
  const aliasRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-input-alias-")));
  const oracleAlias = path.join(aliasRoot, "oracle-alias.json");
  const repositoryAlias = path.join(aliasRoot, "repository-alias");
  fs.symlinkSync(oraclePath, oracleAlias);
  fs.symlinkSync(ROOT, repositoryAlias, process.platform === "win32" ? "junction" : "dir");
  const protectedPaths = [
    oraclePath,
    path.join(ROOT, "evals", "quality", "suite.json"),
    path.join(ROOT, oracle.cases[0].fixture_ref),
  ];
  const before = new Map(protectedPaths.map((filePath) => [filePath, fs.readFileSync(filePath)]));
  const readmePath = path.join(ROOT, "README.md");
  const readmeBefore = fs.readFileSync(readmePath);
  const missingSourcePath = path.join(
    ROOT,
    `capability-output-must-not-appear-${process.pid}-${crypto.randomBytes(6).toString("hex")}.json`
  );

  try {
    for (const outPath of [...protectedPaths, oracleAlias]) {
      assert.throws(
        () =>
          runCapabilityBatch({
            rootDir: ROOT,
            profileId: "sol-high",
            repeat: 1,
            outPath,
            adapterOverride: "stub",
          }),
        /must not replace an oracle, suite, or fixture input/
      );
    }
    assert.throws(
      () =>
        runCapabilityBatch({
          rootDir: ROOT,
          profileId: "sol-high",
          repeat: 1,
          outPath: path.join(ROOT, "README.md"),
          adapterOverride: "stub",
        }),
      /must stay below eval-results\/capabilities\/design-critique/
    );
    assert.throws(
      () =>
        runCapabilityBatch({
          rootDir: ROOT,
          profileId: "sol-high",
          repeat: 1,
          outPath: path.join(repositoryAlias, "README.md"),
          adapterOverride: "stub",
        }),
      /must stay below eval-results\/capabilities\/design-critique/
    );
    assert.throws(
      () =>
        runCapabilityBatch({
          rootDir: ROOT,
          profileId: "sol-high",
          repeat: 1,
          outPath: path.join(repositoryAlias, path.basename(missingSourcePath)),
          adapterOverride: "stub",
        }),
      /must stay below eval-results\/capabilities\/design-critique/
    );
    const allowedAliasTarget = _private.prepareCapabilityOutputTarget({
      rootDir: ROOT,
      requestedOutPath: path.join(
        repositoryAlias,
        "eval-results",
        "capabilities",
        "design-critique",
        "alias-safe.json"
      ),
      explicit: true,
    });
    assert.equal(allowedAliasTarget.kind, "repository");
    assert.equal(
      allowedAliasTarget.path,
      path.join(ROOT, "eval-results", "capabilities", "design-critique", "alias-safe.json")
    );

    for (const [filePath, bytes] of before) {
      assert.deepEqual(fs.readFileSync(filePath), bytes);
    }
    assert.deepEqual(fs.readFileSync(readmePath), readmeBefore);
    assert.equal(fs.existsSync(missingSourcePath), false);
  } finally {
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test("run ID reservations are persistent and atomic across concurrent allocators", async () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-reserve-")));
  const runner = path.join(ROOT, "scripts", "evals", "design-critique-capability-run.js");
  const scenarioId = "dc-cap-concurrent-sol-high-r1";
  const baseTimeMs = Date.parse("2026-09-05T09:00:00Z");
  for (const name of ["runs", "capability-isolation", "capability-run-reservations"]) {
    fs.mkdirSync(path.join(rootDir, "eval-results", name), { recursive: true });
  }
  const script = `
    const [runner, root, scenario, base] = process.argv.slice(1);
    const api = require(runner)._private;
    process.stdout.write(api.reserveNextRunId(root, scenario, "stub", Number(base)));
  `;

  try {
    const children = [0, 1].map(() =>
      spawn(process.execPath, ["-e", script, runner, rootDir, scenarioId, String(baseTimeMs)], {
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    const results = await Promise.all(children.map(childResult));
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const runIds = results.map((result) => result.stdout.trim());
    assert.equal(new Set(runIds).size, 2);
    for (const runId of runIds) {
      assert.match(runId, /^[0-9]{8}T[0-9]{6}Z--dc-cap-concurrent-sol-high-r1--stub$/);
      const reservation = JSON.parse(
        fs.readFileSync(_private.capabilityRunReservationPath(rootDir, runId), "utf8")
      );
      assert.equal(reservation.run_id, runId);
      assert.equal(reservation.scenario_id, scenarioId);
      assert.equal(reservation.adapter, "stub");
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("concurrent full capability batches keep distinct complete runs and reuse scenarios", async () => {
  const runner = path.join(ROOT, "scripts", "evals", "design-critique-capability-run.js");
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );
  const profileId = "sol-high";
  const repeat = 100_000 + crypto.randomInt(900_000);
  const baseTimeMs = Date.parse("2042-09-05T09:00:00Z");
  const scenarioDescriptors = new Map();
  const runIds = new Set();
  const outputPaths = new Set();
  const childScript = `
    const [runner, root, profile, repeat, base] = process.argv.slice(1);
    Date.now = () => Number(base);
    const { runCapabilityBatch } = require(runner);
    process.send("ready");
    process.once("message", (message) => {
      if (message !== "go") throw new Error("unexpected synchronization message");
      try {
        const result = runCapabilityBatch({
          rootDir: root,
          profileId: profile,
          repeat: Number(repeat),
          adapterOverride: "stub"
        });
        process.stdout.write(JSON.stringify(result));
        process.exitCode = result.exitCode;
      } catch (error) {
        process.stderr.write(error.stack || error.message);
        process.exitCode = 1;
      } finally {
        process.disconnect();
      }
    });
  `;

  try {
    for (const item of oracle.cases) {
      const descriptor = scenarioDescriptor(ROOT, item, profileId, repeat);
      removeScenarioPublication(descriptor);
      scenarioDescriptors.set(descriptor.scenarioId, descriptor);
      assert.equal(fs.existsSync(descriptor.pointerPath), false);
    }

    const children = [0, 1].map(() =>
      spawn(
        process.execPath,
        ["-e", childScript, runner, ROOT, profileId, String(repeat), String(baseTimeMs)],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] }
      )
    );
    const results = children.map(childResult);
    await Promise.all(children.map(childReady));
    for (const child of children) child.send("go");
    const completed = await Promise.all(results);
    for (const result of completed) assert.equal(result.status, 0, result.stderr);
    const batches = completed.map((result) => JSON.parse(result.stdout));
    assert.notEqual(batches[0].outPath, batches[1].outPath);

    for (const batch of batches) {
      assert.equal(batch.exitCode, 0);
      assert.equal(batch.bundle.failures.length, 0);
      assert.equal(batch.bundle.cases.length, oracle.cases.length);
      assert.equal(
        batch.outPath.startsWith(
          path.join(ROOT, "eval-results", "capabilities", "design-critique") + path.sep
        ),
        true
      );
      outputPaths.add(batch.outPath);
      assert.deepEqual(JSON.parse(fs.readFileSync(batch.outPath, "utf8")), batch.bundle);
      for (const item of batch.bundle.cases) {
        runIds.add(item.run.run_id);
        assert.equal(item.run.status, "pass");
        const runDir = path.join(ROOT, "eval-results", "runs", item.run.run_id);
        assert.equal(fs.lstatSync(runDir).isDirectory(), true);
        for (const binding of [
          item.fixture,
          item.source_identity,
          item.scenario_identity,
          item.run.runtime_profile,
          item.run.verdict,
          item.normalized_transcript,
          item.candidate_output,
          item.candidate_findings,
          item.oracle_isolation,
          item.post_subject,
        ]) {
          const bytes = fs.readFileSync(path.join(ROOT, binding.path));
          assert.equal(
            crypto.createHash("sha256").update(bytes).digest("hex"),
            binding.sha256.replace(/^sha256:/, "")
          );
        }
        assert.equal(
          fs.lstatSync(_private.capabilityRunReservationPath(ROOT, item.run.run_id)).isFile(),
          true
        );
      }
    }

    for (const oracleCase of oracle.cases) {
      const first = batches[0].bundle.cases.find((item) => item.case_id === oracleCase.id);
      const second = batches[1].bundle.cases.find((item) => item.case_id === oracleCase.id);
      assert.notEqual(first.run.run_id, second.run.run_id);
      const descriptor = scenarioDescriptors.get(first.run.scenario_id);
      const published = _private.readPublishedCapabilityScenario(descriptor);
      const before = fs.lstatSync(published.scenarioDir, { bigint: true });
      const reused = _private.readPublishedCapabilityScenario(descriptor);
      const after = fs.lstatSync(reused.scenarioDir, { bigint: true });
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      assert.equal(after.ctimeNs, before.ctimeNs);
      const bundlePrefix = `.capability-scenario-${descriptor.contentSha256.replace(/^sha256:/, "")}-`;
      assert.equal(
        fs.readdirSync(descriptor.scenarioRoot).filter((entry) => entry.startsWith(bundlePrefix))
          .length,
        1
      );
      assert.equal(
        fs.existsSync(_private.capabilityScenarioLockPath(ROOT, published.contentId)),
        false
      );
    }
    assert.equal(runIds.size, oracle.cases.length * 2);
  } finally {
    for (const runId of runIds) {
      removeRunDirectory(ROOT, runId);
      fs.rmSync(_private.capabilityRunReservationPath(ROOT, runId), { force: true });
    }
    for (const outputPath of outputPaths) fs.rmSync(outputPath, { force: true });
    for (const descriptor of scenarioDescriptors.values()) removeScenarioPublication(descriptor);
  }
});

test("content-addressed scenario ownership is short-lived and never mutates published bytes", () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-owner-")));
  const scenarioId = "dc-cap-owned-sol-high-r1";
  const runner = path.join(ROOT, "scripts", "evals", "design-critique-capability-run.js");
  const firstFixture = Buffer.from("first fixture");
  const first = _private.prepareImmutableCapabilityScenario({
    rootDir,
    scenarioId,
    fixtureBytes: firstFixture,
  });
  const initial = fs.lstatSync(first.scenarioDir, { bigint: true });
  assert.equal(fs.existsSync(_private.capabilityScenarioLockPath(rootDir, first.contentId)), false);
  const release = _private.acquireCapabilityScenarioLock(rootDir, first.contentId);

  try {
    const reusedPublication = _private.writeCapabilityScenario({
      rootDir,
      scenarioId,
      fixtureBytes: firstFixture,
    });
    const reused = fs.lstatSync(reusedPublication.scenarioDir, { bigint: true });
    assert.equal(reused.dev, initial.dev);
    assert.equal(reused.ino, initial.ino);
    assert.equal(reused.ctimeNs, initial.ctimeNs);

    const contender = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const [runner, root, scenario, content] = process.argv.slice(1);
          const api = require(runner)._private;
          const release = api.acquireCapabilityScenarioLock(root, content, { attempts: 2, waitMs: 10 });
          try {
            api.writeCapabilityScenario({
              rootDir: root,
              scenarioId: scenario,
              fixtureBytes: Buffer.from("first fixture")
            });
          } finally {
            release();
          }
        `,
        runner,
        rootDir,
        scenarioId,
        first.contentId,
      ],
      { encoding: "utf8" }
    );
    assert.equal(contender.status, 1);
    assert.match(contender.stderr, /timed out waiting for capability scenario ownership/);
    const afterContender = fs.lstatSync(first.scenarioDir, { bigint: true });
    assert.equal(afterContender.dev, initial.dev);
    assert.equal(afterContender.ino, initial.ino);
    assert.equal(afterContender.ctimeNs, initial.ctimeNs);
    assert.match(
      fs.readFileSync(path.join(first.scenarioDir, "setup.sh"), "utf8"),
      /Zmlyc3QgZml4dHVyZQ==/
    );
  } finally {
    release();
  }

  const exactReader = _private.prepareImmutableCapabilityScenario({
    rootDir,
    scenarioId,
    fixtureBytes: firstFixture,
  });
  const second = _private.prepareImmutableCapabilityScenario({
    rootDir,
    scenarioId,
    fixtureBytes: Buffer.from("second fixture"),
  });
  assert.equal(exactReader.scenarioDir, first.scenarioDir);
  assert.notEqual(second.scenarioDir, first.scenarioDir);
  const afterSecond = fs.lstatSync(first.scenarioDir, { bigint: true });
  assert.equal(afterSecond.dev, initial.dev);
  assert.equal(afterSecond.ino, initial.ino);
  assert.equal(afterSecond.ctimeNs, initial.ctimeNs);
  assert.match(
    fs.readFileSync(path.join(first.scenarioDir, "setup.sh"), "utf8"),
    /Zmlyc3QgZml4dHVyZQ==/
  );
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test("scenario pointer publication waits for bottom-up directory durability", (t) => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-durable-")));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const scenarioId = "dc-cap-durable-sol-high-r1";
  const fixtureBytes = Buffer.from("durable fixture");
  const descriptor = _private.capabilityScenarioDescriptor(rootDir, scenarioId, fixtureBytes);
  const originalFsync = fs.fsyncSync;
  let rejectFirstDirectorySync = true;
  let directorySyncs = 0;
  fs.fsyncSync = function injectDirectoryBarrier(descriptorFd) {
    if (fs.fstatSync(descriptorFd).isDirectory()) {
      directorySyncs += 1;
      if (rejectFirstDirectorySync) {
        rejectFirstDirectorySync = false;
        const error = new Error("injected directory sync failure");
        error.code = "EIO";
        throw error;
      }
    }
    return Reflect.apply(originalFsync, fs, [descriptorFd]);
  };
  try {
    assert.throws(
      () =>
        _private.prepareImmutableCapabilityScenario({
          rootDir,
          scenarioId,
          fixtureBytes,
        }),
      /directory durability failed.*injected directory sync failure/
    );
    assert.equal(fs.existsSync(descriptor.pointerPath), false);

    const published = _private.prepareImmutableCapabilityScenario({
      rootDir,
      scenarioId,
      fixtureBytes,
    });
    assert.equal(fs.lstatSync(descriptor.pointerPath).isFile(), true);
    assert.equal(fs.lstatSync(published.scenarioDir).isDirectory(), true);
    assert.equal(directorySyncs, 4, "one rejected barrier plus three successful barriers");
  } finally {
    fs.fsyncSync = originalFsync;
  }
});

test("capability run rejects scenario bytes changed while the staged snapshot is copied", (t) => {
  const scenarioId = "dc-cap-stage-mutation-sol-high-r1";
  const fixtureBytes = Buffer.from("staging mutation fixture");
  const published = _private.prepareImmutableCapabilityScenario({
    rootDir: ROOT,
    scenarioId,
    fixtureBytes,
  });
  const runId = `20260905T120000Z--${scenarioId}--stub`;
  const originalCopy = fs.copyFileSync;
  t.after(() => {
    fs.copyFileSync = originalCopy;
    removeRunDirectory(ROOT, runId);
    removeScenarioPublication(published);
  });

  fs.copyFileSync = function mutateStagedScenario(source, destination, ...args) {
    const result = Reflect.apply(originalCopy, fs, [source, destination, ...args]);
    if (path.resolve(source) === path.join(published.scenarioDir, "checks.sh")) {
      fs.appendFileSync(destination, "\n# concurrent mutation\n");
    }
    return result;
  };

  assert.throws(
    () =>
      runEval({
        rootDir: ROOT,
        scenarioArg: path.relative(ROOT, published.scenarioDir),
        agent: "stub",
        runId,
        expectedScenarioHash: published.stagedScenarioSha256,
      }),
    /staged scenario identity does not match expected scenario bytes/
  );
});

test("capability run rejects staged scenario mutation by the candidate adapter", (t) => {
  const scenarioId = "dc-cap-adapter-mutation-sol-high-r1";
  const fixtureBytes = Buffer.from("adapter mutation fixture");
  const published = _private.prepareImmutableCapabilityScenario({
    rootDir: ROOT,
    scenarioId,
    fixtureBytes,
  });
  const runId = `20260905T120001Z--${scenarioId}--stub`;
  const stubAdapter = require("../scripts/evals/adapters/stub");
  const originalRun = stubAdapter.run;
  t.after(() => {
    stubAdapter.run = originalRun;
    removeRunDirectory(ROOT, runId);
    removeScenarioPublication(published);
  });
  stubAdapter.run = (context) => {
    const checksPath = path.join(context.paths.scenarioStageDir, "checks.sh");
    fs.chmodSync(checksPath, 0o644);
    fs.appendFileSync(checksPath, "\n# candidate mutation\n");
    return { status: "pass", events: 0 };
  };

  assert.throws(
    () =>
      runEval({
        rootDir: ROOT,
        scenarioArg: path.relative(ROOT, published.scenarioDir),
        scenarioFiles: published.files,
        agent: "stub",
        runId,
        expectedScenarioHash: published.stagedScenarioSha256,
      }),
    /staged scenario changed during execution/
  );
});

test(
  "sealed capability scenario prevents the candidate adapter from replacing check files",
  { skip: process.platform === "win32" },
  (t) => {
    const scenarioId = "dc-cap-adapter-replace-sol-high-r1";
    const fixtureBytes = Buffer.from("adapter replacement fixture");
    const published = _private.prepareImmutableCapabilityScenario({
      rootDir: ROOT,
      scenarioId,
      fixtureBytes,
    });
    const runId = `20260905T120002Z--${scenarioId}--stub`;
    const stubAdapter = require("../scripts/evals/adapters/stub");
    const originalRun = stubAdapter.run;
    const denied = [];
    t.after(() => {
      stubAdapter.run = originalRun;
      removeRunDirectory(ROOT, runId);
      removeScenarioPublication(published);
    });
    stubAdapter.run = (context) => {
      const checksPath = path.join(context.paths.scenarioStageDir, "checks.sh");
      for (const mutate of [
        () => fs.unlinkSync(checksPath),
        () => fs.writeFileSync(path.join(context.paths.scenarioStageDir, "replacement.sh"), "x"),
      ]) {
        try {
          mutate();
          denied.push(null);
        } catch (error) {
          denied.push(error.code);
        }
      }
      return originalRun(context);
    };

    const verdict = runEval({
      rootDir: ROOT,
      scenarioArg: path.relative(ROOT, published.scenarioDir),
      scenarioFiles: published.files,
      agent: "stub",
      runId,
      expectedScenarioHash: published.stagedScenarioSha256,
    });
    assert.equal(verdict.status, "pass");
    assert.equal(denied.length, 2);
    assert.equal(
      denied.every((code) => code === "EACCES" || code === "EPERM"),
      true
    );
  }
);

test("scenario coordination rejects symlinked lock and reservation roots", () => {
  for (const outputRoot of ["capability-scenario-locks", "capability-run-reservations"]) {
    const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-root-")));
    const externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-outside-")));
    const evalResults = path.join(rootDir, "eval-results");
    const redirected = path.join(evalResults, outputRoot);
    const sentinel = path.join(externalDir, "sentinel.txt");
    fs.mkdirSync(path.join(evalResults, "runs"), { recursive: true });
    fs.mkdirSync(path.join(evalResults, "capability-isolation"), { recursive: true });
    fs.writeFileSync(sentinel, "must survive\n");
    fs.symlinkSync(externalDir, redirected, process.platform === "win32" ? "junction" : "dir");

    try {
      if (outputRoot === "capability-scenario-locks") {
        assert.throws(
          () => _private.acquireCapabilityScenarioLock(rootDir, "dc-cap-symlink-sol-high-r1"),
          /canonical real directories|must contain only real directories/
        );
      } else {
        assert.throws(
          () =>
            _private.reserveNextRunId(
              rootDir,
              "dc-cap-symlink-sol-high-r1",
              "stub",
              Date.parse("2026-09-05T09:00:00Z")
            ),
          /canonical real directories|must contain only real directories/
        );
      }
      assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
      assert.deepEqual(fs.readdirSync(externalDir).sort(), ["sentinel.txt"]);
    } finally {
      fs.unlinkSync(redirected);
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  }
});

test("explicit external output rejects a destination substituted during publication", () => {
  const externalRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-output-swap-"))
  );
  const preload = path.join(externalRoot, "swap-preload.cjs");
  const requestedOutPath = path.join(externalRoot, "repeat-1.json");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalRename = fs.renameSync;
      let swapped = false;
      fs.renameSync = function(source, destination, ...args) {
        const result = originalRename.call(fs, source, destination, ...args);
        if (!swapped && process.argv.includes("--child") && destination === "repeat-1.json") {
          swapped = true;
          originalRename.call(fs, destination, "intended-output.json");
          fs.writeFileSync(destination, "foreign-substitution\\n", { mode: 0o600 });
        }
        return result;
      };
    `
  );
  const script = `
    const [runner, root, output] = process.argv.slice(1);
    const api = require(runner)._private;
    const target = api.prepareCapabilityOutputTarget({
      rootDir: root,
      requestedOutPath: output,
      explicit: true
    });
    try {
      api.writeCapabilityOutput(target, { schema_version: 2, result: "intended" });
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ committed: error.committed, message: error.message }));
    }
  `;
  try {
    const result = require("node:child_process").spawnSync(
      process.execPath,
      [
        "-e",
        script,
        path.join(ROOT, "scripts", "evals", "design-critique-capability-run.js"),
        ROOT,
        requestedOutPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.unexpected, undefined);
    assert.equal(failure.committed, true);
    assert.match(failure.message, /committed.*do not retry/i);
    assert.equal(fs.readFileSync(requestedOutPath, "utf8"), "foreign-substitution\n");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(externalRoot, "intended-output.json"), "utf8")),
      { schema_version: 2, result: "intended" }
    );
  } finally {
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("scenario recreation rejects a symlinked scenario root without deleting external data", () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-root-")));
  const externalDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-external-"))
  );
  const scenarioId = "dc-cap-symlink-containment-sol-high-r1";
  const externalScenario = path.join(externalDir, scenarioId);
  const sentinel = path.join(externalScenario, "sentinel.txt");
  const scenarioRoot = path.join(rootDir, "eval-results", "capability-scenarios");
  fs.mkdirSync(path.dirname(scenarioRoot), { recursive: true });
  fs.mkdirSync(externalScenario);
  fs.writeFileSync(sentinel, "must survive\n");
  fs.symlinkSync(externalDir, scenarioRoot, process.platform === "win32" ? "junction" : "dir");

  try {
    assert.throws(
      () =>
        _private.writeCapabilityScenario({
          rootDir,
          scenarioDir: path.join(scenarioRoot, scenarioId),
          scenarioId,
          fixtureBytes: Buffer.from("fixture"),
        }),
      /only real directories|must not traverse symlinks|canonical real directories/
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
    assert.equal(fs.lstatSync(scenarioRoot).isSymbolicLink(), true);
  } finally {
    fs.unlinkSync(scenarioRoot);
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});

test("capability isolation refuses every symlinked repository output root", () => {
  for (const outputRoot of ["capability-isolation", "oracle-isolation-preflight", "runs"]) {
    const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-root-")));
    const externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-outside-")));
    const evalResults = path.join(rootDir, "eval-results");
    const redirected = path.join(evalResults, outputRoot);
    const sentinel = path.join(externalDir, "sentinel.txt");
    fs.mkdirSync(evalResults);
    fs.writeFileSync(sentinel, "must survive\n");
    fs.symlinkSync(externalDir, redirected, process.platform === "win32" ? "junction" : "dir");
    const before = fs.readdirSync(externalDir).sort();
    let sandboxCalled = false;

    try {
      assert.throws(
        () =>
          _private.prepareCandidateIsolation({
            rootDir,
            runIdentity: {
              run_id: `20260905T000000Z--dc-cap-${outputRoot}-sol-high-r1--codex`,
              scenario_id: `dc-cap-${outputRoot}-sol-high-r1`,
              adapter: "codex",
            },
            runtimeProfile: { adapter: "codex", harness_only: false },
            sourceBoundary: rootDir,
            sandboxExecPath: process.execPath,
            codexBin: process.execPath,
            sandboxRunner() {
              sandboxCalled = true;
              return { status: 0, signal: null, error: null };
            },
          }),
        /canonical real directories/
      );
      assert.equal(sandboxCalled, false, `${outputRoot} escaped before the sandbox preflight`);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
      assert.deepEqual(fs.readdirSync(externalDir).sort(), before);
    } finally {
      fs.unlinkSync(redirected);
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  }
});

test("default capability output refuses a symlinked repository parent", () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-root-")));
  const externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-outside-")));
  const qualityDir = path.join(rootDir, "evals", "quality");
  const evalResults = path.join(rootDir, "eval-results");
  const redirected = path.join(evalResults, "capabilities");
  const sentinel = path.join(externalDir, "sentinel.txt");
  fs.mkdirSync(qualityDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "evals", "quality", "suite.json"),
    path.join(qualityDir, "suite.json")
  );
  fs.mkdirSync(evalResults);
  fs.writeFileSync(sentinel, "must survive\n");
  fs.symlinkSync(externalDir, redirected, process.platform === "win32" ? "junction" : "dir");
  const before = fs.readdirSync(externalDir).sort();

  try {
    assert.throws(
      () =>
        runCapabilityBatch({
          rootDir,
          oraclePath: path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
          profileId: "sol-high",
          repeat: 1,
          adapterOverride: "stub",
        }),
      /canonical real directories|default capability output must remain inside the repository/
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
    assert.deepEqual(fs.readdirSync(externalDir).sort(), before);
  } finally {
    fs.unlinkSync(redirected);
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});

test("stub batch rejects a symlinked runs root without external mutation", () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-root-")));
  const externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-outside-")));
  const outDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cap-output-")));
  const qualityDir = path.join(rootDir, "evals", "quality");
  const evalResults = path.join(rootDir, "eval-results");
  const redirected = path.join(evalResults, "runs");
  const sentinel = path.join(externalDir, "sentinel.txt");
  const outPath = path.join(outDir, "repeat-1.json");
  fs.mkdirSync(qualityDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "evals", "quality", "suite.json"),
    path.join(qualityDir, "suite.json")
  );
  fs.mkdirSync(evalResults);
  fs.writeFileSync(sentinel, "must survive\n");
  fs.symlinkSync(externalDir, redirected, process.platform === "win32" ? "junction" : "dir");
  const before = fs.readdirSync(externalDir).sort();

  try {
    assert.throws(
      () =>
        runCapabilityBatch({
          rootDir,
          oraclePath: path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
          profileId: "sol-high",
          repeat: 1,
          outPath,
          adapterOverride: "stub",
        }),
      /canonical real directories/
    );
    assert.equal(fs.existsSync(outPath), false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
    assert.deepEqual(fs.readdirSync(externalDir).sort(), before);
  } finally {
    fs.unlinkSync(redirected);
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
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
    // The runner is stubbed; use a real executable identity available on every host.
    sandboxExecPath: process.execPath,
    codexBin: process.execPath,
    sandboxRunner(command, argv) {
      observed = { command, argv };
      return { status: 0, signal: null, error: null };
    },
  });
  try {
    assert.equal(observed.command, fs.realpathSync(process.execPath));
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
    sandboxExecPath: process.execPath,
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

test("sandbox attestation rejects substitute executables and revalidates policy semantics", () => {
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
    sandboxExecPath: process.execPath,
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
      ["oracle_isolation.bindings.preflight.sandbox_exec must be /usr/bin/sandbox-exec"]
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
