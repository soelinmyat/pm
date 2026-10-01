"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { plan, validate, verify } = require("../scripts/kb-migration-plan.js");
const { reconcile } = require("../scripts/kb-migration-reconcile.js");

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

test("root-relative KB links, source aliases, routes and dynamic references are distinct", (t) => {
  const f = fixture(t);
  f.write("pm/evidence/a.md", "Source");
  f.write(
    "pm/backlog/a.md",
    "[KB](pm/evidence/a.md) [Alias](/original/kb/pm/evidence/a.md) [Route](/proposals/a) [Dynamic](${image}) [Code](apps/api/a.rb)"
  );
  const refs = plan(f.root, ["/original/kb"]).files.find(
    (x) => x.path === "pm/backlog/a.md"
  ).references;
  assert.deepEqual(
    refs.map((x) => x.state),
    [
      "resolved",
      "resolved-source-alias",
      "application-route",
      "dynamic-reference",
      "code-repository-reference",
    ]
  );
});

test("ancestor symlinks and malformed entries fail closed", (t) => {
  const f = fixture(t);
  f.write("pm/a.md", "A");
  const link = path.join(f.root, "alias");
  fs.symlinkSync(f.root, link);
  assert.throws(() => plan(path.join(link, "pm")), /symlink/);
  for (const entry of [null, {}, { path: "pm/a", sha256: "0".repeat(64) }])
    assert.equal(validate({ files: [entry], excluded: [] }).inventory_valid, false);
  assert.equal(validate({ files: [], excluded: [null] }).inventory_valid, false);
});

test("Markdown approval provenance and sensitive reference redaction survive inventory", (t) => {
  const f = fixture(t);
  f.write(
    "pm/a.md",
    "---\ntype: backlog\napproved_by: reviewer\napproved_at: 2026-09-01\n---\n[Secret](https://example.com/?token=synthetic-credential)"
  );
  const result = plan(f.root);
  assert.equal(result.files[0].approval.provenance, "historical-frontmatter-only");
  assert.equal(result.files[0].approval.verification, "not-verified");
  assert.ok(!JSON.stringify(result).includes("synthetic-credential"));
});

test("reconciliation deduplicates identical bytes and never chooses newer-looking worktree variants", (t) => {
  const a = fixture(t);
  const b = fixture(t);
  a.write("pm/a.md", "canonical");
  b.write("pm/a.md", "other version");
  a.write("pm/same.md", "same");
  b.write("pm/same.md", "same");
  b.write("pm/unique.md", "retain archive");
  const canonical = plan(a.root);
  const other = plan(b.root);
  const result = reconcile([other, canonical], a.root);
  assert.equal(result.logical_files, 3);
  assert.equal(result.unique_versions, 4);
  assert.equal(result.conflicts, 1);
  assert.equal(result.archive_only, 1);
  assert.equal(
    result.files.find((x) => x.logical_path === "pm/a.md").canonical_sha256,
    canonical.files.find((x) => x.path === "pm/a.md").sha256
  );
  assert.equal(result.files.find((x) => x.logical_path === "pm/unique.md").canonical_sha256, null);
  assert.throws(() => reconcile([canonical], "/unknown"), /Canonical source/);
  assert.throws(() => reconcile([canonical, canonical], a.root), /Duplicate source/);
});

test("reference manifests redact query credentials, encoded keys and inline payloads", (t) => {
  const f = fixture(t);
  f.write(
    "pm/a.html",
    '<a href="https://example.com/?access_token=synthetic-secret">a</a><a href="https://example.com/?%74oken=encoded-secret">b</a><img src="data:text/plain,synthetic-private-body"><img src="//user:protocol-secret@example.com/a"><img src=" data:text/plain,whitespace-secret">'
  );
  const output = JSON.stringify(plan(f.root));
  for (const value of [
    "synthetic-secret",
    "encoded-secret",
    "synthetic-private-body",
    "protocol-secret",
    "whitespace-secret",
  ])
    assert.ok(!output.includes(value));
});

test("directory navigation and annotated citations resolve without changing original target", (t) => {
  const f = fixture(t);
  f.write("pm/evidence/a.md", "Evidence");
  f.write(
    "pm/a.md",
    "---\ntype: insight\nsources: [pm/evidence/a.md (imported yesterday)]\n---\n[Folder](evidence/)"
  );
  const refs = plan(f.root).files.find((file) => file.path === "pm/a.md").references;
  assert.equal(refs[0].state, "resolved-directory");
  assert.equal(refs[1].state, "resolved");
  assert.ok(refs[1].target.includes("imported yesterday"));
});

test("HTML code examples are not CSS asset dependencies", (t) => {
  const f = fixture(t);
  f.write(
    "pm/a.html",
    '<code>url(sha256(code_verifier))</code><img src="image.svg"><style>body {background:url(image.svg)}</style>'
  );
  f.write("pm/image.svg", "<svg></svg>");
  const refs = plan(f.root).files.find((file) => file.path === "pm/a.html").references;
  assert.equal(refs.length, 2);
  assert.ok(refs.every((ref) => ref.state === "resolved"));
});

test("representative proposal/RFC fixture keeps approval bytes and relative assets intact", (t) => {
  const f = fixture(t);
  f.write(
    "pm/backlog/proposals/trial.html",
    '<a href="../rfcs/trial.html">RFC</a><link href="assets/style.css">'
  );
  f.write("pm/backlog/proposals/assets/style.css", "body{}");
  f.write("pm/backlog/rfcs/trial.html", '<img src="assets/wireframe.svg">');
  f.write("pm/backlog/rfcs/assets/wireframe.svg", "<svg></svg>");
  f.write("pm/backlog/rfcs/trial.json", '{"schema_version":1}');
  const before = plan(f.root);
  const digest = (name) => `sha256:${before.files.find((x) => x.path === name).sha256}`;
  f.write(
    "pm/backlog/rfcs/trial.approval.json",
    JSON.stringify({
      status: "approved",
      approved_by: "fixture-reviewer",
      html_sha256: digest("pm/backlog/rfcs/trial.html"),
      sidecar_sha256: digest("pm/backlog/rfcs/trial.json"),
    })
  );
  const complete = plan(f.root);
  assert.ok(complete.files.flatMap((x) => x.references).every((r) => r.state === "resolved"));
  assert.ok(
    Object.values(complete.files.find((x) => x.approval).approval.hash_matches).every(Boolean)
  );
  assert.equal(verify(complete).verified, true);
  assert.equal(complete.production_ready, false);
});
