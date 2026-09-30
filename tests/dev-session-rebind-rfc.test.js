"use strict";

// Real post-handoff ownership correction: an approved RFC is amended through the
// RFC CLI, and Dev rebinds to it only through `rebind-rfc`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const {
  completeAmendment,
  completeApprovedRun,
  makeRfcRepo,
} = require("./helpers/rfc-run-fixture");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");
const SLUG = "rebind-rfc";

function issue(num, dependsOn, owns) {
  return {
    num,
    title: `Issue ${num}`,
    size: "S",
    depends_on: dependsOn,
    owns,
    acceptance_criteria: [`AC-${num}`],
    approach: `Implement issue ${num}.`,
    verification_commands: ["node --test"],
    test_hooks: [`AC-${num}`],
  };
}

function makeDevRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-rebind-"));
  // Inputs live outside the worktree so worker-commit verification sees it clean.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-rebind-inputs-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return {
    root,
    scratch,
    run(args) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          XDG_CONFIG_HOME: path.join(root, ".test-config"),
          PM_EXECUTION_POLICY_FILE: "",
        },
      });
    },
    commit(files, message) {
      for (const [relative, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.writeFileSync(path.join(root, relative), content);
        execFileSync("git", ["add", relative], { cwd: root });
      }
      execFileSync("git", ["commit", "-qm", message], { cwd: root });
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(scratch, { recursive: true, force: true });
    },
  };
}

// Dev reads completed RFC runs from its own repository, so every archived hop
// is copied across, as an operator does for a separate-repo KB.
function copyArchives(rfc, dev) {
  const relative = path.join(".pm", "rfc-sessions", "completed", SLUG);
  fs.cpSync(path.join(rfc.root, relative), path.join(dev.root, relative), { recursive: true });
}

function boundScenario(issues) {
  const rfc = makeRfcRepo();
  const dev = makeDevRepo();
  const approved = completeApprovedRun(rfc, SLUG, { issues });
  copyArchives(rfc, dev);
  const sidecarPath = path.join(rfc.root, `${SLUG}.json`);
  const initialized = dev.run(["init", "--slug", SLUG, "--source-dir", dev.root, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const sessionPath = JSON.parse(initialized.stdout).session_path;
  const factsPath = path.join(dev.scratch, "facts.json");
  fs.writeFileSync(
    factsPath,
    JSON.stringify({ kind: "proposal", size: "M", risk: {}, acceptance_criteria: ["AC-1"] })
  );
  const routed = dev.run([
    "route",
    "--session",
    sessionPath,
    "--facts",
    factsPath,
    "--rfc-sidecar",
    sidecarPath,
    "--json",
  ]);
  assert.equal(routed.status, 0, routed.stderr);
  const boundHash = readSession(sessionPath).task.rfc_sidecar.sha256;
  return {
    rfc,
    dev,
    approved,
    sidecarPath,
    sessionPath,
    boundHash,
    enterImplementation() {
      const session = readSession(sessionPath);
      session.phase = "implementation";
      session.routing.required_phases = ["implementation", "retro"];
      fs.writeFileSync(sessionPath, JSON.stringify(session));
    },
    start(id) {
      const running = dev.run([
        "work-unit",
        "--session",
        sessionPath,
        "--id",
        id,
        "--status",
        "running",
        "--json",
      ]);
      assert.equal(running.status, 0, running.stderr);
      return JSON.parse(running.stdout).work_unit.base_commit;
    },
    complete(id, baseCommit, commit, filesChanged = 1) {
      const resultPath = path.join(dev.scratch, `${id}-result.json`);
      fs.writeFileSync(
        resultPath,
        JSON.stringify({
          schema_version: 1,
          work_unit_id: id,
          status: "completed",
          summary: `${id} complete`,
          commit,
          files_changed: filesChanged,
          evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
          blocker: null,
          runtime: { provider: "inline", model: "test" },
        })
      );
      return dev.run([
        "work-unit",
        "--session",
        sessionPath,
        "--id",
        id,
        "--status",
        "completed",
        "--result",
        resultPath,
        "--base-commit",
        baseCommit,
        "--json",
      ]);
    },
    rebind(expectedSha, extra = []) {
      return dev.run([
        "rebind-rfc",
        "--session",
        sessionPath,
        "--rfc-sidecar",
        sidecarPath,
        "--expected-sidecar-sha256",
        expectedSha,
        "--reason",
        "Approved RFC amendment corrects work-unit ownership",
        "--json",
        ...extra,
      ]);
    },
    cleanup() {
      rfc.cleanup();
      dev.cleanup();
    },
  };
}

function readSession(sessionPath) {
  return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
}

test("rebind-rfc adopts an approved owns-only amendment so a blocked unit can complete", () => {
  const scenario = boundScenario([issue(1, [], ["README.md"]), issue(2, [1], ["src/second.js"])]);
  const { dev, sessionPath } = scenario;
  try {
    scenario.enterImplementation();
    const firstBase = scenario.start("rfc-1");
    const first = scenario.complete(
      "rfc-1",
      firstBase,
      dev.commit({ "README.md": "rfc-1\n" }, "rfc-1")
    );
    assert.equal(first.status, 0, first.stderr);
    const secondBase = scenario.start("rfc-2");
    const secondCommit = dev.commit(
      { "README.md": "rfc-1\nrfc-2\n", "src/second.js": "module.exports = 2;\n" },
      "rfc-2"
    );
    const rejected = scenario.complete("rfc-2", secondBase, secondCommit, 2);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /outside assigned ownership: README\.md/);

    const amendment = completeAmendment(scenario.rfc, scenario.approved.archivePath, {
      issues: "2",
      reason: "rfc-2 must also update the README",
      mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
    });
    const drifted = dev.run(["next", "--session", sessionPath]);
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /sidecar identity hash drifted.*rebind-rfc/);

    const before = fs.readFileSync(sessionPath, "utf8");
    const unarchived = scenario.rebind(amendment.sidecarHash);
    assert.equal(unarchived.status, 3, unarchived.stderr);
    assert.match(unarchived.stderr, /no matching completed RFC run/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);

    copyArchives(scenario.rfc, dev);
    const stale = scenario.rebind(`sha256:${"b".repeat(64)}`);
    assert.equal(stale.status, 3, stale.stderr);
    assert.match(stale.stderr, /--expected-sidecar-sha256 .* observed/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);

    const rebound = scenario.rebind(amendment.sidecarHash);
    assert.equal(rebound.status, 0, rebound.stderr);
    const session = readSession(sessionPath);
    assert.equal(session.task.rfc_sidecar.sha256, amendment.sidecarHash);
    assert.deepEqual(session.task.work_units[1].owns, ["src/second.js", "README.md"]);
    assert.equal(session.task.work_units[1].status, "running");
    assert.equal(session.task.work_units[1].base_commit, secondBase);
    assert.deepEqual(session.task.work_units[0].owns, ["README.md"]);
    assert.equal(session.task.rfc_contract_history.length, 1);
    if (Ajv2020) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const published = ajv.compile(
        JSON.parse(
          fs.readFileSync(
            path.join(__dirname, "..", "skills", "dev", "references", "dev-session.schema.json"),
            "utf8"
          )
        )
      );
      assert.equal(published(session), true, JSON.stringify(published.errors));
      const extra = structuredClone(session);
      extra.task.rfc_contract_history[0].changed_units[0].removed_owns = [];
      assert.equal(published(extra), false);
    }
    const [entry] = session.task.rfc_contract_history;
    assert.match(entry.approval_sha256, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!Number.isNaN(Date.parse(entry.recorded_at)));
    assert.deepEqual(
      { ...entry, approval_sha256: null, recorded_at: null },
      {
        from_sidecar_sha256: scenario.boundHash,
        to_sidecar_sha256: amendment.sidecarHash,
        approval_run_id: amendment.runId,
        approval_sha256: null,
        amends_run_id: scenario.approved.runId,
        reason: "Approved RFC amendment corrects work-unit ownership",
        changed_units: [{ id: "rfc-2", status: "running", added_owns: ["README.md"] }],
        recorded_at: null,
      }
    );

    const retried = scenario.rebind(amendment.sidecarHash);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(JSON.parse(retried.stdout).idempotent, true);
    assert.equal(readSession(sessionPath).task.rfc_contract_history.length, 1);

    assert.equal(dev.run(["next", "--session", sessionPath]).status, 0);
    assert.equal(dev.run(["validate", "--session", sessionPath]).status, 0);
    const accepted = scenario.complete("rfc-2", secondBase, secondCommit, 2);
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    scenario.cleanup();
  }
});

test("rebind-rfc refuses running-unit overlap without touching the session", () => {
  const scenario = boundScenario([
    issue(1, [], ["README.md"]),
    issue(2, [1], ["src/two.js"]),
    issue(3, [1], ["src/three.js"]),
  ]);
  const { dev, sessionPath } = scenario;
  try {
    scenario.enterImplementation();
    const firstBase = scenario.start("rfc-1");
    const first = scenario.complete(
      "rfc-1",
      firstBase,
      dev.commit({ "README.md": "rfc-1\n" }, "rfc-1")
    );
    assert.equal(first.status, 0, first.stderr);
    scenario.start("rfc-2");
    scenario.start("rfc-3");

    const overlapping = completeAmendment(scenario.rfc, scenario.approved.archivePath, {
      issues: "3",
      reason: "rfc-3 also touches rfc-2's module",
      mutate: (sidecar) => sidecar.issues[2].owns.push("src/two.js"),
    });
    copyArchives(scenario.rfc, dev);
    const before = fs.readFileSync(sessionPath, "utf8");
    const overlap = scenario.rebind(overlapping.sidecarHash);
    assert.equal(overlap.status, 3, overlap.stderr);
    assert.match(overlap.stderr, /running work units rfc-2 and rfc-3 would share ownership/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);
  } finally {
    scenario.cleanup();
  }
});

// A finished unit whose commit also touched a path it did not own is recovered
// by an approved amendment that extends its ownership. Its commit only ever
// grows more covered, so the rebind records the change and implementation
// continues against the amended contract.
test("rebind-rfc lets a completed unit gain ownership under an approved amendment", () => {
  const scenario = boundScenario([issue(1, [], ["README.md"]), issue(2, [1], ["src/two.js"])]);
  const { dev, sessionPath } = scenario;
  try {
    scenario.enterImplementation();
    const firstBase = scenario.start("rfc-1");
    const first = scenario.complete(
      "rfc-1",
      firstBase,
      dev.commit({ "README.md": "rfc-1\n" }, "rfc-1")
    );
    assert.equal(first.status, 0, first.stderr);

    const amended = completeAmendment(scenario.rfc, scenario.approved.archivePath, {
      issues: "1",
      reason: "rfc-1 also owns its docs page",
      mutate: (sidecar) => sidecar.issues[0].owns.push("docs/one.md"),
    });
    copyArchives(scenario.rfc, dev);
    const rebound = scenario.rebind(amended.sidecarHash);
    assert.equal(rebound.status, 0, rebound.stderr);

    const session = readSession(sessionPath);
    const unit = session.task.work_units.find((candidate) => candidate.id === "rfc-1");
    assert.equal(unit.status, "completed");
    assert.deepEqual(unit.owns, ["README.md", "docs/one.md"]);
    assert.deepEqual(session.task.rfc_contract_history.at(-1).changed_units, [
      { id: "rfc-1", status: "completed", added_owns: ["docs/one.md"] },
    ]);

    const secondBase = scenario.start("rfc-2");
    const second = scenario.complete(
      "rfc-2",
      secondBase,
      dev.commit({ "src/two.js": "rfc-2\n" }, "rfc-2")
    );
    assert.equal(second.status, 0, second.stderr);
  } finally {
    scenario.cleanup();
  }
});

test("rebind-rfc rebuilds units only from the exact bytes the approval proves", () => {
  const crypto = require("node:crypto");
  const { rebindRfcContract } = require("../scripts/lib/dev-session-schema");
  const scenario = boundScenario([issue(1, [], ["README.md"]), issue(2, [], ["src/second.js"])]);
  const { dev, sessionPath, sidecarPath } = scenario;
  const realRead = fs.readFileSync;
  try {
    scenario.enterImplementation();
    scenario.start("rfc-2");
    completeAmendment(scenario.rfc, scenario.approved.archivePath, {
      issues: "2",
      reason: "rfc-2 must also update the README",
      mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
    });
    copyArchives(scenario.rfc, dev);
    const tampered = JSON.parse(realRead(sidecarPath, "utf8"));
    tampered.issues[1].owns.push("src/unapproved.js");
    const tamperedBytes = Buffer.from(`${JSON.stringify(tampered, null, 2)}\n`);
    const tamperedHash = `sha256:${crypto.createHash("sha256").update(tamperedBytes).digest("hex")}`;
    const realSidecar = fs.realpathSync(sidecarPath);
    // Serve unapproved bytes everywhere except inside approval verification,
    // as if the file were swapped back and forth around that check.
    fs.readFileSync = function patched(file, ...rest) {
      const target = typeof file === "string" && fs.existsSync(file) ? fs.realpathSync(file) : null;
      if (target === realSidecar && !new Error().stack.includes("verifyRfcApproval")) {
        return rest[0] ? tamperedBytes.toString(rest[0]?.encoding || rest[0]) : tamperedBytes;
      }
      return realRead.call(fs, file, ...rest);
    };
    assert.throws(
      () =>
        rebindRfcContract(readSession(sessionPath), {
          sidecarPath,
          expectedSha256: tamperedHash,
          reason: "tampered rebind",
        }),
      /approval covers .* not the observed RFC sidecar/
    );
  } finally {
    fs.readFileSync = realRead;
    scenario.cleanup();
  }
});

test("rebind-rfc is limited to a bound sidecar path after intake", () => {
  const scenario = boundScenario([issue(1, [], ["README.md"]), issue(2, [1], ["src/second.js"])]);
  const { dev, sessionPath } = scenario;
  try {
    // Every guard here fires before the sidecar hash is compared.
    const anyHash = `sha256:${"c".repeat(64)}`;
    const before = fs.readFileSync(sessionPath, "utf8");
    const inIntake = scenario.rebind(anyHash);
    assert.equal(inIntake.status, 3, inIntake.stderr);
    assert.match(inIntake.stderr, /rerun route --rfc-sidecar while intake is active/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);

    scenario.enterImplementation();
    const copyPath = path.join(scenario.rfc.root, "copied-rfc.json");
    fs.copyFileSync(scenario.sidecarPath, copyPath);
    const otherPath = dev.run([
      "rebind-rfc",
      "--session",
      sessionPath,
      "--rfc-sidecar",
      copyPath,
      "--expected-sidecar-sha256",
      anyHash,
      "--reason",
      "Wrong file",
    ]);
    assert.equal(otherPath.status, 3, otherPath.stderr);
    assert.match(otherPath.stderr, /must rebind the bound RFC sidecar/);

    const missingReason = dev.run([
      "rebind-rfc",
      "--session",
      sessionPath,
      "--rfc-sidecar",
      scenario.sidecarPath,
      "--expected-sidecar-sha256",
      anyHash,
    ]);
    assert.notEqual(missingReason.status, 0);
    assert.match(missingReason.stderr, /--reason/);
  } finally {
    scenario.cleanup();
  }
});

test("rebind-rfc refuses a session that is not bound to an RFC sidecar", () => {
  const dev = makeDevRepo();
  try {
    const initialized = dev.run(["init", "--slug", SLUG, "--source-dir", dev.root, "--json"]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const sessionPath = JSON.parse(initialized.stdout).session_path;
    const refused = dev.run([
      "rebind-rfc",
      "--session",
      sessionPath,
      "--rfc-sidecar",
      path.join(dev.root, "missing.json"),
      "--expected-sidecar-sha256",
      `sha256:${"c".repeat(64)}`,
      "--reason",
      "No binding",
    ]);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /not bound to an RFC sidecar/);
  } finally {
    dev.cleanup();
  }
});

test("readiness accepts a v2 amendment approval backed by its lineage", () => {
  const { createSession, validateResult } = require("../scripts/lib/dev-session-schema");
  const rfc = makeRfcRepo();
  try {
    const approved = completeApprovedRun(rfc, SLUG, {
      issues: [issue(1, [], ["README.md"]), issue(2, [1], ["src/second.js"])],
    });
    completeAmendment(rfc, approved.archivePath, {
      issues: "2",
      reason: "rfc-2 must also update the README",
      mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
    });
    const sidecarPath = path.join(rfc.root, `${SLUG}.json`);
    const session = createSession({ slug: SLUG, sourceDir: rfc.root });
    session.phase = "readiness";
    session.routing.required_phases = ["readiness", "implementation", "retro"];
    session.task.design_context = JSON.parse(fs.readFileSync(sidecarPath, "utf8")).design_context;
    const result = {
      schema_version: 1,
      run_id: session.run_id,
      phase: "readiness",
      attempt: 1,
      status: "passed",
      summary: "Amended RFC is approved for exact artifacts",
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: rfc.root,
        encoding: "utf8",
      }).trim(),
      files_changed: [],
      evidence: [
        {
          kind: "rfc-readiness",
          command: "rfc-sidecar-check",
          exit_code: 0,
          artifact: sidecarPath,
        },
      ],
      blocker: null,
      runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    };
    assert.deepEqual(validateResult(session, result), []);
  } finally {
    rfc.cleanup();
  }
});

test("task.rfc_contract_history is a closed, append-only audit shape", () => {
  const { createSession, validateSession } = require("../scripts/lib/dev-session-schema");
  const dev = makeDevRepo();
  try {
    const session = createSession({ slug: SLUG, sourceDir: dev.root });
    const hash = (char) => `sha256:${char.repeat(64)}`;
    const entry = {
      from_sidecar_sha256: hash("a"),
      to_sidecar_sha256: hash("b"),
      approval_run_id: "rfc_2",
      approval_sha256: hash("c"),
      amends_run_id: "rfc_1",
      reason: "Correct ownership",
      changed_units: [{ id: "rfc-2", status: "running", added_owns: ["README.md"] }],
      recorded_at: new Date().toISOString(),
    };
    session.task.rfc_contract_history = [entry];
    assert.deepEqual(
      validateSession(session).filter((error) => /rfc_contract_history/.test(error.path)),
      []
    );
    for (const broken of [
      { ...entry, extra: true },
      { ...entry, to_sidecar_sha256: "nope" },
      { ...entry, reason: " " },
      { ...entry, changed_units: [] },
      { ...entry, changed_units: [{ id: "rfc-2", status: "running", added_owns: [] }] },
      { ...entry, changed_units: [{ id: "rfc-2", status: "done", added_owns: ["README.md"] }] },
      { ...entry, recorded_at: "yesterday" },
    ]) {
      session.task.rfc_contract_history = [broken];
      assert.ok(
        validateSession(session).some((error) => /rfc_contract_history/.test(error.path)),
        JSON.stringify(broken)
      );
    }
    session.task.rfc_contract_history = [];
    assert.ok(
      validateSession(session).some((error) => /rfc_contract_history/.test(error.path)),
      "an empty history is absent, not []"
    );
    session.task.rfc_contract_history = [entry, { ...entry, from_sidecar_sha256: hash("d") }];
    assert.ok(
      validateSession(session).some((error) => /chain/.test(error.message)),
      "each entry must start where the previous one ended"
    );
  } finally {
    dev.cleanup();
  }
});
