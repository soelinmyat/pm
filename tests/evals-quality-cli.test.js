"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const cli = path.join(repoRoot, "scripts", "evals", "quality-cli.js");
const QUALITY_PROMPT =
  "Implement the approved change in `change-request.md`: tighten `docs/workflow.md`, add a focused regression test before the final implementation, run the PM review gate, and push the completed branch to the fixture's local origin for ship handoff. Write the required `review-report.json` under the supplied artifact directory and report concise evidence tied to the final commit.";

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function makeCandidate(profile, repeat = 1) {
  const content = `Decision report from ${profile.model}.`;
  return {
    schema_version: 1,
    workflow: "dev",
    case_id: "dev-happy-path",
    case_type: "happy-path",
    release: "1.13.12",
    quality_case_hash: sha(QUALITY_PROMPT),
    source_hash: sha("source"),
    behavioral: {
      status: "pass",
      artifact_ref: `runs/20260712T02010${repeat}Z--dev-review-before-push--${profile.adapter}`,
      scenario_hash: sha("scenario"),
    },
    profile,
    runtime: { duration_ms: repeat * 1000, status: "complete" },
    repeat,
    artifacts: [{ name: "report.md", media_type: "text/markdown", sha256: sha(content), content }],
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

test("quality CLI builds a blind packet and a resolved JSON/Markdown scorecard", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-cli-"));
  try {
    const candidatesPath = path.join(tmp, "candidates.json");
    const packetPath = path.join(tmp, "packet.json");
    const keyPath = path.join(tmp, "private-key.json");
    const judgmentPath = path.join(tmp, "judgment.json");
    const secondJudgmentPath = path.join(tmp, "judgment-2.json");
    const scorecardPath = path.join(tmp, "scorecard.json");
    const markdownPath = path.join(tmp, "scorecard.md");
    const candidates = [
      makeCandidate({ id: "sol-high", adapter: "codex", model: "gpt-5.6-sol", effort: "high" }),
      makeCandidate({
        id: "opus-xhigh",
        adapter: "claude",
        model: "claude-opus-4-8",
        effort: "xhigh",
      }),
    ];
    writeJson(candidatesPath, { schema_version: 1, candidates });

    const packetRun = spawnSync(
      process.execPath,
      [
        cli,
        "packet",
        "--candidates",
        candidatesPath,
        "--case",
        "dev-happy-path",
        "--packet",
        packetPath,
        "--key",
        keyPath,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PM_EVAL_BLIND_SALT: "test-cli-salt" },
      }
    );
    assert.equal(packetRun.status, 0, packetRun.stdout + packetRun.stderr);
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
    const secondPacketPath = packetPath.replace(/\.json$/, ".judge-2.json");
    const secondPacket = JSON.parse(fs.readFileSync(secondPacketPath, "utf8"));
    assert.notEqual(packet.view_id, secondPacket.view_id);
    assert.deepEqual(new Set(packet.allowed_view_ids), new Set(secondPacket.allowed_view_ids));
    assert.equal(packet.pairwise_plan[0].left, secondPacket.pairwise_plan[0].right);
    const packetText = JSON.stringify(packet).toLowerCase();
    assert.doesNotMatch(packetText, /sol-high|opus-xhigh|gpt-5\.6|claude|codex/);

    const ids = packet.candidates.map((item) => item.id);
    const dimensions = packet.rubric.dimensions.map((item) => item.id);
    writeJson(judgmentPath, {
      $schema: "https://pm-plugin.local/evals/quality-judgment.schema.json",
      schema_version: 1,
      packet_id: packet.packet_id,
      view_id: packet.view_id,
      view_sha256: packet.view_sha256,
      judge: "blind-judge-a",
      candidates: ids.map((id, index) => ({
        id,
        dimensions: dimensions.map((dimension) => ({
          dimension,
          score: index === 0 ? 4 : 3,
          evidence: `Evidence for ${dimension}.`,
        })),
        summary: "Artifact-grounded assessment.",
      })),
      pairwise: [
        {
          left: ids[0],
          right: ids[1],
          preference: ids[0],
          reason: "Stronger decision support.",
        },
      ],
    });
    writeJson(secondJudgmentPath, {
      $schema: "https://pm-plugin.local/evals/quality-judgment.schema.json",
      schema_version: 1,
      packet_id: secondPacket.packet_id,
      view_id: secondPacket.view_id,
      view_sha256: secondPacket.view_sha256,
      judge: "blind-judge-b",
      candidates: secondPacket.candidates.map((item, index) => ({
        id: item.id,
        dimensions: dimensions.map((dimension) => ({
          dimension,
          score: index === 0 ? 3 : 4,
          evidence: `Second-view evidence for ${dimension}.`,
        })),
        summary: "Second counterbalanced assessment.",
      })),
      pairwise: secondPacket.pairwise_plan.map(({ left, right }) => ({
        left,
        right,
        preference: right,
        reason: "Second-view comparison.",
      })),
    });

    const scoreRun = spawnSync(
      process.execPath,
      [
        cli,
        "score",
        "--candidates",
        candidatesPath,
        "--packet",
        packetPath,
        "--packet",
        secondPacketPath,
        "--key",
        keyPath,
        "--judgment",
        judgmentPath,
        "--judgment",
        secondJudgmentPath,
        "--json",
        scorecardPath,
        "--markdown",
        markdownPath,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(scoreRun.status, 0, scoreRun.stdout + scoreRun.stderr);
    const scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf8"));
    assert.equal(scorecard.overall_status, "quality-scored");
    assert.equal(scorecard.eligible_candidates, 2);
    assert.equal(scorecard.quality_winner, null);
    assert.ok(["sol-high", "opus-xhigh"].includes(scorecard.observed_leader));
    const markdown = fs.readFileSync(markdownPath, "utf8");
    assert.match(markdown, /# PM Quality Scorecard/);
    assert.match(markdown, /Behavioral eligibility/);
    assert.match(markdown, /Variance claimable: no/);
    assert.match(markdown, /judgment: .*coverage 100%/);
    assert.match(markdown, /Judge agreement/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("quality CLI refuses packet creation without an explicit secret salt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-cli-nosalt-"));
  try {
    const candidatesPath = path.join(tmp, "candidates.json");
    writeJson(candidatesPath, { schema_version: 1, candidates: [] });
    const env = { ...process.env };
    delete env.PM_EVAL_BLIND_SALT;
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "packet",
        "--candidates",
        candidatesPath,
        "--case",
        "dev-happy-path",
        "--packet",
        path.join(tmp, "packet.json"),
        "--key",
        path.join(tmp, "key.json"),
      ],
      { cwd: repoRoot, encoding: "utf8", env }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PM_EVAL_BLIND_SALT is required/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("quality CLI captures a content-hashed candidate from a determinate run bundle", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-capture-"));
  try {
    const runDir = path.join(tmp, "run");
    fs.mkdirSync(path.join(runDir, "metadata"), { recursive: true });
    fs.mkdirSync(path.join(runDir, "runtime", "pm"), { recursive: true });
    fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
    writeJson(path.join(runDir, "verdict.json"), {
      scenario: "quality-dev-happy-path",
      agent: "codex",
      status: "pass",
      artifact_ref: "runs/20260712T030101Z--dev-review-before-push--codex",
    });
    writeJson(path.join(runDir, "metadata", "source_identity.json"), {
      runtime_hash: sha("runtime"),
    });
    writeJson(path.join(runDir, "metadata", "scenario_identity.json"), {
      scenario_hash: sha("scenario"),
    });
    writeJson(path.join(runDir, "metadata", "quality_case_identity.json"), {
      id: "dev-happy-path",
      workflow: "dev",
      type: "happy-path",
      prompt_hash: sha(QUALITY_PROMPT),
      base_scenario: "quality-dev-happy-path",
      scenario_ref: "quality-dev-happy-path",
      scenario_contract_hash: JSON.parse(
        fs.readFileSync(path.join(repoRoot, "evals", "quality", "suite.json"), "utf8")
      ).workflows.find((item) => item.id === "dev").cases[0].scenario_contract_hash,
    });
    writeJson(path.join(runDir, "metadata", "quality_profile_identity.json"), {
      schema_version: 1,
      id: "sol-high",
      adapter: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    writeJson(path.join(runDir, "runtime", "pm", "plugin.config.json"), {
      version: "1.13.12",
    });
    writeJson(path.join(runDir, "metadata", "codex_progress.json"), {
      status: "complete",
      duration_ms: 1234,
    });
    writeJson(path.join(runDir, "metadata", "codex_command.json"), {
      argv: ["exec", "-m", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"'],
    });
    fs.writeFileSync(path.join(runDir, "artifacts", "report.md"), "# Verified report\n");
    const out = path.join(tmp, "candidates.json");
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "capture",
        "--run",
        runDir,
        "--profile",
        "sol-high",
        "--case",
        "dev-happy-path",
        "--repeat",
        "1",
        "--artifact",
        "artifacts/report.md",
        "--out",
        out,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const ledger = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(ledger.candidates.length, 1);
    assert.equal(ledger.candidates[0].profile.id, "sol-high");
    assert.equal(ledger.candidates[0].artifacts[0].sha256, sha("# Verified report\n"));
    assert.equal(ledger.candidates[0].source_hash, sha("runtime"));
    assert.equal(ledger.candidates[0].runtime.duration_ms, 1234);

    writeJson(path.join(runDir, "metadata", "quality_profile_identity.json"), {
      schema_version: 1,
      id: "sol-high",
      adapter: "codex",
      model: "wrong-model",
      effort: "high",
    });
    const mislabeled = spawnSync(
      process.execPath,
      [
        cli,
        "capture",
        "--run",
        runDir,
        "--profile",
        "sol-high",
        "--case",
        "dev-happy-path",
        "--repeat",
        "2",
        "--artifact",
        "artifacts/report.md",
        "--out",
        out,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(mislabeled.status, 0);
    assert.match(mislabeled.stderr, /profile model does not match/);

    writeJson(path.join(runDir, "metadata", "quality_profile_identity.json"), {
      schema_version: 1,
      id: "sol-high",
      adapter: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "escaped.md"), "escape\n");
    fs.symlinkSync(outside, path.join(runDir, "artifacts", "linked"));
    const escaped = spawnSync(
      process.execPath,
      [
        cli,
        "capture",
        "--run",
        runDir,
        "--profile",
        "sol-high",
        "--case",
        "dev-happy-path",
        "--repeat",
        "2",
        "--artifact",
        "artifacts/linked/escaped.md",
        "--out",
        out,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(escaped.status, 0);
    assert.match(escaped.stderr, /resolves outside run directory/);

    const duplicate = spawnSync(
      process.execPath,
      [
        cli,
        "capture",
        "--run",
        runDir,
        "--profile",
        "sol-high",
        "--case",
        "dev-happy-path",
        "--repeat",
        "1",
        "--artifact",
        "artifacts/report.md",
        "--out",
        out,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /candidate already exists/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
