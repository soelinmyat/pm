"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cli = path.resolve(__dirname, "../scripts/evidence.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-evidence-v2-"));
  const pmDir = path.join(root, "pm");
  const privateDir = path.join(root, ".pm");
  fs.mkdirSync(privateDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, pmDir, privateDir };
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function request(overrides = {}) {
  return {
    source_type: "web",
    source_label: "example.com/pricing",
    source_format: "html",
    locator: "pricing-table",
    captured_at: "2026-07-14T00:00:00.000Z",
    content: "Starter costs $20.",
    privacy: { classification: "public", pii_review: "not-required" },
    transformation: { stage: "captured", parents: [], method: "pm:research" },
    artifact_path: "evidence/research/pricing.md",
    ...overrides,
  };
}

test("CLI register, validate, and audit publish a portable atomic ledger", (t) => {
  const fixtureValue = fixture(t);
  const requestPath = path.join(fixtureValue.privateDir, "register.json");
  write(requestPath, request());
  const registered = run(
    [
      "register",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      requestPath,
      "--json",
    ],
    fixtureValue.root
  );
  assert.equal(registered.status, 0, registered.stderr);
  const payload = JSON.parse(registered.stdout);
  assert.equal(payload.decision, "created");
  assert.match(payload.evidence_id, /^ev_/);

  const ledgerPath = path.join(fixtureValue.pmDir, "evidence", "provenance.json");
  const ledgerText = fs.readFileSync(ledgerPath, "utf8");
  assert.doesNotMatch(
    ledgerText,
    new RegExp(fixtureValue.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
  assert.equal(
    run(["validate", "--pm-dir", fixtureValue.pmDir, "--json"], fixtureValue.root).status,
    0
  );
  assert.equal(
    run(
      ["audit", "--pm-dir", fixtureValue.pmDir, "--now", "2026-07-15T00:00:00.000Z", "--json"],
      fixtureValue.root
    ).status,
    0
  );
  const privateRecord = path.join(
    fixtureValue.privateDir,
    "evidence",
    "records",
    `${payload.evidence_id}.json`
  );
  assert.ok(fs.existsSync(privateRecord));
  assert.equal(fs.statSync(privateRecord).mode & 0o777, 0o600);
});

test("CLI migrates one legacy ingest record without rewriting the legacy manifest", (t) => {
  const fixtureValue = fixture(t);
  const legacyPath = path.join(fixtureValue.privateDir, "legacy-record.json");
  write(legacyPath, {
    id: "source-0001",
    source_path: "/Users/alice/Downloads/support.csv",
    source_type: "support",
    source_format: "csv",
    imported_at: "2026-07-14T00:00:00Z",
    topic: "bulk editing",
    pain_point: "editing rows is slow",
    summary: "Customer wants batch edits.",
    raw_ref: { file: "/Users/alice/Downloads/support.csv", row: 14 },
  });
  const migrated = run(
    [
      "migrate",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      legacyPath,
      "--json",
    ],
    fixtureValue.root
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const payload = JSON.parse(migrated.stdout);
  const ledger = fs.readFileSync(
    path.join(fixtureValue.pmDir, "evidence", "provenance.json"),
    "utf8"
  );
  assert.doesNotMatch(ledger, /\/Users\/alice/);
  assert.match(
    fs.readFileSync(
      path.join(fixtureValue.privateDir, "evidence", "records", `${payload.evidence_id}.json`),
      "utf8"
    ),
    /\/Users\/alice/
  );
});

test("CLI refresh preserves a conflicting proposal privately", (t) => {
  const fixtureValue = fixture(t);
  const requestPath = path.join(fixtureValue.privateDir, "register.json");
  write(requestPath, request());
  const first = run(
    [
      "register",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      requestPath,
      "--json",
    ],
    fixtureValue.root
  );
  const evidenceId = JSON.parse(first.stdout).evidence_id;
  const refreshPath = path.join(fixtureValue.privateDir, "refresh.json");
  write(refreshPath, {
    evidence_id: evidenceId,
    observed_content_sha256: `sha256:${"f".repeat(64)}`,
    content: "Starter now costs $25.",
    captured_at: "2026-07-15T00:00:00.000Z",
  });
  const conflict = run(
    [
      "refresh",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      refreshPath,
      "--json",
    ],
    fixtureValue.root
  );
  assert.equal(conflict.status, 3);
  const payload = JSON.parse(conflict.stdout);
  assert.equal(payload.code, "EVIDENCE_CONFLICT");
  assert.ok(fs.existsSync(path.join(fixtureValue.privateDir, payload.conflict_artifact)));
  assert.match(
    fs.readFileSync(path.join(fixtureValue.privateDir, payload.conflict_artifact), "utf8"),
    /Starter now costs \$25/
  );
});

test("CLI refresh fails closed when the artifact changed after audit", (t) => {
  const fixtureValue = fixture(t);
  const artifactPath = path.join(fixtureValue.pmDir, "evidence", "research", "pricing.md");
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, "# Pricing\n\nOriginal\n");
  const requestPath = path.join(fixtureValue.privateDir, "register.json");
  write(requestPath, request());
  const first = run(
    [
      "register",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      requestPath,
      "--json",
    ],
    fixtureValue.root
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(fixtureValue.pmDir, "evidence", "provenance.json"), "utf8")
  );
  const refreshPath = path.join(fixtureValue.privateDir, "artifact-refresh.json");
  write(refreshPath, {
    evidence_id: JSON.parse(first.stdout).evidence_id,
    observed_content_sha256: ledger.records[0].content_sha256,
    observed_artifact_sha256: `sha256:${"0".repeat(64)}`,
    content: "Starter now costs $25.",
    captured_at: "2026-07-15T00:00:00.000Z",
    proposed_artifact_content: "# Pricing\n\nStarter now costs $25.\n",
  });
  const conflict = run(
    [
      "refresh",
      "--pm-dir",
      fixtureValue.pmDir,
      "--private-dir",
      fixtureValue.privateDir,
      "--request",
      refreshPath,
      "--artifact",
      artifactPath,
      "--json",
    ],
    fixtureValue.root
  );
  assert.equal(conflict.status, 3, conflict.stderr);
  assert.match(JSON.parse(conflict.stdout).reason, /artifact hash/i);
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "# Pricing\n\nOriginal\n");
});

test("CLI artifact reads are bounded to regular files inside pm/evidence", (t) => {
  const fixtureValue = fixture(t);
  write(path.join(fixtureValue.pmDir, "evidence", "provenance.json"), {
    schema_version: 2,
    updated_at: "2026-07-14T00:00:00.000Z",
    records: [],
  });
  const outside = path.join(fixtureValue.root, "outside.md");
  fs.writeFileSync(outside, "# Outside\n");
  const escaped = run(
    ["validate", "--pm-dir", fixtureValue.pmDir, "--artifact", outside, "--json"],
    fixtureValue.root
  );
  assert.equal(escaped.status, 2);
  assert.match(escaped.stderr, /inside the PM evidence directory/i);

  const requestPath = path.join(fixtureValue.privateDir, "register.json");
  write(requestPath, request());
  assert.equal(
    run(
      [
        "register",
        "--pm-dir",
        fixtureValue.pmDir,
        "--private-dir",
        fixtureValue.privateDir,
        "--request",
        requestPath,
        "--json",
      ],
      fixtureValue.root
    ).status,
    0
  );
  const artifactDir = path.join(fixtureValue.pmDir, "evidence", "research");
  fs.mkdirSync(artifactDir, { recursive: true });
  const linked = path.join(artifactDir, "linked.md");
  fs.symlinkSync(outside, linked);
  const symlinked = run(
    ["validate", "--pm-dir", fixtureValue.pmDir, "--artifact", linked, "--json"],
    fixtureValue.root
  );
  assert.equal(symlinked.status, 2);
  assert.match(symlinked.stderr, /regular file/i);
});
