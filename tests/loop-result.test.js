"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MAX_DOCUMENT_BYTES,
  MAX_RESULT_BYTES,
  createRunResultCapability,
  readStageResult,
  validateStageResult,
  verifyCommittedGateSidecar,
  verifyDocumentArtifact,
  writeStageResult,
  __test,
} = require("../scripts/loop-result.js");

const RUN_ID = "loop-123e4567-e89b-42d3-a456-426614174000";
const CONTEXT = { runId: RUN_ID, cardId: "PM-108", stage: "dev" };

function checkedGateFixture(manifest, options) {
  assert.ok(Array.isArray(manifest.gates));
  assert.equal(options.reviewEvidenceMode, "enforce");
  return { ok: true, issues: [] };
}

function tmpDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-result-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function prArtifact(overrides = {}) {
  return {
    type: "pull-request",
    repo: "openai/pm",
    number: 342,
    url: "https://github.com/openai/pm/pull/342",
    base: "main",
    head: "loop/pm-108",
    head_oid: "a".repeat(40),
    created_at: "2026-07-10T09:30:00Z",
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    version: 1,
    run_id: RUN_ID,
    card_id: "PM-108",
    stage: "dev",
    status: "shipped",
    summary: "PR opened after all gates passed",
    artifacts: prArtifact(),
    gates: ["tdd", "review", "verification"],
    usage: { input_tokens: null, output_tokens: null, total_tokens: null },
    ...overrides,
  };
}

test("result capability creates one exclusive mode-0700 run directory and mode-0600 target", (t) => {
  const root = tmpDir(t);
  const first = createRunResultCapability(root, RUN_ID);

  assert.equal(first.resultFile, path.join(first.runDir, "result.json"));
  assert.equal(fs.lstatSync(first.runDir).mode & 0o777, 0o700);
  assert.equal(fs.lstatSync(first.resultFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(first.resultFile, "utf8"), "");
  assert.throws(() => createRunResultCapability(root, RUN_ID), /already exists|EEXIST/i);
});

test("result capability rejects a symlinked state root", (t) => {
  const root = tmpDir(t);
  const target = path.join(root, "target");
  fs.mkdirSync(target);
  const linked = path.join(root, "linked-state");
  fs.symlinkSync(target, linked);

  assert.throws(() => createRunResultCapability(linked, RUN_ID), /symlink|real directory/i);
  assert.equal(fs.existsSync(path.join(target, "loop-results", RUN_ID)), false);
});

test("atomic writer and no-follow reader accept a bounded matching dev result", (t) => {
  const root = tmpDir(t);
  const capability = createRunResultCapability(root, RUN_ID);

  const written = writeStageResult(capability.resultFile, result(), CONTEXT);
  const read = readStageResult(capability.resultFile, CONTEXT);

  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.result.status, "shipped");
  assert.match(read.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.lstatSync(capability.resultFile).mode & 0o777, 0o600);
});

test("result validation rejects missing, mismatched, overlong, and stage-invalid fields", () => {
  const cases = [
    [result({ run_id: "loop-123e4567-e89b-42d3-a456-426614174099" }), /run_id mismatch/],
    [result({ card_id: "PM-OTHER" }), /card_id mismatch/],
    [result({ stage: "ship" }), /stage mismatch/],
    [result({ status: "merged" }), /status.*not allowed/i],
    [result({ summary: "x".repeat(2001) }), /summary.*bound/i],
    [result({ gates: Array.from({ length: 17 }, (_, i) => `g${i}`) }), /gates.*bound/i],
    [result({ gates: ["x".repeat(65)] }), /gates.*bound/i],
    [result({ unexpected: true }), /unexpected field/],
    [result({ artifacts: prArtifact({ created_at: "July 10, 2027" }) }), /created_at.*ISO/i],
  ];

  for (const [candidate, expected] of cases) {
    const checked = validateStageResult(candidate, CONTEXT);
    assert.equal(checked.ok, false, JSON.stringify(checked));
    assert.equal(checked.status, "failed-contract");
    assert.match(checked.reason, expected);
  }
});

test("stage terminal and discriminated artifact tables reject invalid combinations", () => {
  const cases = [
    [result({ status: "shipped", artifacts: undefined }), CONTEXT, /pull-request artifact/],
    [result({ status: "blocked", blocker: undefined }), CONTEXT, /blocker/],
    [result({ status: "failed", artifacts: prArtifact() }), CONTEXT, /artifacts.*not allowed/i],
    [
      result({
        stage: "ship",
        status: "merged",
        artifacts: prArtifact(),
      }),
      { ...CONTEXT, stage: "ship" },
      /merge_sha|merged_at/,
    ],
    [
      result({
        stage: "ship",
        status: "waiting",
        artifacts: prArtifact(),
        retry_after: "not-an-iso-date",
      }),
      { ...CONTEXT, stage: "ship" },
      /retry_after/,
    ],
    [
      result({
        stage: "rfc",
        status: "artifact-ready",
        artifacts: { type: "document", kind: "research" },
      }),
      { ...CONTEXT, stage: "rfc" },
      /document.*kind|relative_path|sha256/i,
    ],
    [
      result({
        stage: "rfc",
        status: "artifact-ready",
        artifacts: {
          type: "document",
          kind: "rfc",
          relative_path: "artifacts/rfc.md",
          sha256: "c".repeat(64),
          media_type: "text/markdown",
        },
      }),
      { ...CONTEXT, stage: "rfc" },
      /media_type.*rfc/i,
    ],
    [
      result({ stage: "research", status: "needs-approval" }),
      { ...CONTEXT, stage: "research" },
      /status.*not allowed/i,
    ],
    [
      result({
        stage: "rfc",
        status: "blocked",
        blocker: { code: "input-needed", reason: "Need input", remediation: "Provide input" },
        artifacts: prArtifact(),
      }),
      { ...CONTEXT, stage: "rfc" },
      /artifacts.*not allowed|document-only/i,
    ],
  ];

  for (const [candidate, context, expected] of cases) {
    const checked = validateStageResult(candidate, context);
    assert.equal(checked.ok, false, JSON.stringify(checked));
    assert.match(checked.reason, expected);
  }
});

test("reader fails closed for missing, symlinked, partial, and oversized result files", (t) => {
  const root = tmpDir(t);
  const missing = readStageResult(path.join(root, "missing.json"), CONTEXT);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "result-missing");

  const target = path.join(root, "target.json");
  fs.writeFileSync(target, JSON.stringify(result()), { mode: 0o600 });
  const linked = path.join(root, "linked.json");
  fs.symlinkSync(target, linked);
  assert.equal(readStageResult(linked, CONTEXT).code, "result-unsafe-path");

  const partial = path.join(root, "partial.json");
  fs.writeFileSync(partial, '{"version":1', { mode: 0o600 });
  assert.equal(readStageResult(partial, CONTEXT).code, "result-malformed");

  const oversized = path.join(root, "oversized.json");
  fs.writeFileSync(oversized, "x".repeat(MAX_RESULT_BYTES + 1), { mode: 0o600 });
  assert.equal(readStageResult(oversized, CONTEXT).code, "result-too-large");
});

test("reader rejects a file swapped between no-follow inspection and open", (t) => {
  const root = tmpDir(t);
  const victim = path.join(root, "result.json");
  const replacement = path.join(root, "replacement.json");
  fs.writeFileSync(victim, JSON.stringify(result()), { mode: 0o600 });
  fs.writeFileSync(replacement, JSON.stringify(result()), { mode: 0o644 });
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function patchedOpen(filePath, ...args) {
    if (!swapped && filePath === victim) {
      swapped = true;
      fs.renameSync(replacement, victim);
    }
    return originalOpen.call(fs, filePath, ...args);
  };
  try {
    assert.equal(readStageResult(victim, CONTEXT).code, "result-unsafe-path");
  } finally {
    fs.openSync = originalOpen;
  }
});

test("document verification pins path, type, size, and sha256 inside the run directory", (t) => {
  const root = tmpDir(t);
  const capability = createRunResultCapability(root, RUN_ID);
  const relativePath = "artifacts/research.md";
  const documentPath = path.join(capability.runDir, relativePath);
  fs.mkdirSync(path.dirname(documentPath));
  fs.writeFileSync(documentPath, "verified research\n", { mode: 0o600 });
  const sha256 = crypto.createHash("sha256").update("verified research\n").digest("hex");
  const artifact = {
    type: "document",
    kind: "research",
    relative_path: relativePath,
    sha256,
    media_type: "text/markdown",
  };

  const verified = verifyDocumentArtifact(capability.runDir, artifact);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.content.toString("utf8"), "verified research\n");

  assert.equal(
    verifyDocumentArtifact(capability.runDir, { ...artifact, relative_path: "../escape.md" }).ok,
    false
  );
  assert.equal(
    verifyDocumentArtifact(capability.runDir, { ...artifact, sha256: "0".repeat(64) }).code,
    "artifact-hash-mismatch"
  );

  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, "outside");
  const symlink = path.join(capability.runDir, "artifacts", "linked.md");
  fs.symlinkSync(outside, symlink);
  assert.equal(
    verifyDocumentArtifact(capability.runDir, { ...artifact, relative_path: "artifacts/linked.md" })
      .code,
    "artifact-unsafe-path"
  );

  const outsideDir = path.join(root, "outside-dir");
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, "nested.md"), "verified research\n", { mode: 0o600 });
  fs.symlinkSync(outsideDir, path.join(capability.runDir, "linked-dir"));
  assert.equal(
    verifyDocumentArtifact(capability.runDir, {
      ...artifact,
      relative_path: "linked-dir/nested.md",
    }).code,
    "artifact-unsafe-path"
  );

  const large = path.join(capability.runDir, "artifacts", "large.md");
  fs.writeFileSync(large, Buffer.alloc(MAX_DOCUMENT_BYTES + 1), { mode: 0o600 });
  assert.equal(
    verifyDocumentArtifact(capability.runDir, { ...artifact, relative_path: "artifacts/large.md" })
      .code,
    "artifact-too-large"
  );
});

function git(args, cwd) {
  return require("node:child_process").execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeGateFixture(t, { protectedChange = false, stale = false } = {}) {
  const root = tmpDir(t);
  git(["init", "--initial-branch=main"], root);
  git(["config", "user.email", "pm-test@example.com"], root);
  git(["config", "user.name", "PM Test"], root);
  fs.writeFileSync(path.join(root, "README.md"), "base\n");
  git(["add", "README.md"], root);
  git(["commit", "-m", "base"], root);
  const baseOid = git(["rev-parse", "HEAD"], root);
  git(["checkout", "-b", "loop/pm-108"], root);
  const changedPath = protectedChange ? "pm/backlog/pm-108.md" : "scripts/change.js";
  fs.mkdirSync(path.dirname(path.join(root, changedPath)), { recursive: true });
  fs.writeFileSync(path.join(root, changedPath), "change\n");
  git(["add", changedPath], root);
  git(["commit", "-m", "change"], root);
  const headOid = git(["rev-parse", "HEAD"], root);

  const sessionDir = path.join(root, ".pm", "dev-sessions");
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const artifact = path.join(sessionDir, "pm-108.md");
  fs.writeFileSync(artifact, "gate evidence\n", { mode: 0o600 });
  const gate = (name, overrides = {}) => ({
    name,
    status: "passed",
    commit: stale ? baseOid : headOid,
    artifact: ".pm/dev-sessions/pm-108.md",
    reason: "",
    checked_at: "2026-07-10T10:00:00Z",
    ...overrides,
  });
  const canonicalSessionDir = path.join(sessionDir, "loop-pm-108");
  fs.mkdirSync(canonicalSessionDir, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(canonicalSessionDir, "gates.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        size: "XL",
        kind: "proposal",
        gates: [
          gate("tdd"),
          gate("design-critique", {
            status: "skipped",
            reason: "backend-only Node CLI change with no UI impact",
          }),
          gate("qa", {
            status: "skipped",
            reason: "backend-only Node CLI change with no UI impact",
          }),
          gate("review", { lenses: ["bug", "edge", "reuse", "quality", "efficiency"] }),
          gate("verification"),
        ],
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  return { root, baseOid, headOid, manifestPath, artifact };
}

test("gate verification pins the sidecar to expected source HEAD and rejects protected source paths", (t) => {
  const fixture = makeGateFixture(t);
  const verified = __test.verifyCommittedGateSidecarWithChecker(
    fixture.root,
    {
      expectedHeadOid: fixture.headOid,
      expectedHead: "loop/pm-108",
      baseRef: fixture.baseOid,
    },
    checkedGateFixture
  );
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.deepEqual(verified.changedFiles, ["scripts/change.js"]);

  const protectedFixture = makeGateFixture(t, { protectedChange: true });
  const protectedResult = verifyCommittedGateSidecar(protectedFixture.root, {
    expectedHeadOid: protectedFixture.headOid,
    expectedHead: "loop/pm-108",
    baseRef: protectedFixture.baseOid,
  });
  assert.equal(protectedResult.ok, false);
  assert.equal(protectedResult.code, "protected-source-path-changed");
});

test("gate verification uses a flat legacy sidecar only without a canonical session directory", (t) => {
  const fixture = makeGateFixture(t);
  const legacyPath = path.join(fixture.root, ".pm", "dev-sessions", "loop-pm-108.gates.json");
  fs.renameSync(fixture.manifestPath, legacyPath);
  fs.rmdirSync(path.dirname(fixture.manifestPath));

  const checked = __test.verifyCommittedGateSidecarWithChecker(
    fixture.root,
    {
      expectedHeadOid: fixture.headOid,
      expectedHead: "loop/pm-108",
      baseRef: fixture.baseOid,
    },
    checkedGateFixture
  );
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.manifestPath, legacyPath);
});

test("delivery verification rejects a legacy-shaped Review row", (t) => {
  const fixture = makeGateFixture(t);
  const checked = verifyCommittedGateSidecar(fixture.root, {
    expectedHeadOid: fixture.headOid,
    expectedHead: "loop/pm-108",
    baseRef: fixture.baseOid,
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.code, "gate-verification-failed");
  assert.match(checked.reason, /requires evidence_kind review-report-v1 in enforcement mode/);
});

test("gate verification rejects stale, missing, symlinked, and wrong-HEAD evidence", (t) => {
  const stale = makeGateFixture(t, { stale: true });
  assert.equal(
    verifyCommittedGateSidecar(stale.root, {
      expectedHeadOid: stale.headOid,
      expectedHead: "loop/pm-108",
      baseRef: stale.baseOid,
    }).code,
    "gate-verification-failed"
  );

  const wrongHead = makeGateFixture(t);
  assert.equal(
    verifyCommittedGateSidecar(wrongHead.root, {
      expectedHeadOid: wrongHead.baseOid,
      expectedHead: "loop/pm-108",
      baseRef: wrongHead.baseOid,
    }).code,
    "source-head-mismatch"
  );

  const missing = makeGateFixture(t);
  fs.rmSync(missing.manifestPath);
  assert.equal(
    verifyCommittedGateSidecar(missing.root, {
      expectedHeadOid: missing.headOid,
      expectedHead: "loop/pm-108",
      baseRef: missing.baseOid,
    }).code,
    "gate-sidecar-missing"
  );

  const linked = makeGateFixture(t);
  const real = `${linked.manifestPath}.real`;
  fs.renameSync(linked.manifestPath, real);
  fs.symlinkSync(real, linked.manifestPath);
  assert.equal(
    verifyCommittedGateSidecar(linked.root, {
      expectedHeadOid: linked.headOid,
      expectedHead: "loop/pm-108",
      baseRef: linked.baseOid,
    }).code,
    "gate-sidecar-unsafe"
  );
});

test("gate verification rejects artifacts outside the source session directory", (t) => {
  const fixture = makeGateFixture(t);
  const outside = path.join(
    path.dirname(fixture.root),
    `${path.basename(fixture.root)}-outside.txt`
  );
  fs.writeFileSync(outside, "not session evidence\n");
  t.after(() => fs.rmSync(outside, { force: true }));
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
  for (const gate of manifest.gates) gate.artifact = outside;
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const checked = verifyCommittedGateSidecar(fixture.root, {
    expectedHeadOid: fixture.headOid,
    expectedHead: "loop/pm-108",
    baseRef: fixture.baseOid,
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.code, "gate-artifact-unsafe");
});

test("gate verification bounds the manifest gate table before artifact inspection", (t) => {
  const fixture = makeGateFixture(t);
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
  manifest.gates = Array.from({ length: 17 }, (_, index) => ({
    ...manifest.gates[0],
    name: `gate-${index}`,
  }));
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const checked = verifyCommittedGateSidecar(fixture.root, {
    expectedHeadOid: fixture.headOid,
    expectedHead: "loop/pm-108",
    baseRef: fixture.baseOid,
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.code, "gate-sidecar-invalid");
});
