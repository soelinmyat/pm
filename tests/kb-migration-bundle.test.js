"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { plan } = require("../scripts/kb-migration-plan.js");
const { build, check, restore } = require("../scripts/kb-migration-bundle.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    write(relative, bytes) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    },
  };
}

test("build rejects manifest metadata altered without changing source hashes", (t) => {
  const source = fixture(t),
    out = fixture(t);
  source.write(
    "pm/backlog/a.md",
    "---\ntype: backlog\nid: CL-1\nstatus: planned\n---\n[Missing](missing.html)"
  );
  const manifest = plan(source.root);
  manifest.files[0].source_status = "done";
  manifest.files[0].references = [];
  assert.throws(
    () => build("cleanlog", [manifest], source.root, path.join(out.root, "bundle")),
    /Source metadata/
  );
});

test("bundle idempotently preserves exact bytes, all versions and metadata", (t) => {
  const a = fixture(t),
    b = fixture(t),
    out = fixture(t);
  a.write(
    "pm/backlog/a.md",
    "---\ntype: backlog\nid: CL-1\nstatus: shipping\napproved_by: human\napproved_at: 2026-10-01\n---\n[Art](proposals/a.html)"
  );
  a.write("pm/backlog/proposals/a.html", '<img src="assets/a.png">');
  const binary = Buffer.from([0, 255, 1, 88]);
  a.write("pm/backlog/proposals/assets/a.png", binary);
  a.write(".pm/loop/lease.json", '{"owner":"local"}');
  b.write("pm/backlog/a.md", "Old content");
  b.write("pm/archive.md", "Archive only");
  const inputs = [plan(a.root), plan(b.root)];
  const first = build("cleanlog", inputs, a.root, path.join(out.root, "bundle"));
  const second = build("cleanlog", inputs.reverse(), a.root, path.join(out.root, "bundle"));
  assert.equal(second.idempotent, true);
  assert.equal(first.bundle_sha256, second.bundle_sha256);
  const bundle = check(path.join(out.root, "bundle"));
  assert.equal(bundle.verified, true);
  const record = bundle.index.records.find((r) => r.logical_path === "pm/backlog/a.md");
  assert.equal(record.versions.length, 2);
  assert.equal(record.active_handoff_blocked, false);
  assert.equal(
    record.versions.find((v) => v.sha256 === record.canonical_sha256).metadata[0].file
      .source_status,
    "shipping"
  );
  assert.equal(bundle.index.production_upload_allowed, false);
  assert.equal(
    bundle.index.records.find((r) => r.logical_path.startsWith(".pm/")).transfer_scope,
    "local-only"
  );
  const destination = path.join(out.root, "restored");
  const restored = restore(path.join(out.root, "bundle"), destination);
  assert.equal(restored.sources, 2);
  assert.equal(restored.restored_file_instances, 6);
  const sourceId = crypto.createHash("sha256").update(a.root).digest("hex");
  assert.deepEqual(
    fs.readFileSync(
      path.join(destination, "sources", sourceId, "pm/backlog/proposals/assets/a.png")
    ),
    binary
  );
});

test("missing nested artifacts block active handoff, while completed history remains preserved", (t) => {
  const a = fixture(t),
    out = fixture(t);
  for (const [name, status] of [
    ["active", "planned"],
    ["done", "done"],
  ])
    a.write(
      `pm/backlog/${name}.md`,
      `---\ntype: backlog\nstatus: ${status}\n---\n[Proposal](proposals/a.html)`
    );
  a.write("pm/backlog/proposals/a.html", '<img src="missing.png">');
  build("cleanlog", [plan(a.root)], a.root, path.join(out.root, "bundle"));
  const records = check(path.join(out.root, "bundle")).index.records;
  assert.equal(
    records.find((r) => r.logical_path.endsWith("active.md")).active_handoff_blocked,
    true
  );
  assert.equal(
    records.find((r) => r.logical_path.endsWith("done.md")).active_handoff_blocked,
    false
  );
  assert.ok(records.find((r) => r.logical_path.endsWith("done.md")).unresolved_dependencies.length);
});

test("source drift, corruption, symlink destinations and nonempty restore fail closed", (t) => {
  const a = fixture(t),
    out = fixture(t);
  a.write("pm/a.md", "A");
  const before = plan(a.root);
  a.write("pm/a.md", "B");
  assert.throws(() => build("cleanlog", [before], a.root, path.join(out.root, "bundle")), /drift/);
  const manifest = plan(a.root);
  const directory = path.join(out.root, "bundle");
  build("cleanlog", [manifest], a.root, directory);
  assert.throws(() => restore(directory, a.root), /empty/);
  fs.symlinkSync(out.root, path.join(out.root, "alias"));
  assert.throws(
    () => build("cleanlog", [manifest], a.root, path.join(out.root, "alias", "another")),
    /symlink/
  );
  fs.writeFileSync(path.join(directory, "objects", manifest.files[0].sha256), "corrupt");
  assert.equal(check(directory).verified, false);
  assert.throws(() => restore(directory, path.join(out.root, "restore")), /verification/);
});

test("stable record identity survives rename and separate projects use separate namespaces", (t) => {
  const a = fixture(t),
    out = fixture(t);
  a.write("pm/a.md", "---\ntype: backlog\nid: CL-1\n---\nA");
  build("cleanlog", [plan(a.root)], a.root, path.join(out.root, "first"));
  const id = check(path.join(out.root, "first")).index.records[0].stable_id;
  fs.renameSync(path.join(a.root, "pm/a.md"), path.join(a.root, "pm/renamed.md"));
  build("cleanlog", [plan(a.root)], a.root, path.join(out.root, "second"));
  build("other", [plan(a.root)], a.root, path.join(out.root, "third"));
  assert.equal(check(path.join(out.root, "second")).index.records[0].stable_id, id);
  assert.notEqual(check(path.join(out.root, "third")).index.records[0].stable_id, id);
});

test("supplements preserve guidance and symlink metadata and index checks detect tampering", (t) => {
  const a = fixture(t),
    out = fixture(t);
  a.write("pm/a.md", "A");
  out.write("metadata.json", '{"symlinks":[],"mode":384}');
  const data = fs.readFileSync(path.join(out.root, "metadata.json"));
  const sha = crypto.createHash("sha256").update(data).digest("hex");
  const directory = path.join(out.root, "bundle");
  const receipt = build("cleanlog", [plan(a.root)], a.root, directory, [
    { label: "backup-metadata", path: path.join(out.root, "metadata.json"), expected_sha256: sha },
  ]);
  assert.equal(check(directory, receipt.bundle_sha256).verified, true);
  restore(directory, path.join(out.root, "restored"));
  assert.deepEqual(fs.readFileSync(path.join(out.root, "restored/supplements", sha)), data);
  const indexPath = path.join(directory, "bundle.json");
  const changed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  changed.records[0].stable_id = "invented";
  fs.writeFileSync(indexPath, JSON.stringify(changed));
  assert.equal(check(directory, receipt.bundle_sha256).verified, false);
  fs.writeFileSync(
    path.join(directory, "bundle.sha256"),
    crypto.createHash("sha256").update(fs.readFileSync(indexPath)).digest("hex")
  );
  assert.throws(() => check(directory), /Derived metadata/);
});

test("colliding source IDs, system-alias containment and unverified code references fail safely", (t) => {
  const a = fixture(t),
    out = fixture(t);
  for (const name of ["a", "b"]) a.write(`pm/${name}.md`, "---\ntype: backlog\nid: CL-1\n---\nA");
  assert.throws(
    () => build("cleanlog", [plan(a.root)], a.root, path.join(out.root, "collision")),
    /Duplicate stable/
  );
  fs.unlinkSync(path.join(a.root, "pm/b.md"));
  a.write("pm/a.md", "---\ntype: backlog\nid: CL-1\nstatus: planned\n---\n[Code](apps/missing.rb)");
  const canonical = fs.realpathSync(a.root);
  assert.throws(
    () => build("cleanlog", [plan(canonical)], canonical, path.join(a.root, "pm/bundle")),
    /disjoint/
  );
  build("cleanlog", [plan(a.root)], a.root, path.join(out.root, "bundle"));
  assert.equal(check(path.join(out.root, "bundle")).index.records[0].active_handoff_blocked, true);
});
