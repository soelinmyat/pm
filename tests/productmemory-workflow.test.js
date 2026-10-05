"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkflowClient } = require("../scripts/productmemory-workflow");
const identity = { service_url: "https://productmemory.io", project: "cleanlog" };
function fixture() {
  const state = {
    id: 3,
    project: "cleanlog",
    record_id: "bkl_ABC",
    revision: 7,
    status: "planned",
    owner_id: 2,
    bundle: {
      id: 4,
      digest: "a".repeat(64),
      current: true,
      review: { id: 8, decision: "approved", user: "wife@example.com" },
      entries: [
        { path: "pm/proposal.json", role: "proposal", revision: 2, content_hash: "b".repeat(64) },
        { path: "pm/rfc.json", role: "rfc", revision: 1, content_hash: "c".repeat(64) },
      ],
    },
  };
  const execution = {
    repository: "example/cleanlog",
    branch: "feature/native",
    base_commit: "d".repeat(40),
  };
  const session = {
    id: 10,
    feature_workflow_id: 3,
    feature_bundle_id: 4,
    feature_bundle_review_id: 8,
    owner_id: 2,
    state: "running",
    revision: 1,
    ...execution,
  };
  return { state, execution, session };
}

test("module discovers no credentials and requires explicit authorized transport", () => {
  assert.throws(() => createWorkflowClient({}), /authorized session/);
  for (const service_url of [
    "http://productmemory.io",
    "https://name:password@productmemory.io",
    "https://productmemory.io/api",
  ]) {
    assert.throws(
      () => createWorkflowClient({ identity: { ...identity, service_url }, request() {} }),
      /HTTPS service/
    );
  }
});

test("reads require matching project and record identity", async () => {
  const { state } = fixture();
  const calls = [];
  const client = createWorkflowClient({
    identity,
    request: async (input) => {
      calls.push(input);
      return { status: 200, body: { ...state, project: "other" } };
    },
  });
  await assert.rejects(client.get(state.record_id), /identity/);
  assert.equal(calls[0].path, "/api/v1/records/bkl_ABC/feature_workflow?project=cleanlog");
  await assert.rejects(client.get("../escape"), /Canonical/);
});

test("start binds exact observed review and source revisions without rereading or retrying", async () => {
  const { state, execution, session } = fixture();
  const calls = [];
  const client = createWorkflowClient({
    identity,
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        body: { workflow: { ...state, revision: 8, status: "in-progress" }, session },
      };
    },
  });
  const result = await client.start(state, execution);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.if_revision, 7);
  assert.equal(result.authority.review_id, 8);
  assert.equal(result.authority.kind, "productmemory-feature-execution");
  assert.deepEqual(result.authority.entries, state.bundle.entries);
  state.bundle.entries[0].revision = 99;
  assert.equal(result.authority.entries[0].revision, 2);
  assert.equal(result.authority.trusted_approval, undefined);
});

test("one owner may also be the current human reviewer", async () => {
  const { state, execution, session } = fixture();
  state.owner = "solo@example.com";
  state.bundle.review.user = state.owner;
  const client = createWorkflowClient({
    identity,
    request: async () => ({
      status: 200,
      body: { workflow: { ...state, revision: 8, status: "in-progress" }, session },
    }),
  });
  const result = await client.start(state, execution);
  assert.equal(result.authority.owner_id, state.owner_id);
  assert.equal(result.authority.reviewer, state.owner);
  assert.equal(result.session.feature_bundle_review_id, state.bundle.review.id);
});

test("unapproved stale or ownerless bundle never starts", async () => {
  let calls = 0;
  const client = createWorkflowClient({
    identity,
    request: async () => {
      calls++;
    },
  });
  for (const change of [
    (s) => {
      s.bundle.current = false;
    },
    (s) => {
      s.bundle.review.decision = "changes_requested";
    },
    (s) => {
      s.owner_id = null;
    },
    (s) => {
      s.bundle.entries.pop();
    },
  ]) {
    const { state, execution } = fixture();
    change(state);
    await assert.rejects(client.start(state, execution), /human-approved/);
  }
  assert.equal(calls, 0);
});

test("409 is surfaced without automatic retry or rebasing", async () => {
  const { state } = fixture();
  let calls = 0;
  const client = createWorkflowClient({
    identity,
    request: async () => {
      calls++;
      return { status: 409, body: { error: { code: "stale", message: "Reconcile" } } };
    },
  });
  await assert.rejects(
    client.update(state, { status: "in-progress" }),
    (error) => error.status === 409 && error.code === "stale"
  );
  assert.equal(calls, 1);
});

test("foreign approval response cannot create a valid execution receipt", async () => {
  const { state, execution, session } = fixture();
  const client = createWorkflowClient({
    identity,
    request: async () => ({
      status: 200,
      body: { workflow: state, session: { ...session, feature_bundle_review_id: 100 } },
    }),
  });
  await assert.rejects(client.start(state, execution), /lineage/);
});

test("report sends both preconditions and retains immutable approval identity", async () => {
  const { state, session } = fixture();
  state.status = "in-progress";
  const calls = [];
  const client = createWorkflowClient({
    identity,
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        body: {
          workflow: { ...state, revision: 8 },
          session: { ...session, state: "verified", revision: 2 },
        },
      };
    },
  });
  await client.report(state, session, {
    state: "verified",
    result_commit: "e".repeat(40),
    verification: "tests passed",
  });
  assert.equal(calls[0].body.if_revision, 7);
  assert.equal(calls[0].body.if_session_revision, 1);
  assert.equal(calls[0].path, "/api/v1/records/bkl_ABC/development_sessions/10?project=cleanlog");
});
