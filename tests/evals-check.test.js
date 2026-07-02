"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkScript = path.join(repoRoot, "scripts", "evals", "check.js");
const packageJsonPath = path.join(repoRoot, "package.json");
const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");

const {
  validateEvalTree,
  validateScenario,
  validateBaselineLedger,
  validateResultLedger,
} = require("../scripts/evals/check.js");

const requiredSentinelIds = [
  "dev-ui-design-critique-required",
  "dev-review-before-push",
  "dev-tdd-before-implementation",
  "skill-description-body-read",
  "review-catches-planted-bug",
  "groom-quick-from-backlog",
];

function makeTmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-evals-check-"));
  return {
    root,
    write(relPath, content, mode) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      if (mode !== undefined) fs.chmodSync(full, mode);
      return full;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeScenario(tmp, id, overrides = {}) {
  const dir = `evals/scenarios/${id}`;
  tmp.write(
    `${dir}/story.md`,
    overrides.story ??
      `---\nid: ${id}\ntitle: ${id}\nstatus: ready\ntier: sentinel\ntags:\n  - dev\n---\n\nRole: test.\n\nUser message: test.\n\nStop condition: done.\n\n## Acceptance Criteria\n\n- It works.\n`
  );
  tmp.write(
    `${dir}/setup.sh`,
    overrides.setup ?? "#!/usr/bin/env bash\nset -euo pipefail\nmkdir -p fixture\n",
    overrides.setupMode ?? 0o755
  );
  tmp.write(
    `${dir}/checks.sh`,
    overrides.checks ??
      "pre() {\n  file-exists fixture\n}\n\npost() {\n  check-transcript skill-called pm:dev\n}\n",
    overrides.checksMode ?? 0o644
  );
  return path.join(tmp.root, dir);
}

function ledgerRow(id, status = "pass", reason = "") {
  return {
    id,
    tier: "sentinel",
    agent: "codex",
    status,
    reason,
    artifact_ref: `runs/20260701T050100Z--${id}--codex`,
    recorded_at: "2026-07-01T05:01:00Z",
  };
}

function sentinelLedger(statuses = {}) {
  return {
    $schema: "https://pm-plugin.local/evals/baseline.schema.json",
    schema_version: 1,
    updated: "2026-07-01",
    scenarios: requiredSentinelIds.map((id) => {
      const status = statuses[id] || "pass";
      return ledgerRow(id, status, status === "pass" ? "" : "captured current behavior");
    }),
  };
}

test("eval:check validates a well-formed scenario tree", () => {
  const tmp = makeTmp();
  try {
    writeScenario(tmp, "dev-review-before-push");
    const result = validateEvalTree(tmp.root);
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  } finally {
    tmp.cleanup();
  }
});

test("eval:check reports missing required scenario files", () => {
  const tmp = makeTmp();
  try {
    const scenarioDir = writeScenario(tmp, "missing-checks");
    fs.rmSync(path.join(scenarioDir, "checks.sh"));
    const result = validateScenario(scenarioDir);
    assert.equal(result.ok, false);
    assert.match(
      result.issues.map((i) => i.message).join("\n"),
      /missing required file checks\.sh/
    );
  } finally {
    tmp.cleanup();
  }
});

test("eval:check rejects bad story frontmatter and missing acceptance criteria", () => {
  const tmp = makeTmp();
  try {
    const scenarioDir = writeScenario(tmp, "bad-story", {
      story: "---\nid: bad-story\n---\n\nNo AC here.\n",
    });
    const result = validateScenario(scenarioDir);
    assert.equal(result.ok, false);
    assert.match(result.issues.map((i) => i.message).join("\n"), /missing frontmatter key title/);
    assert.match(result.issues.map((i) => i.message).join("\n"), /missing ## Acceptance Criteria/);
  } finally {
    tmp.cleanup();
  }
});

test("eval:check rejects shell contract and harness-forgery patterns", () => {
  const tmp = makeTmp();
  try {
    const scenarioDir = writeScenario(tmp, "bad-checks", {
      setupMode: 0o644,
      checksMode: 0o755,
      checks:
        "echo top-level\n\npre() {\n  echo '::pm-eval-check::bad'\n}\n\npost() {\n  echo \"$PM_EVAL_CHECK_NONCE\"\n}\n",
    });
    const result = validateScenario(scenarioDir);
    assert.equal(result.ok, false);
    const text = result.issues.map((i) => i.message).join("\n");
    assert.match(text, /setup\.sh must be executable/);
    assert.match(text, /checks\.sh must not be executable/);
    assert.match(text, /checks\.sh has top-level statements/);
    assert.match(text, /raw helper frame/);
    assert.match(text, /direct PM_EVAL_/);
  } finally {
    tmp.cleanup();
  }
});

test("baseline ledger rejects traversal refs, extra fields, and unsafe strings", () => {
  const ledger = {
    $schema: "https://pm-plugin.local/evals/baseline.schema.json",
    schema_version: 1,
    updated: "2026-07-01",
    extra: true,
    scenarios: [
      {
        id: "dev-review-before-push",
        tier: "sentinel",
        agent: "codex",
        status: "fail",
        reason: "/Users/alice leaked raw transcript",
        artifact_ref: "runs/../../secret",
        recorded_at: "2026-07-01T05:00:00Z",
        extra: true,
      },
    ],
  };
  const result = validateBaselineLedger(ledger);
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /unexpected top-level field extra/);
  assert.match(text, /unexpected scenario field extra/);
  assert.match(text, /invalid artifact_ref/);
  assert.match(text, /absolute path or username/);
  assert.match(text, /raw transcript/i);
});

test("baseline ledger can require named sentinel rows", () => {
  const ledger = {
    $schema: "https://pm-plugin.local/evals/baseline.schema.json",
    schema_version: 1,
    updated: "2026-07-01",
    scenarios: [
      {
        id: "dev-review-before-push",
        tier: "sentinel",
        agent: "codex",
        status: "fail",
        reason: "review gate can be skipped before ship handoff",
        artifact_ref: "runs/20260701T050100Z--dev-review-before-push--codex",
        recorded_at: "2026-07-01T05:01:00Z",
      },
    ],
  };
  const result = validateBaselineLedger(ledger, "evals/baselines/sentinel.json", {
    requiredScenarioIds: ["dev-review-before-push", "dev-tdd-before-implementation"],
  });
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /missing baseline row for dev-tdd-before-implementation/
  );
});

test("baseline ledger accepts an all-pass measured baseline", () => {
  // Measured baselines may legitimately be all-pass; provenance comes from
  // artifact_ref rows pointing at real runs, not from a mandatory fail row.
  const result = validateBaselineLedger(sentinelLedger(), "evals/baselines/sentinel.json", {
    requiredScenarioIds: requiredSentinelIds,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("result ledger allows all sentinel rows to pass", () => {
  const result = validateResultLedger(sentinelLedger(), "evals/results/proposal-2.json", {
    requiredScenarioIds: requiredSentinelIds,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("result ledger can require named sentinel rows", () => {
  const ledger = sentinelLedger();
  ledger.scenarios.pop();
  const result = validateResultLedger(ledger, "evals/results/proposal-2.json", {
    requiredScenarioIds: requiredSentinelIds,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /missing result row for groom-quick-from-backlog/
  );
});

test("result ledger allows all sentinel rows to be skipped", () => {
  const result = validateResultLedger(
    sentinelLedger(Object.fromEntries(requiredSentinelIds.map((id) => [id, "skip"]))),
    "evals/results/current.json",
    {
      requiredScenarioIds: requiredSentinelIds,
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("baseline ledger still requires three determinate rows", () => {
  const result = validateBaselineLedger(
    sentinelLedger(Object.fromEntries(requiredSentinelIds.map((id) => [id, "skip"]))),
    "evals/baselines/sentinel.json",
    {
      requiredScenarioIds: requiredSentinelIds,
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /at least three baseline rows must be pass or fail/
  );
});

test("ledger validation rejects duplicate and unknown scenario ids", () => {
  const ledger = sentinelLedger({ "dev-review-before-push": "fail" });
  ledger.scenarios[1] = ledgerRow("dev-ui-design-critique-required", "pass");
  ledger.scenarios.push(ledgerRow("unknown-scenario", "pass"));

  const result = validateResultLedger(ledger, "evals/results/current.json", {
    requiredScenarioIds: requiredSentinelIds,
  });
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /duplicate result row for dev-ui-design-critique-required/);
  assert.match(text, /unknown result row unknown-scenario/);
  assert.match(text, /missing result row for dev-review-before-push/);
});

test("eval:check validates result ledgers without requiring a fail row", () => {
  const tmp = makeTmp();
  try {
    for (const id of requiredSentinelIds) writeScenario(tmp, id);
    tmp.write(
      "evals/baselines/sentinel.json",
      JSON.stringify(sentinelLedger({ "dev-review-before-push": "fail" }), null, 2)
    );
    tmp.write("evals/results/proposal-2.json", JSON.stringify(sentinelLedger(), null, 2));
    const result = validateEvalTree(tmp.root);
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  } finally {
    tmp.cleanup();
  }
});

test("eval:check CLI exits non-zero on invalid eval tree", () => {
  const tmp = makeTmp();
  try {
    writeScenario(tmp, "bad-cli", { checks: "echo top-level\n" });
    const result = spawnSync(process.execPath, [checkScript, "--root", tmp.root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /bad-cli/);
  } finally {
    tmp.cleanup();
  }
});

test("package and CI wire eval:check into quality gates", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  assert.equal(pkg.scripts["eval:check"], "node scripts/evals/check.js");
  assert.match(pkg.scripts.quality, /npm run eval:check/);

  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /npm run eval:check/);
  assert.match(workflow, /evals\/\*\*\/\*\.sh/);
});

test("committed sentinel scenarios and baseline pass eval:check", () => {
  const result = validateEvalTree(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});
