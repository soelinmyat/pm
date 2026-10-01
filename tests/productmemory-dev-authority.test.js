"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createNativeDevAuthority } = require("../scripts/productmemory-dev-authority");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-dev-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  fs.mkdirSync(path.join(root, "pm"));
  const entries = ["proposal", "rfc"].map((role) => {
    const relative = `pm/${role}.json`;
    fs.writeFileSync(path.join(root, relative), role);
    return {
      path: relative,
      role,
      revision: 1,
      content_hash: crypto.createHash("sha256").update(role).digest("hex"),
    };
  });
  const local = {
    run_id: "run1",
    phase: "verification",
    source: { repo_root: root, worktree: root, branch: "feature", base_commit: "d".repeat(40) },
    task: {
      proposal: { path: path.join(root, entries[0].path) },
      rfc_sidecar: { path: path.join(root, entries[1].path) },
    },
  };
  const session = {
    id: 10,
    feature_workflow_id: 3,
    feature_bundle_id: 4,
    feature_bundle_review_id: 8,
    owner_id: 2,
    state: "running",
    revision: 1,
    repository: root,
    branch: "feature",
    base_commit: local.source.base_commit,
  };
  const workflow = {
    id: 3,
    project: "cleanlog",
    record_id: "bkl_ABC",
    revision: 8,
    status: "in-progress",
    owner_id: 2,
    bundle: {
      id: 4,
      digest: "a".repeat(64),
      current: true,
      review: { id: 8, decision: "approved", user: "wife@example.com" },
      entries,
    },
    sessions: [session],
  };
  const receipt = {
    schema_version: 1,
    kind: "pm-native-dev-binding",
    service_url: "https://productmemory.io",
    project: "cleanlog",
    local_run_id: local.run_id,
    record_id: workflow.record_id,
    workflow_revision: 8,
    bundle_id: 4,
    bundle_digest: workflow.bundle.digest,
    review_id: 8,
    owner_id: 2,
    remote_session_id: 10,
    remote_session_revision: 1,
    repository: root,
    branch: "feature",
    base_commit: local.source.base_commit,
  };
  const calls = [];
  const options = {
    transport: {
      identity: { service_url: receipt.service_url, project: receipt.project },
      request: async (input) => {
        calls.push(input);
        return { status: 200, body: workflow };
      },
    },
    readCanonicalState: () => structuredClone(local),
    verifyWorkspace: () => {},
    currentCommit: () => "e".repeat(40),
    verifyCurrentDelivery: () => ({ commit: "e".repeat(40), gates: [] }),
  };
  return { root, local, session, workflow, receipt, calls, options };
}
test("live authority accepts matching documents and canonical phase", async (t) => {
  const f = fixture(t);
  await createNativeDevAuthority(f.options).assertCurrent("unused", f.receipt, "verification");
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    createNativeDevAuthority(f.options).assertCurrent("unused", f.receipt, "delivery"),
    /current phase/
  );
});
test("changed document bytes block authority", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "pm/rfc.json"), "changed");
  await assert.rejects(
    createNativeDevAuthority(f.options).assertCurrent("unused", f.receipt),
    /bytes changed/
  );
});
test("new approval owner scope or revision requires explicit reconciliation", async (t) => {
  for (const mutate of [
    (w) => w.revision++,
    (w) => w.owner_id++,
    (w) => w.bundle.review.id++,
    (w) => {
      w.bundle.current = false;
    },
    (w) => {
      w.sessions[0].state = "failed";
    },
  ]) {
    const f = fixture(t);
    mutate(f.workflow);
    await assert.rejects(
      createNativeDevAuthority(f.options).assertCurrent("unused", f.receipt),
      /changed/
    );
    assert.equal(f.calls.length, 1);
  }
});
test("failed canonical gates never send verified report", async (t) => {
  const f = fixture(t);
  f.options.verifyCurrentDelivery = () => {
    throw new Error("quality gate failed");
  };
  await assert.rejects(
    createNativeDevAuthority(f.options).certify("unused", f.receipt),
    /quality gate/
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("HEAD movement during certification blocks report", async (t) => {
  const f = fixture(t);
  f.options.currentCommit = () => "f".repeat(40);
  await assert.rejects(
    createNativeDevAuthority(f.options).certify("unused", f.receipt),
    /HEAD changed/
  );
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("default canonical reader rejects imported or unproven session", async (t) => {
  const f = fixture(t);
  delete f.options.readCanonicalState;
  const sessionPath = path.join(f.root, "session.json");
  fs.writeFileSync(sessionPath, JSON.stringify({ schema_version: 1 }));
  await assert.rejects(
    createNativeDevAuthority(f.options).assertCurrent(sessionPath, f.receipt),
    /Upgrade legacy/
  );
  assert.equal(f.calls.length, 0);
});

test("default workspace probes ignore hostile Git environment", async (t) => {
  const f = fixture(t);
  execFileSync("git", [
    "-C",
    f.root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  f.local.source.branch = execFileSync("git", ["-C", f.root, "branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
  f.local.source.base_commit = execFileSync("git", ["-C", f.root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  f.receipt.branch = f.session.branch = f.local.source.branch;
  f.receipt.base_commit = f.session.base_commit = f.local.source.base_commit;
  delete f.options.verifyWorkspace;
  const before = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    process.env.GIT_DIR = path.join(f.root, "missing-repository");
    process.env.GIT_WORK_TREE = path.join(f.root, "missing-worktree");
    await createNativeDevAuthority(f.options).assertCurrent("unused", f.receipt);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("reused readiness provenance verifier rejects absent approval artifacts", (t) => {
  const f = fixture(t);
  const { verifyRfcReadinessProvenance } = require("../scripts/lib/dev-session-schema");
  assert.throws(() => verifyRfcReadinessProvenance(f.local), /RFC readiness|JSON|Unexpected/);
});
