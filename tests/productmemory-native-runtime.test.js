"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createNativeRuntime } = require("../scripts/productmemory-native-runtime");
const schema = require("../scripts/lib/dev-session-schema");
const { sha } = require("../scripts/lib/native-dev-contract");
const { fixture } = require("./helpers/productmemory-native-fixture");
test("fresh native bootstrap needs no local proposal RFC or approval audit", async (t) => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.root, "pm")), false);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  assert.deepEqual(schema.validateSession(initialized.session), []);
  assert.equal(initialized.session.task.proposal, null);
  assert.equal(initialized.session.task.rfc_sidecar, null);
  assert.equal(initialized.session.task.native.reviewer, "second-person@example.com");
  assert.equal(initialized.session.task.work_units[0].id, "rfc-1");
  assert.equal(initialized.session.authority.merge, false);
  assert.equal(initialized.session.authority.push_feature_branch, false);
  assert.ok(initialized.session.routing.required_gates.includes("review"));
  assert.ok(initialized.session.routing.required_gates.includes("qa"));
  assert.deepEqual(
    (await runtime.decision(initialized.session_path)).applicable_gates,
    initialized.decision.applicable_gates
  );
  assert.throws(() => schema.nextDecision(initialized.session), /live authorized host/);
  assert.equal(fs.existsSync(path.join(f.root, "pm")), false);
});
test("native bootstrap agrees with the published JSON schema", async (t) => {
  function optionalDevRequire(request) {
    try {
      return require(request);
    } catch (error) {
      const firstLine = String(error?.message || "").split("\n", 1)[0];
      if (error?.code === "MODULE_NOT_FOUND" && firstLine === `Cannot find module '${request}'`)
        return null;
      throw error;
    }
  }
  const Ajv2020 = optionalDevRequire("ajv/dist/2020");
  const addFormats = optionalDevRequire("ajv-formats");
  if (!Ajv2020 || !addFormats) {
    t.skip(
      "JSON schema parity needs the development-only ajv packages; runtime validation remains covered"
    );
    return;
  }
  const f = fixture(t);
  const initialized = await createNativeRuntime(f.transport).initialize(f.options);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const published = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../skills/dev/references/dev-session.schema.json"))
  );
  const validate = ajv.compile(published);
  assert.equal(validate(initialized.session), true, JSON.stringify(validate.errors));
});
test("requests changes refuse remote start", async (t) => {
  const f = fixture(t);
  f.workflow.bundle.review.decision = "changes_requested";
  await assert.rejects(
    createNativeRuntime(f.transport).initialize(f.options),
    /current native bundle review/
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("owner changes block resumed decision", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  f.workflow.owner_id++;
  await assert.rejects(runtime.decision(initialized.session_path), /approval, scope, owner/);
});
test("unknown start response recovers acknowledged session without replay", async (t) => {
  const f = fixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "POST") throw new Error("response lost");
    return response;
  };
  const runtime = createNativeRuntime(f.transport);
  await assert.rejects(runtime.initialize(f.options), /response lost/);
  const initialized = await runtime.recoverInitialization(f.options);
  assert.equal(initialized.session.task.native.remote_session_id, 9);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(
    (await runtime.recoverInitialization(f.options)).session.run_id,
    initialized.session.run_id
  );
});
test("changed remote state prevents initialization recovery and replay", async (t) => {
  const f = fixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "POST") throw new Error("response lost");
    return response;
  };
  const runtime = createNativeRuntime(f.transport);
  await assert.rejects(runtime.initialize(f.options), /response lost/);
  f.workflow.owner_id++;
  await assert.rejects(runtime.recoverInitialization(f.options), /reconcile explicitly/);
  await assert.rejects(runtime.initialize(f.options), /pending intent/);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});
test("pinned snapshot corruption blocks resumed execution", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  fs.appendFileSync(path.join(initialized.session.task.native.snapshot_root, "pm/rfc.json"), " ");
  await assert.rejects(
    runtime.decision(initialized.session_path),
    /Pinned native document bytes changed/
  );
});
test("incomplete execution cannot claim verified remote status", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  await assert.rejects(runtime.certify(initialized.session_path), /Finish implementation/);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(f.workflow.sessions[0].state, "running");
});
test("branch changes and withdrawn review block execution", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  execFileSync("git", ["checkout", "-qb", "unbound"], { cwd: f.root });
  await assert.rejects(
    runtime.decision(initialized.session_path),
    /worktree\/snapshot identity changed/
  );
  execFileSync("git", ["checkout", "-q", "structured-groom"], { cwd: f.root });
  f.workflow.bundle.review.decision = "changes_requested";
  await assert.rejects(runtime.decision(initialized.session_path), /approval/);
});

test("initialization recovery refuses a foreign service before remote reads", async (t) => {
  const f = fixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "POST") throw new Error("response lost");
    return response;
  };
  await assert.rejects(createNativeRuntime(f.transport).initialize(f.options), /response lost/);
  const before = f.calls.length;
  const foreign = {
    ...f.transport,
    identity: { ...f.transport.identity, service_url: "https://other.example.com" },
  };
  await assert.rejects(
    createNativeRuntime(foreign).recoverInitialization(f.options),
    /intent mismatch/
  );
  assert.equal(f.calls.length, before);
});

async function certificationFixture(t) {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  const session = initialized.session;
  session.phase = "ship";
  session.task.work_units.forEach((unit) => {
    unit.status = "completed";
    unit.base_commit = session.source.base_commit;
    unit.assigned_worktree = f.root;
    unit.assigned_branch = session.source.branch;
    unit.result = {
      schema_version: 1,
      work_unit_id: unit.id,
      status: "completed",
      summary: "Fixture implementation complete",
      commit: session.source.base_commit,
      files_changed: 0,
      evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
      blocker: null,
      runtime: { provider: "codex", model: "fixture" },
    };
  });
  assert.deepEqual(schema.validateSession(session), []);
  fs.writeFileSync(initialized.session_path, JSON.stringify(session));
  const proof = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim(),
    gate_manifest_sha256: "c".repeat(64),
    gates: [],
  };
  // This isolates acknowledgement/CAS/recovery from the separately tested real
  // canonical verifier. Runtime callers cannot supply this fixture boundary.
  t.mock.method(require("../scripts/productmemory-dev-authority"), "verifyDelivery", () => proof);
  return { ...f, runtime, initialized, proof };
}
test("verified acknowledgement persists exact certification and is idempotent", async (t) => {
  const f = await certificationFixture(t);
  const result = await f.runtime.certify(f.initialized.session_path);
  assert.equal(result.session.task.native.remote_session_state, "verified");
  assert.equal(result.session.task.native.remote_session_revision, 2);
  assert.equal(result.session.task.native.workflow_revision, 7);
  assert.equal(result.session.task.native.certification.commit, f.proof.commit);
  assert.equal(result.session.authority.merge, false);
  assert.equal(result.session.authority.push_feature_branch, false);
  assert.equal((await f.runtime.certify(f.initialized.session_path)).idempotent, true);
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
});
test("lost certification response recovers exact acknowledgement without replay", async (t) => {
  const f = await certificationFixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "PATCH") throw new Error("response lost");
    return response;
  };
  await assert.rejects(f.runtime.certify(f.initialized.session_path), /response lost/);
  assert.equal(
    JSON.parse(fs.readFileSync(f.initialized.session_path)).task.native.remote_session_state,
    "running"
  );
  const recovered = await f.runtime.recoverCertification(f.initialized.session_path);
  assert.equal(recovered.session.task.native.remote_session_state, "verified");
  assert.equal((await f.runtime.recoverCertification(f.initialized.session_path)).idempotent, true);
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
});
test("certification recovery refuses changed acknowledgement or HEAD", async (t) => {
  const f = await certificationFixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "PATCH") throw new Error("response lost");
    return response;
  };
  await assert.rejects(f.runtime.certify(f.initialized.session_path), /response lost/);
  f.workflow.sessions[0].verification = "foreign evidence";
  await assert.rejects(
    f.runtime.recoverCertification(f.initialized.session_path),
    /acknowledgement mismatch/
  );
  const intent = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(f.initialized.session_path), "native-certification-intent.json")
    )
  );
  f.workflow.sessions[0].verification = intent.verification;
  execFileSync("git", ["commit", "--allow-empty", "-qm", "HEAD moved"], { cwd: f.root });
  await assert.rejects(
    f.runtime.recoverCertification(f.initialized.session_path),
    /commit\/evidence changed/
  );
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
});

test("native work-unit assignment can change while its reviewed contract stays pinned", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  initialized.session.phase = "implementation";
  fs.writeFileSync(initialized.session_path, JSON.stringify(initialized.session));
  const running = await runtime.transitionWorkUnit(initialized.session_path, {
    id: "rfc-1",
    status: "running",
  });
  assert.equal(running.task.work_units[0].assigned_worktree, fs.realpathSync(f.root));
  assert.equal(running.task.work_units[0].base_commit, running.source.base_commit);
  assert.equal(running.task.work_units[0].status, "running");
  await runtime.decision(initialized.session_path);
  running.task.work_units[0].owns = ["foreign.txt"];
  fs.writeFileSync(initialized.session_path, JSON.stringify(running));
  await assert.rejects(runtime.decision(initialized.session_path), /work-unit contract changed/);
});

test("real canonical certification rejects missing delivery evidence without reporting", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  const session = initialized.session;
  session.phase = "ship";
  session.task.work_units.forEach((unit) => {
    unit.status = "completed";
    unit.base_commit = session.source.base_commit;
    unit.assigned_worktree = fs.realpathSync(f.root);
    unit.assigned_branch = session.source.branch;
    unit.result = {
      schema_version: 1,
      work_unit_id: unit.id,
      status: "completed",
      summary: "Fixture completed",
      commit: session.source.base_commit,
      files_changed: 0,
      evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
      blocker: null,
      runtime: { provider: "codex", model: "fixture" },
    };
  });
  fs.writeFileSync(initialized.session_path, JSON.stringify(session));
  execFileSync("git", ["remote", "add", "origin", f.root], { cwd: f.root });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", session.source.base_commit], {
    cwd: f.root,
  });
  execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
    cwd: f.root,
  });
  fs.writeFileSync(
    path.join(path.dirname(initialized.session_path), "gates.json"),
    JSON.stringify({ schema_version: 1, run_id: session.run_id, gates: [] })
  );
  await assert.rejects(
    runtime.certify(initialized.session_path),
    /Current PM gates failed: canonical session evidence/
  );
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 0);
  assert.equal(f.workflow.sessions[0].state, "running");
});

test("certification recovery refuses foreign service or project before remote reads", async (t) => {
  const f = await certificationFixture(t);
  const request = f.transport.request;
  f.transport.request = async (input) => {
    const response = await request(input);
    if (input.method === "PATCH") throw new Error("response lost");
    return response;
  };
  await assert.rejects(f.runtime.certify(f.initialized.session_path), /response lost/);
  const before = f.calls.length;
  for (const identity of [
    { ...f.transport.identity, service_url: "https://other.example.com" },
    { ...f.transport.identity, project: "other-project" },
  ]) {
    await assert.rejects(
      createNativeRuntime({ ...f.transport, identity }).recoverCertification(
        f.initialized.session_path
      ),
      /transport identity changed/
    );
    assert.equal(f.calls.length, before);
  }
});

for (const invalidUi of [null, false, "0", -1, 4]) {
  test(`native bootstrap rejects original UI risk ${JSON.stringify(invalidUi)} before remote start`, async (t) => {
    const f = fixture(t);
    const executionPath = "pm/execution.json";
    const execution = JSON.parse(f.documents.get(executionPath));
    execution.risk.ui = invalidUi;
    const bytes = Buffer.from(JSON.stringify(execution));
    f.documents.set(executionPath, bytes);
    f.workflow.bundle.entries.find((entry) => entry.path === executionPath).content_hash =
      sha(bytes);

    await assert.rejects(
      createNativeRuntime(f.transport).initialize(f.options),
      /ui must be an integer from 0 to 3/
    );
    assert.ok(f.calls.every((call) => call.method === "GET"));
    assert.equal(f.workflow.sessions.length, 0);
    assert.equal(
      fs.existsSync(path.join(f.root, ".pm", "dev-sessions", f.options.slug, "session.json")),
      false
    );
  });
}

for (const relativeLink of [".pm", ".pm/dev-sessions", ".pm/dev-sessions/structured-groom"]) {
  test(`native initialization refuses symlinked ${relativeLink} without outside writes`, async (t) => {
    const f = fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "native-outside-"));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.writeFileSync(path.join(outside, "sentinel.txt"), "untouched");
    const link = path.join(f.root, relativeLink);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link, "dir");

    await assert.rejects(createNativeRuntime(f.transport).initialize(f.options));

    assert.deepEqual(fs.readdirSync(outside), ["sentinel.txt"]);
    assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "untouched");
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.ok(f.calls.every((call) => call.method === "GET"));
    assert.equal(f.workflow.sessions.length, 0);
  });
}

test("native operations exclude another host operation on the same session and release the lock", async (t) => {
  const f = fixture(t);
  const runtime = createNativeRuntime(f.transport);
  const initialized = await runtime.initialize(f.options);
  const before = fs.readFileSync(initialized.session_path);
  const request = f.transport.request;
  let releaseRequest;
  let markEntered;
  const held = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  let holdNext = true;
  f.transport.request = async (input) => {
    if (holdNext && input.method === "GET") {
      holdNext = false;
      markEntered();
      await held;
    }
    return request(input);
  };
  const pending = runtime.decision(initialized.session_path);
  await entered;
  try {
    const callsBefore = f.calls.length;
    await assert.rejects(
      createNativeRuntime(f.transport).grant(
        initialized.session_path,
        ["push_feature_branch"],
        "Explicit fixture authorization"
      ),
      /project write lock/
    );
    assert.equal(f.calls.length, callsBefore);
    assert.deepEqual(fs.readFileSync(initialized.session_path), before);
  } finally {
    releaseRequest();
    await pending;
  }
  const resumed = await runtime.decision(initialized.session_path);
  assert.deepEqual(resumed.applicable_gates, initialized.decision.applicable_gates);
  assert.deepEqual(fs.readFileSync(initialized.session_path), before);
});

for (const operation of ["recertifyEvidence", "recordNonPassingQaCandidate"]) {
  test(`native ${operation} rejects stale authority before changing local evidence`, async (t) => {
    const f = fixture(t);
    const runtime = createNativeRuntime(f.transport);
    const initialized = await runtime.initialize(f.options);
    const before = fs.readFileSync(initialized.session_path);
    const directory = path.dirname(initialized.session_path);
    const beforeFiles = fs.readdirSync(directory).sort();
    const input =
      operation === "recertifyEvidence"
        ? {
            phases: ["qa"],
            commit: initialized.session.source.base_commit,
            verificationByPhase: { qa: [] },
          }
        : { status: "failed", commit: initialized.session.source.base_commit, records: [] };
    // Establish that the wrapper reaches the real schema validator when authority is current.
    await assert.rejects(
      runtime[operation](initialized.session_path, input),
      operation === "recertifyEvidence"
        ? /cannot recertify missing evidence for qa/
        : /non-passing QA candidates can only be recorded/
    );
    f.workflow.owner_id++;
    const callsBefore = f.calls.length;
    await assert.rejects(
      runtime[operation](initialized.session_path, input),
      /approval, scope, owner or bundle changed/
    );
    assert.deepEqual(fs.readFileSync(initialized.session_path), before);
    assert.deepEqual(fs.readdirSync(directory).sort(), beforeFiles);
    assert.ok(f.calls.slice(callsBefore).every((call) => call.method === "GET"));
    assert.equal(f.workflow.sessions[0].state, "running");
  });
}
