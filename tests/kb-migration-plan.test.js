"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { plan, validate, verify } = require("../scripts/kb-migration-plan.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    write(relative, data) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    },
  };
}

test("inventory includes context, artifacts, runtime, unknown files and exact statuses", (t) => {
  const f = fixture(t);
  f.write("pm/backlog/task.md", "---\ntype: backlog\nid: CL-5\nstatus: shipping\n---\nBody");
  f.write("pm/strategy.md", "Strategy");
  f.write("pm/backlog/rfcs/task.html", "<h1>RFC</h1>");
  f.write("pm/backlog/rfcs/task.json", "{}");
  f.write(".pm/dev-sessions/task/session.json", "{}");
  f.write("pm/unknown.bin", Buffer.from([0, 255, 9]));
  const result = plan(f.root);
  assert.equal(result.files.length, 6);
  assert.equal(result.files.find((x) => x.source_id === "CL-5").source_status, "shipping");
  assert.deepEqual(result.unmapped, ["pm/unknown.bin"]);
  assert.equal(result.production_ready, false);
  assert.equal(result.validation.cutover_allowed, false);
  assert.equal(verify(result).verified, true);
});

test("references distinguish missing, local absolute, external and linked bundle assets", (t) => {
  const f = fixture(t);
  f.write(
    "pm/backlog/task.md",
    "---\ntype: backlog\nresearch_refs: [evidence/source.md]\n---\n[Missing](missing.md) [Web](https://example.com) [Local](/tmp/private.md)"
  );
  f.write("pm/evidence/source.md", "Source");
  f.write("pm/backlog/task.html", '<img src="assets/a.png"><link href="assets/style.css">');
  f.write("pm/backlog/assets/a.png", Buffer.from([1, 2, 3]));
  f.write("pm/backlog/assets/style.css", "body{}");
  const result = plan(f.root);
  const record = result.files.find((x) => x.path.endsWith("task.md"));
  assert.equal(record.references.find((x) => x.basis === "frontmatter").state, "resolved");
  assert.deepEqual(
    record.references.slice(0, 3).map((x) => x.state),
    ["missing", "external-or-inline", "absolute-local"]
  );
  assert.ok(
    result.files
      .find((x) => x.path.endsWith("task.html"))
      .references.every((x) => x.state === "resolved")
  );
});

test("historical approvals preserve provenance and do not become new approvals", (t) => {
  const f = fixture(t);
  f.write("pm/backlog/rfcs/a.html", "Exact approved content");
  const digest = plan(f.root).files[0].sha256;
  f.write(
    "pm/backlog/rfcs/a.approval.json",
    JSON.stringify({
      status: "approved",
      approved_by: "reviewer",
      approved_at: "2026-09-01",
      html_sha256: `sha256:${digest}`,
      sidecar_sha256: `sha256:${"0".repeat(64)}`,
    })
  );
  const approval = plan(f.root).files.find((x) => x.approval).approval;
  assert.equal(approval.provenance, "historical-only");
  assert.equal(approval.verification, "not-verified");
  assert.equal(approval.hash_matches.html_sha256, true);
  assert.equal(approval.hash_matches.sidecar_sha256, false);
});

test("planner never follows symlinks or includes known credential files/values", (t) => {
  const f = fixture(t);
  f.write("pm/good.md", "Safe content");
  f.write(".pm/credentials", "do not read");
  f.write("pm/private.md", "-----BEGIN PRIVATE KEY-----\nsynthetic fixture");
  fs.symlinkSync(path.join(f.root, "pm"), path.join(f.root, "pm", "loop"));
  fs.symlinkSync("missing-target", path.join(f.root, "pm", "broken"));
  const result = plan(f.root);
  assert.equal(result.files.length, 1);
  assert.equal(result.excluded.length, 4);
  assert.ok(!JSON.stringify(result).includes("synthetic fixture"));
});

test("verification detects changed, new and missing files without mutating the source", (t) => {
  const f = fixture(t);
  f.write("pm/a.md", "A");
  f.write("pm/b.md", "B");
  const original = plan(f.root);
  f.write("pm/a.md", "changed");
  fs.unlinkSync(path.join(f.root, "pm/b.md"));
  f.write("pm/new.md", "new");
  const result = verify(original);
  assert.equal(result.verified, false);
  assert.deepEqual(result.failures.map((x) => x.reason).sort(), [
    "hash-mismatch",
    "missing-or-symlink",
    "new-file",
  ]);
  assert.equal(fs.readFileSync(path.join(f.root, "pm/a.md"), "utf8"), "changed");
});

test("verification rejects traversal paths and parent symlinks", (t) => {
  const f = fixture(t);
  f.write("pm/a.md", "A");
  const manifest = plan(f.root);
  manifest.files[0].path = "pm/../../escape";
  assert.equal(validate(manifest).inventory_valid, false);
  assert.equal(verify(manifest).verified, false);
  const safe = plan(f.root);
  fs.renameSync(path.join(f.root, "pm"), path.join(f.root, "other"));
  fs.symlinkSync(path.join(f.root, "other"), path.join(f.root, "pm"));
  assert.equal(verify(safe).verified, false);
});

test("identical inventories are deterministic and retain duplicate identities as conflicts", (t) => {
  const f = fixture(t);
  for (const name of ["a", "b"])
    f.write(`pm/${name}.md`, "---\ntype: backlog\nid: CL-1\n---\nbody");
  assert.deepEqual(plan(f.root), plan(f.root));
  assert.ok(plan(f.root).validation.warnings.some((x) => x.code === "duplicate-source-id"));
});

test("changed excluded inventory and unsupported schemas fail verification", (t) => {
  const f = fixture(t);
  f.write("pm/a.md", "A");
  const manifest = plan(f.root);
  f.write(".pm/credentials", "synthetic private fixture");
  assert.equal(verify(manifest).verified, false);
  assert.equal(verify(manifest).failures[0].reason, "new-exclusion");
  assert.equal(validate({ ...manifest, schema_version: 999 }).inventory_valid, false);
  assert.equal(validate({}).inventory_valid, false);
});
