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
const { transcriptEscapesRunDir } = require("../scripts/evals/adapters/shared.js");
const { hostRepoSnapshot, hostRepoEscaped } = require("../scripts/evals/run.js");
const { spawnSync } = require("node:child_process");

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

test("verdict treats failing pre-checks as indeterminate precondition failures", () => {
  const verdict = composeVerdict({
    scenario: "dev-review-before-push",
    agent: "stub",
    runId: "20260701T050000Z--dev-review-before-push--stub",
    preExecuted: true,
    postExecuted: true,
    preRecords: [{ status: "fail", reason: "missing fixture" }],
    postRecords: [{ status: "pass" }],
  });
  assert.equal(verdict.status, "indeterminate");
  assert.equal(verdict.reason, "pre-check-failed");
});

test("resource breaches normalize to resource-limit hazards", () => {
  const breach = sanitizeResourceBreach({ type: "timeout", phase: "post" });
  assert.deepEqual(breach, { reason: "resource-limit", detail: "timeout in post" });
});

// ---------------------------------------------------------------------------
// transcriptEscapesRunDir — post-run tripwire for mutating activity outside runDir
// (adapters set tool_class on every tool event: codex natively, claude via
// classifyTool in normalizeClaudeStream).
// ---------------------------------------------------------------------------

const RUN_DIR = "/runs/eval-r1";
const WORKDIR = "/runs/eval-r1/workdir";
// Must exist, sit outside RUN_DIR, and NEVER fall under the guard's temp-root
// allowlist — REPO_ROOT fails that last condition when the suite runs from a
// pre-push temp worktree under $TMPDIR (/var/folders/...), so use the home dir.
const EXISTING_OUTSIDE = os.homedir(); // exists, not temp-rooted, not under RUN_DIR

function tool(toolClass, command, extra = {}) {
  return { type: "tool", tool_class: toolClass, command, ...extra };
}

test("escape guard: write/edit to an absolute path outside runDir fails", () => {
  assert.equal(
    transcriptEscapesRunDir([tool("write-file", "/etc/evil.txt")], RUN_DIR, WORKDIR),
    true
  );
  assert.equal(
    transcriptEscapesRunDir([tool("edit-file", "/etc/evil.txt")], RUN_DIR, WORKDIR),
    true
  );
});

test("escape guard: a relative edit/write target escaping the workdir fails", () => {
  // codex apply_patch paths are workdir-relative — ../../evil resolves outside runDir.
  assert.equal(
    transcriptEscapesRunDir([tool("edit-file", "../../evil.txt")], RUN_DIR, WORKDIR),
    true
  );
  // A relative target that stays in the workdir is fine.
  assert.equal(
    transcriptEscapesRunDir([tool("write-file", "src/foo.js")], RUN_DIR, WORKDIR),
    false
  );
});

test("escape guard: positional cd/git -C/--git-dir at an outside abs path fails", () => {
  const cases = [
    "cd /Users/harness/pm_plugin && git commit -am x",
    "git -C /Users/harness/repo commit -am x",
    "git --git-dir=/Users/harness/repo/.git add .",
  ];
  for (const command of cases) {
    assert.equal(
      transcriptEscapesRunDir([tool("run-command", command)], RUN_DIR, WORKDIR),
      true,
      command
    );
  }
});

test("escape guard: rm -rf against an EXISTING outside path fails", () => {
  assert.equal(
    transcriptEscapesRunDir([tool("run-command", `rm -rf ${EXISTING_OUTSIDE}`)], RUN_DIR, WORKDIR),
    true
  );
});

test("escape guard: mutating-verb false positives stay clean (commit message, /dev/null)", () => {
  const clean = [
    'git commit -m "fix /api/users 500 and /var/log path"',
    "git commit -am x > /dev/null 2>&1",
    "git push -qu origin main",
    "git init -q -b main . && git add -A && git commit -qm seed",
    `${process.execPath} -e 'void 0'; /usr/bin/git remote get-url --push --all -- origin`,
  ];
  for (const command of clean) {
    assert.equal(
      transcriptEscapesRunDir([tool("run-command", command)], RUN_DIR, WORKDIR),
      false,
      command
    );
  }
});

test("escape guard: writes to OS temp roots and /dev are allowed", () => {
  for (const target of ["/tmp/scratch.txt", "/private/var/folders/x/y/z.txt", "/dev/null"]) {
    assert.equal(
      transcriptEscapesRunDir([tool("write-file", target)], RUN_DIR, WORKDIR),
      false,
      target
    );
  }
});

test("escape guard: codex-shape events (tool_class) escaping outside fail", () => {
  assert.equal(
    transcriptEscapesRunDir(
      [tool("edit-file", "/etc/passwd", { name: "functions.apply_patch" })],
      RUN_DIR,
      WORKDIR
    ),
    true
  );
  assert.equal(
    transcriptEscapesRunDir(
      [
        tool("run-command", "cd /Users/harness/pm && git push origin main", {
          name: "functions.exec_command",
        }),
      ],
      RUN_DIR,
      WORKDIR
    ),
    true
  );
});

test("escape guard: a legitimate run stays inside runDir; outside reads pass", () => {
  const events = [
    { type: "skill", name: "pm:dev" },
    tool("write-file", "/runs/eval-r1/workdir/src/foo.js"),
    tool("edit-file", "src/bar.js"),
    tool("run-command", "git init -q -b main . && git add -A && git commit -qm seed"),
    tool("run-command", "git push -qu origin main"),
    tool("read-file", "/runs/eval-r1/home/.claude/plugins/cache/pm/pm/1.9.0/skills/dev/SKILL.md"),
    // Reading an outside absolute path is legitimate — only mutations are flagged.
    tool("read-file", "/etc/hosts"),
  ];
  assert.equal(transcriptEscapesRunDir(events, RUN_DIR, WORKDIR), false);
});

test("escape guard: writes inside runDir and empty input pass", () => {
  assert.equal(
    transcriptEscapesRunDir([tool("edit-file", "/runs/eval-r1/workdir/x.js")], RUN_DIR, WORKDIR),
    false
  );
  assert.equal(transcriptEscapesRunDir([], RUN_DIR, WORKDIR), false);
});

// ---------------------------------------------------------------------------
// hostRepoEscaped — the host-repo delta backstop (run.js)
// ---------------------------------------------------------------------------

test("host-repo delta backstop: detects new dirt and HEAD moves outside the run dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-hostrepo-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@e.com");
    git("config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "seed");

    const before = hostRepoSnapshot(dir);
    assert.equal(hostRepoEscaped(dir, before), false);

    // A new untracked file (dirty outside the run dir) is an escape.
    fs.writeFileSync(path.join(dir, "escape.txt"), "planted\n");
    assert.equal(hostRepoEscaped(dir, before), true);

    // Back to clean, then a walked-up commit moves HEAD → escape.
    fs.rmSync(path.join(dir, "escape.txt"));
    const clean = hostRepoSnapshot(dir);
    assert.equal(hostRepoEscaped(dir, clean), false);
    fs.writeFileSync(path.join(dir, "b.txt"), "two\n");
    git("add", "-A");
    git("commit", "-qm", "walked-up commit");
    assert.equal(hostRepoEscaped(dir, clean), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
