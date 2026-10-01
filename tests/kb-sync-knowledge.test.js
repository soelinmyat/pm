"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { plan } = require("../scripts/kb-migration-plan.js");
const { push, exportHistory } = require("../scripts/kb-sync-knowledge.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, bytes) => {
    const output = path.join(root, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  };
  write(
    "pm/backlog/a.md",
    "---\ntype: backlog\nid: CL-1\nstatus: awaiting_approval\n---\n[RFC](a.html)\r\n"
  );
  write("pm/backlog/a.html", '<img src="asset.png">');
  write("pm/backlog/asset.png", Buffer.from([0, 255, 1]));
  write(".pm/lease.json", '{"owner":"local"}');
  write("pm/backlog/a.approval.json", '{"approved_by":"Cherry","approved":true}');
  const records = new Map();
  const transport = {
    records,
    identity: { service: "https://productmemory.io", project: "cleanlog" },
    async get(name, revision) {
      const rows = records.get(name);
      return rows ? structuredClone(revision ? rows[revision - 1] : rows.at(-1)) : null;
    },
    async put(input) {
      const rows = records.get(input.path) || [];
      if (input.if_revision !== rows.length)
        throw Object.assign(new Error("stale"), { status: 409 });
      const data = {
        ...input,
        revision: rows.length + 1,
        byte_size: Buffer.from(input.content_base64, "base64").length,
      };
      rows.push(data);
      records.set(input.path, rows);
      return structuredClone(data);
    },
    async list() {
      return {
        files: [...records.values()].map((rows) => ({ ...rows.at(-1), content_base64: undefined })),
        next_cursor: null,
      };
    },
  };
  return { root, write, transport };
}

test("push/export preserve status, binary, references and historical approval without runtime or authority", async (t) => {
  const f = fixture(t),
    manifest = plan(f.root);
  const first = await push({ manifest, transport: f.transport });
  assert.equal(first.uploaded.length, 4);
  assert.deepEqual(first.local_only, [".pm/lease.json"]);
  const second = await push({ manifest, transport: f.transport, cache: first.cache });
  assert.equal(second.uploaded.length, 0);
  assert.equal(second.unchanged.length, 4);
  f.write("pm/backlog/a.md", "---\ntype: backlog\nid: CL-1\nstatus: shipping\n---\nchanged");
  const changed = await push({
    manifest: plan(f.root),
    transport: f.transport,
    cache: first.cache,
  });
  assert.deepEqual(changed.uploaded, ["pm/backlog/a.md"]);
  const exported = await exportHistory(f.transport);
  assert.equal(exported.execution_authority, false);
  const backlog = exported.files.find((file) => file.path === "pm/backlog/a.md");
  assert.equal(backlog.revisions.length, 2);
  assert.equal(backlog.revisions[0].source_metadata.source_file.source_status, "awaiting_approval");
  assert.equal(backlog.revisions[1].source_metadata.source_file.source_status, "shipping");
  assert(Buffer.from(backlog.revisions[0].content_base64, "base64").toString().endsWith("\r\n"));
  assert.deepEqual(
    Buffer.from(
      exported.files.find((file) => file.path.endsWith("asset.png")).revisions[0].content_base64,
      "base64"
    ),
    Buffer.from([0, 255, 1])
  );
  assert.equal(
    exported.files.find((file) => file.path.endsWith("approval.json")).revisions[0].source_metadata
      .authority,
    "historical-source-only"
  );
});

test("unbound remote edits and conditional race never overwrite or advance cache", async (t) => {
  const f = fixture(t),
    manifest = plan(f.root);
  const first = await push({ manifest, transport: f.transport });
  f.write("pm/backlog/a.md", "changed");
  const unbound = await push({ manifest: plan(f.root), transport: f.transport });
  assert.equal(unbound.conflicts[0].reason, "remote_changed_or_unbound");
  assert.equal(f.transport.records.get("pm/backlog/a.md").length, 1);
  f.transport.put = async () => {
    throw Object.assign(new Error("race"), { status: 409 });
  };
  const raced = await push({ manifest: plan(f.root), transport: f.transport, cache: first.cache });
  assert.equal(raced.conflicts[0].reason, "conditional_write_failed");
  assert.deepEqual(raced.cache.files["pm/backlog/a.md"], first.cache.files["pm/backlog/a.md"]);
});

test("corrupt export and source drift fail instead of reporting migration success", async (t) => {
  const f = fixture(t),
    manifest = plan(f.root);
  await push({ manifest, transport: f.transport });
  f.transport.records.get("pm/backlog/a.md")[0].content_base64 = "corrupt";
  await assert.rejects(exportHistory(f.transport), /byte\/hash/);
  f.write("pm/backlog/a.md", "drift");
  await assert.rejects(push({ manifest, transport: f.transport }), /Source drift/);
});

test("cache cannot cross project or service boundaries", async (t) => {
  const f = fixture(t),
    manifest = plan(f.root);
  const first = await push({ manifest, transport: f.transport });
  f.transport.identity.project = "other";
  await assert.rejects(
    push({ manifest, transport: f.transport, cache: first.cache }),
    /binding mismatch/
  );
  f.transport.identity = { service: "https://other.example", project: "cleanlog" };
  await assert.rejects(
    push({ manifest, transport: f.transport, cache: first.cache }),
    /binding mismatch/
  );
});

test("exports reject new remote versions and newly added earlier paths", async (t) => {
  const f = fixture(t);
  await push({ manifest: plan(f.root), transport: f.transport });
  const original = f.transport.get;
  let changed = false;
  f.transport.get = async (...args) => {
    const data = await original(...args);
    if (!changed) {
      changed = true;
      const rows = f.transport.records.get("pm/backlog/a.md");
      rows.push({ ...rows[0], revision: 2 });
    }
    return data;
  };
  await assert.rejects(exportHistory(f.transport), /Inventory changed/);
  changed = false;
  f.transport.get = async (...args) => {
    const data = await original(...args);
    if (!changed) {
      changed = true;
      f.transport.records.set("pm/aaa.md", [{ ...data, path: "pm/aaa.md", revision: 1 }]);
    }
    return data;
  };
  await assert.rejects(exportHistory(f.transport), /Inventory changed/);
});
