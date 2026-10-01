"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createNativeAuthoring } = require("../scripts/productmemory-native-authoring");
const { fixture } = require("./helpers/productmemory-native-fixture");
function authorFixture(t) {
  const f = fixture(t),
    calls = [],
    files = new Map();
  f.workflow.status = "grooming";
  f.workflow.bundle.entries = f.workflow.bundle.entries.filter(
    (entry) => entry.role === "proposal"
  );
  f.workflow.sessions = [];
  const entries = [...f.documents].map(([document, bytes]) => {
    const destination = path.join(f.root, `.pm/authoring/${f.options.slug}/draft`, document);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return {
      path: document,
      role:
        document === "pm/proposal.json"
          ? "proposal"
          : document === "pm/rfc.json"
            ? "rfc"
            : "supporting",
      category: "document-sidecar",
      source_metadata: { original_status: "grooming", lineage: "retained" },
    };
  });
  const proposal = entries.find((entry) => entry.role === "proposal");
  const proposalBytes = f.documents.get(proposal.path);
  files.set(proposal.path, {
    ...proposal,
    revision: 1,
    content_hash: require("../scripts/lib/native-dev-contract").sha(proposalBytes),
    byte_size: proposalBytes.length,
    content_base64: proposalBytes.toString("base64"),
  });
  let disconnect = null;
  const transport = {
    identity: f.transport.identity,
    async request(request) {
      calls.push(request);
      const url = new URL(request.path, transport.identity.service_url);
      if (url.pathname === "/api/v1/knowledge_file") {
        if (request.method === "GET") {
          const file = files.get(url.searchParams.get("path"));
          return file
            ? { status: 200, body: structuredClone(file) }
            : { status: 404, body: { error: { code: "not_found" } } };
        }
        const input = request.body,
          current = files.get(input.path);
        if ((current?.revision || 0) !== input.if_revision)
          return { status: 409, body: { error: { code: "stale" } } };
        const file = {
          ...input,
          revision: input.if_revision + 1,
          byte_size: Buffer.from(input.content_base64, "base64").length,
        };
        delete file.if_revision;
        files.set(input.path, file);
        if (disconnect === "file") {
          disconnect = null;
          throw new Error("connection lost after file acknowledgement");
        }
        return { status: 200, body: structuredClone(file) };
      }
      if (request.method === "POST") {
        assert.equal(request.body.if_revision, f.workflow.revision);
        f.workflow.revision++;
        f.workflow.bundle = {
          id: 8,
          current: true,
          digest: "c".repeat(64),
          review: null,
          entries: request.body.entries.map((entry, index) => ({
            ...entry,
            knowledge_version_id: index + 1,
          })),
        };
        if (disconnect === "bundle") {
          disconnect = null;
          throw new Error("connection lost after bundle acknowledgement");
        }
      }
      return { status: 200, body: structuredClone(f.workflow) };
    },
  };
  const options = {
    sourceDir: f.root,
    slug: f.options.slug,
    input: {
      stage: "rfc",
      record_id: f.options.recordId,
      execution_path: "pm/execution.json",
      entries,
    },
  };
  return {
    f,
    calls,
    files,
    options,
    runtime: createNativeAuthoring(transport),
    disconnect(kind) {
      disconnect = kind;
    },
  };
}
test("remote-first authoring validates complete contracts, preserves metadata and publishes an unapproved pinned bundle", async (t) => {
  const f = authorFixture(t);
  const existing = f.options.input.entries.find((entry) => entry.role === "rfc"),
    bytes = f.f.documents.get(existing.path);
  f.files.set(existing.path, {
    path: existing.path,
    revision: 9,
    content_hash: "0".repeat(64),
    content_base64: bytes.toString("base64"),
    category: "context-document",
    source_metadata: { original_status: "awaiting_approval", history: { original: true } },
  });
  const planned = await f.runtime.plan(f.options);
  assert.equal(
    f.calls.some((call) => call.method !== "GET"),
    false
  );
  assert.equal(planned.entries.find((entry) => entry.role === "rfc").if_revision, 9);
  assert.deepEqual(planned.entries.find((entry) => entry.role === "rfc").source_metadata, {
    original_status: "awaiting_approval",
    history: { original: true },
  });
  const result = await f.runtime.publish(f.options);
  assert.equal(result.state, "complete");
  assert.equal(f.f.workflow.bundle.review, null);
  assert.equal(f.f.workflow.bundle.entries[0].knowledge_version_id > 0, true);
  assert.equal(f.f.workflow.status, "grooming");
  assert.equal(fs.existsSync(path.join(f.f.root, "pm")), false);
  assert.equal(f.files.get(existing.path).revision, 10);
  const writes = f.calls.filter((call) => call.method !== "GET").length;
  await f.runtime.publish(f.options);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, writes);
});
test("unknown file write recovers exact acknowledgement without replay", async (t) => {
  const f = authorFixture(t);
  await f.runtime.plan(f.options);
  f.disconnect("file");
  await assert.rejects(f.runtime.publish(f.options), /connection lost/);
  await assert.rejects(f.runtime.publish(f.options), /Uncertain publication/);
  assert.equal(f.calls.filter((call) => call.method === "PUT").length, 1);
  await f.runtime.recover(f.options);
  await f.runtime.publish(f.options);
  assert.equal(
    f.calls.filter((call) => call.method === "PUT").length,
    f.options.input.entries.length - 1
  );
});
test("unknown bundle write recovers exact unapproved bundle without republishing", async (t) => {
  const f = authorFixture(t);
  await f.runtime.plan(f.options);
  f.disconnect("bundle");
  await assert.rejects(f.runtime.publish(f.options), /connection lost/);
  const result = await f.runtime.recover(f.options);
  assert.equal(result.state, "complete");
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});
test("changed acknowledged bytes refuse recovery and keep the uncertain write", async (t) => {
  const f = authorFixture(t);
  await f.runtime.plan(f.options);
  f.disconnect("file");
  await assert.rejects(f.runtime.publish(f.options));
  f.files.get(f.calls.find((call) => call.method === "PUT").body.path).content_hash = "0".repeat(
    64
  );
  await assert.rejects(f.runtime.recover(f.options), /No exact publication acknowledgement/);
  await assert.rejects(f.runtime.publish(f.options), /Uncertain publication/);
  assert.equal(f.calls.filter((call) => call.method === "PUT").length, 1);
});
test("stale remote workflow and changed local contract fail before any dispatch", async (t) => {
  for (const change of ["workflow", "draft"]) {
    const f = authorFixture(t);
    await f.runtime.plan(f.options);
    if (change === "workflow") f.f.workflow.revision++;
    else
      fs.writeFileSync(
        path.join(f.f.root, `.pm/authoring/${f.options.slug}/draft/pm/rfc.json`),
        "{}"
      );
    await assert.rejects(f.runtime.publish(f.options), /changed/);
    assert.equal(
      f.calls.some((call) => call.method !== "GET"),
      false
    );
  }
});
test("incomplete or private product inputs cannot create remote writes or publication intent", async (t) => {
  for (const change of ["contract", "private", "execution"]) {
    const f = authorFixture(t);
    if (change === "contract")
      f.options.input.entries = f.options.input.entries.filter((entry) => entry.role !== "rfc");
    if (change === "private") f.options.input.entries[0].path = ".pm/session.json";
    if (change === "execution") f.options.input.execution_path = "pm/missing.json";
    await assert.rejects(f.runtime.plan(f.options));
    assert.equal(f.calls.length, 0);
    assert.equal(
      fs.existsSync(path.join(f.f.root, `.pm/authoring/${f.options.slug}/publication.json`)),
      false
    );
  }
});

test("Groom publishes a complete product proposal without fabricating an RFC or human review", async (t) => {
  const f = authorFixture(t);
  f.options.input.stage = "groom";
  delete f.options.input.execution_path;
  f.options.input.entries = f.options.input.entries.filter(
    (entry) => entry.role !== "rfc" && entry.path !== "pm/execution.json"
  );
  f.f.workflow.bundle = null;
  const plan = await f.runtime.plan(f.options);
  assert.equal(plan.execution_path, null);
  const result = await f.runtime.publish(f.options);
  assert.equal(result.state, "complete");
  assert.equal(
    f.f.workflow.bundle.entries.some((entry) => entry.role === "rfc"),
    false
  );
  assert.equal(f.f.workflow.bundle.review, null);
});
test("RFC refuses unapproved or changed product scope before publication intent", async (t) => {
  for (const change of ["withdrawn", "changed"]) {
    const f = authorFixture(t);
    if (change === "withdrawn") f.f.workflow.bundle.review = null;
    else f.f.workflow.bundle.entries[0].content_hash = "0".repeat(64);
    await assert.rejects(f.runtime.plan(f.options), /human-approved product proposal/);
    assert.equal(
      f.calls.some((call) => call.method !== "GET"),
      false
    );
  }
});
test("remote immutable seed stays in a private draft and retains full source metadata", async (t) => {
  const f = authorFixture(t);
  fs.rmSync(path.join(f.f.root, `.pm/authoring/${f.options.slug}/draft`), { recursive: true });
  const result = await f.runtime.fetch({
    sourceDir: f.f.root,
    slug: f.options.slug,
    recordId: f.options.input.record_id,
  });
  assert.equal(result.input.stage, "groom");
  assert.equal(fs.existsSync(path.join(f.f.root, "pm")), false);
  const proposal = result.input.entries[0];
  assert.deepEqual(proposal.source_metadata, f.files.get(proposal.path).source_metadata);
  assert.deepEqual(
    fs.readFileSync(path.join(f.f.root, `.pm/authoring/${f.options.slug}/draft`, proposal.path)),
    f.f.documents.get(proposal.path)
  );
  assert.equal(
    f.calls.some((call) => call.method !== "GET"),
    false
  );
  await assert.rejects(
    f.runtime.fetch({
      sourceDir: f.f.root,
      slug: f.options.slug,
      recordId: f.options.input.record_id,
    }),
    /Existing private draft/
  );
});

test("replacing an execution bundle returns through a fresh product review cycle before any write", async (t) => {
  const f = authorFixture(t);
  f.f.workflow.bundle.entries.push({
    path: "pm/rfc.json",
    role: "rfc",
    revision: 1,
    knowledge_version_id: 42,
    content_hash: require("../scripts/lib/native-dev-contract").sha(
      f.f.documents.get("pm/rfc.json")
    ),
  });
  await assert.rejects(f.runtime.plan(f.options), /approved Groom-only bundle/);
  assert.equal(
    f.calls.some((call) => call.method !== "GET"),
    false
  );
});
