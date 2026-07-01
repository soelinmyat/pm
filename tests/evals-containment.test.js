"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  safeCopyTree,
  hashTree,
  createSourceIdentity,
  createScenarioIdentity,
} = require("../scripts/evals/stage.js");
const {
  validateArtifactName,
  inspectArtifact,
  buildSandboxPlan,
  sanitizeResourceBreach,
} = require("../scripts/evals/containment.js");
const { composeVerdict } = require("../scripts/evals/verdict.js");

function makeTmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-evals-containment-"));
  return {
    root,
    write(relPath, content, mode = 0o644) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      fs.chmodSync(full, mode);
      return full;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
      return path.join(root, relPath);
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("safeCopyTree rejects symlinks before copy", () => {
  const tmp = makeTmp();
  try {
    tmp.write("source/commands/dev.md", "dev");
    fs.symlinkSync("/etc/passwd", path.join(tmp.root, "source", "commands", "escape"));
    assert.throws(
      () => safeCopyTree(path.join(tmp.root, "source"), path.join(tmp.root, "dest")),
      /symlink rejected/
    );
    assert.equal(fs.existsSync(path.join(tmp.root, "dest", "commands", "dev.md")), false);
  } finally {
    tmp.cleanup();
  }
});

test("hashTree and identity helpers produce stable relative manifests", () => {
  const tmp = makeTmp();
  try {
    tmp.write("runtime/commands/dev.md", "dev");
    tmp.write("runtime/skills/dev/SKILL.md", "skill");
    const first = hashTree(path.join(tmp.root, "runtime"));
    const second = hashTree(path.join(tmp.root, "runtime"));
    assert.equal(first.hash, second.hash);
    assert.deepEqual(
      first.files.map((file) => file.path),
      ["commands/dev.md", "skills/dev/SKILL.md"]
    );

    const source = createSourceIdentity({
      sourceRef: "abc123",
      branch: "codex/test",
      dirty: false,
      runtimeDir: path.join(tmp.root, "runtime"),
    });
    assert.equal(source.runtime_ref, "runtime/pm");
    assert.match(source.runtime_hash, /^sha256:/);

    const scenario = createScenarioIdentity({
      id: "dev-review-before-push",
      scenarioDir: path.join(tmp.root, "runtime"),
    });
    assert.equal(scenario.scenario_ref, "scenario");
    assert.match(scenario.scenario_hash, /^sha256:/);
  } finally {
    tmp.cleanup();
  }
});

test("artifact boundary rejects traversal, symlink, fifo, and oversized artifacts", () => {
  const tmp = makeTmp();
  try {
    const artifacts = tmp.mkdir("artifacts");
    tmp.write("artifacts/good.jsonl", "{}\n");
    fs.symlinkSync("/etc/passwd", path.join(artifacts, "link.jsonl"));

    assert.equal(validateArtifactName("good.jsonl").ok, true);
    assert.equal(validateArtifactName("../bad").ok, false);
    assert.equal(validateArtifactName("nested/path").ok, false);

    assert.equal(inspectArtifact(path.join(artifacts, "good.jsonl"), { maxBytes: 1024 }).ok, true);
    assert.equal(inspectArtifact(path.join(artifacts, "link.jsonl"), { maxBytes: 1024 }).ok, false);

    const big = tmp.write("artifacts/big.jsonl", "x".repeat(2048));
    assert.equal(inspectArtifact(big, { maxBytes: 1024 }).ok, false);
  } finally {
    tmp.cleanup();
  }
});

test("sandbox plan keeps metadata unmounted and declares resource limits", () => {
  const plan = buildSandboxPlan({
    runDir: "/tmp/run",
    network: "disabled",
    adapter: "stub",
  });
  assert.ok(plan.mounts.some((mount) => mount.target === "runtime/pm" && mount.readonly));
  assert.ok(plan.mounts.some((mount) => mount.target === "scenario" && mount.readonly));
  assert.ok(!plan.mounts.some((mount) => mount.target === "metadata"));
  assert.equal(plan.resources.pids, 64);
  assert.equal(plan.resources.memoryBytes, 1024 * 1024 * 1024);
});

test("verdict precedence favors safety and harness uncertainty over deterministic failure", () => {
  const verdict = composeVerdict({
    scenario: "dev-review-before-push",
    agent: "stub",
    runId: "20260701T050000Z--dev-review-before-push--stub",
    preRecords: [{ status: "pass" }],
    postRecords: [{ status: "fail", reason: "review skipped" }],
    hazards: [{ reason: "artifact-boundary" }],
  });
  assert.equal(verdict.status, "indeterminate");
  assert.equal(verdict.reason, "artifact-boundary");

  const failed = composeVerdict({
    scenario: "dev-review-before-push",
    agent: "stub",
    runId: "20260701T050000Z--dev-review-before-push--stub",
    preRecords: [{ status: "pass" }],
    postRecords: [{ status: "fail", reason: "review skipped" }],
  });
  assert.equal(failed.status, "fail");
});

test("resource breaches normalize to resource-limit hazards", () => {
  const breach = sanitizeResourceBreach({ type: "timeout", phase: "post" });
  assert.deepEqual(breach, { reason: "resource-limit", detail: "timeout in post" });
});
