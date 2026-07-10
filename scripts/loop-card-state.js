#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { parseFrontmatter } = require("./kb-frontmatter.js");

const CANONICAL_CARD_STATUSES = Object.freeze([
  "idea",
  "drafted",
  "proposed",
  "planned",
  "in-progress",
  "shipping",
  "needs-human",
  "done",
]);

const MANAGED_FIELDS = [
  "status",
  "updated",
  "branch",
  "prs",
  "pr_dispatch_at",
  "pr_repo",
  "pr_number",
  "pr_url",
  "pr_base",
  "pr_head_oid",
  "pr_created_at",
  "pr_merge_sha",
  "pr_merged_at",
  "retry_after",
  "blocker_code",
  "blocker_reason",
  "blocker_remediation",
  "loop_run_id",
  "loop_log_path",
  "loop_last_outcome",
  "artifact_path",
  "artifact_sha256",
];

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function isNeedsHumanStatus(value) {
  return normalizeStatus(value) === "needs-human";
}

function bounded(value, max) {
  return String(value || "").slice(0, max);
}

function yamlScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function serializeField(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)];
  }
  return [`${key}: ${yamlScalar(value)}`];
}

function rewriteFrontmatter(content, fields) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("card transition requires YAML frontmatter");
  const managed = new Set(MANAGED_FIELDS);
  const lines = match[1].split(/\r?\n/);
  const kept = [];
  let index = 0;
  while (index < lines.length) {
    const keyMatch = lines[index].match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    if (!keyMatch || !managed.has(keyMatch[1])) {
      kept.push(lines[index]);
      index += 1;
      continue;
    }
    index += 1;
    while (index < lines.length && (/^\s/.test(lines[index]) || lines[index].trim() === "")) {
      index += 1;
    }
  }
  while (kept.length > 0 && kept.at(-1).trim() === "") kept.pop();
  for (const key of MANAGED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) continue;
    kept.push(...serializeField(key, fields[key]));
  }
  return `---\n${kept.join("\n")}\n---\n${match[2]}`;
}

function baseFields(input, status, outcome) {
  return {
    status,
    updated: (input.now instanceof Date ? input.now : new Date()).toISOString().slice(0, 10),
    loop_run_id: bounded(input.runId, 80),
    loop_log_path: bounded(input.logPath, 512),
    loop_last_outcome: bounded(outcome, 80),
  };
}

function prFields(artifact, dispatchAt) {
  const fields = {
    branch: bounded(artifact.head, 201),
    prs: [`#${artifact.number}`],
    pr_repo: bounded(artifact.repo, 201),
    pr_number: artifact.number,
    pr_url: bounded(artifact.url, 512),
    pr_base: bounded(artifact.base, 201),
    pr_head_oid: bounded(artifact.head_oid, 80),
    pr_created_at: bounded(artifact.created_at, 40),
  };
  if (artifact.merge_sha) fields.pr_merge_sha = bounded(artifact.merge_sha, 80);
  if (artifact.merged_at) fields.pr_merged_at = bounded(artifact.merged_at, 40);
  if (dispatchAt) fields.pr_dispatch_at = bounded(dispatchAt, 40);
  return fields;
}

function durablePrFields(input) {
  const data = parseFrontmatter(input.cardContent).data || {};
  const fields = {};
  if (typeof data.branch === "string" && data.branch.trim()) {
    fields.branch = bounded(data.branch, 201);
  }
  const prs = Array.isArray(data.prs)
    ? data.prs.map(String).filter(Boolean)
    : typeof data.prs === "string" && data.prs.trim()
      ? [data.prs.trim()]
      : [];
  if (prs.length > 0) fields.prs = prs.slice(0, 16).map((value) => bounded(value, 32));
  if (typeof data.pr_dispatch_at === "string" && data.pr_dispatch_at.trim()) {
    fields.pr_dispatch_at = bounded(data.pr_dispatch_at, 40);
  }
  for (const [key, max] of [
    ["pr_repo", 201],
    ["pr_number", 32],
    ["pr_url", 512],
    ["pr_base", 201],
    ["pr_head_oid", 80],
    ["pr_created_at", 40],
    ["pr_merge_sha", 80],
    ["pr_merged_at", 40],
  ]) {
    if (data[key] !== undefined && String(data[key]).trim()) {
      fields[key] = bounded(data[key], max);
    }
  }
  return fields;
}

function blockerFields(blocker) {
  return {
    blocker_code: bounded(blocker.code, 80),
    blocker_reason: bounded(blocker.reason, 2000),
    blocker_remediation: bounded(blocker.remediation, 4000),
  };
}

function transitionResult(input, fields, event, artifactWrites = [], allowedArtifactPaths = []) {
  let cardContent;
  try {
    cardContent = rewriteFrontmatter(input.cardContent, fields);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  return {
    ok: true,
    transition: {
      card_write: {
        relative_path: input.cardRelativePath,
        expected_revision: input.expectedCardRevision,
        content: cardContent,
      },
      artifact_writes: artifactWrites,
    },
    event: { schema_version: 1, terminal: true, ...event },
    allowedArtifactPaths,
    artifactHashes: artifactWrites.map((write) => write.sha256).filter(Boolean),
  };
}

function unchangedResult(input, stage, status) {
  return {
    ok: true,
    transition: {
      card_write: {
        relative_path: input.cardRelativePath,
        expected_revision: input.expectedCardRevision,
        content: input.cardContent,
      },
      artifact_writes: [],
    },
    event: {
      schema_version: 1,
      terminal: true,
      status,
      outcome: `${stage}-${status}`,
      summary: bounded(input.result.summary, 2000),
    },
    allowedArtifactPaths: [],
    artifactHashes: [],
  };
}

function documentDestination(pmRelative, stage, cardRelativePath) {
  const cardName = path.posix.basename(String(cardRelativePath || ""), ".md");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(cardName)) return "";
  const root = stage === "rfc" ? "backlog/rfcs" : "evidence/research";
  return path.posix.join(pmRelative, root, `${cardName}${stage === "rfc" ? ".html" : ".md"}`);
}

function buildStageTransition(input) {
  const { result } = input;
  if (!result || result.run_id !== input.runId) return { ok: false, reason: "result/run mismatch" };
  const stage = result.stage;
  const status = result.status;

  if (status === "failed" || status === "noop") return unchangedResult(input, stage, status);

  if (status === "failed-contract") {
    const blocker = {
      code: "failed-contract",
      reason: `${bounded(result.failure_code, 80)}: ${bounded(result.summary, 1900)}`,
      remediation: bounded(result.remediation, 4000),
    };
    const preservedPr = ["ship", "review"].includes(stage) ? durablePrFields(input) : {};
    return transitionResult(
      input,
      {
        ...baseFields(input, "needs-human", "failed-contract"),
        ...preservedPr,
        ...blockerFields(blocker),
      },
      { status: "failed-contract", outcome: "failed-contract", summary: blocker.reason }
    );
  }

  if (status === "blocked") {
    const fields = {
      ...baseFields(input, "needs-human", `${stage}-blocked`),
      ...(["ship", "review"].includes(stage) ? durablePrFields(input) : {}),
      ...blockerFields(result.blocker),
    };
    return transitionResult(input, fields, {
      status: "blocked",
      outcome: `${stage}-blocked`,
      summary: bounded(result.summary, 2000),
      blocker: result.blocker,
    });
  }

  if (stage === "dev" && status === "shipped") {
    return transitionResult(
      input,
      {
        ...baseFields(input, "shipping", "dev-shipped"),
        ...prFields(result.artifacts, input.dispatchAt),
      },
      { status: "completed", outcome: "dev-shipped", summary: bounded(result.summary, 2000) }
    );
  }

  if ((stage === "ship" || stage === "review") && status === "merged") {
    return transitionResult(
      input,
      {
        ...baseFields(input, "done", `${stage}-merged`),
        ...prFields(result.artifacts, input.prDispatchAt),
      },
      { status: "completed", outcome: `${stage}-merged`, summary: bounded(result.summary, 2000) }
    );
  }

  if ((stage === "ship" || stage === "review") && status === "ready-for-human") {
    const blocker = {
      code: "merge-approval-required",
      reason: "The pull request is verified and ready for a human merge decision.",
      remediation: "Review and merge the verified pull request, or return the card to shipping.",
    };
    return transitionResult(
      input,
      {
        ...baseFields(input, "needs-human", `${stage}-ready-for-human`),
        ...prFields(result.artifacts, input.prDispatchAt),
        ...blockerFields(blocker),
      },
      {
        status: "ready-for-human",
        outcome: `${stage}-ready-for-human`,
        summary: bounded(result.summary, 2000),
      }
    );
  }

  if ((stage === "ship" || stage === "review") && status === "waiting") {
    const now = input.now instanceof Date ? input.now : new Date();
    const retryMs = Date.parse(result.retry_after);
    const horizonMs = Math.max(1, Number(input.shipPollHorizonSeconds || 3600)) * 1000;
    if (
      !Number.isFinite(retryMs) ||
      retryMs <= now.getTime() ||
      retryMs > now.getTime() + horizonMs
    ) {
      return { ok: false, reason: "retry_after is outside the configured ship poll horizon" };
    }
    return transitionResult(
      input,
      {
        ...baseFields(input, "shipping", `${stage}-waiting`),
        ...prFields(result.artifacts, input.prDispatchAt),
        retry_after: result.retry_after,
      },
      { status: "waiting", outcome: `${stage}-waiting`, summary: bounded(result.summary, 2000) }
    );
  }

  if (
    (stage === "rfc" && ["artifact-ready", "needs-approval"].includes(status)) ||
    (stage === "research" && status === "artifact-ready")
  ) {
    const destination = documentDestination(input.pmRelative, stage, input.cardRelativePath);
    if (!destination || !input.verifiedArtifact || !input.verifiedArtifact.content) {
      return { ok: false, reason: "verified document artifact is required" };
    }
    if (input.verifiedArtifact.sha256.toLowerCase() !== result.artifacts.sha256.toLowerCase()) {
      return { ok: false, reason: "verified document artifact hash mismatch" };
    }
    const code = stage === "rfc" ? "rfc-approval-required" : "research-review-required";
    const blocker = {
      code,
      reason:
        stage === "rfc"
          ? "The RFC artifact requires explicit human approval."
          : "The research artifact requires human review.",
      remediation:
        stage === "rfc"
          ? "Review and approve the RFC before implementation."
          : "Review the findings and decide how to use them.",
    };
    const write = {
      relative_path: destination,
      content: Buffer.from(input.verifiedArtifact.content).toString("utf8"),
      sha256: input.verifiedArtifact.sha256,
    };
    return transitionResult(
      input,
      {
        ...baseFields(input, "needs-human", `${stage}-artifact-ready`),
        ...blockerFields(blocker),
        artifact_path: destination,
        artifact_sha256: input.verifiedArtifact.sha256,
      },
      {
        status: "artifact-ready",
        outcome: `${stage}-artifact-ready`,
        summary: bounded(result.summary, 2000),
        artifact_path: destination,
        artifact_sha256: input.verifiedArtifact.sha256,
      },
      [write],
      [destination]
    );
  }

  return { ok: false, reason: `no transition for ${stage}/${status}` };
}

function buildContractFailureResult(input) {
  return {
    version: 1,
    run_id: input.runId,
    card_id: input.cardId,
    stage: input.stage,
    status: "failed-contract",
    failure_code: bounded(input.code, 80),
    summary: bounded(input.reason, 2000),
    remediation: bounded(input.remediation || "Inspect the preserved run evidence.", 4000),
    gates: [],
    usage: { input_tokens: null, output_tokens: null, total_tokens: null },
  };
}

module.exports = {
  CANONICAL_CARD_STATUSES,
  MANAGED_FIELDS,
  buildContractFailureResult,
  buildStageTransition,
  isNeedsHumanStatus,
  normalizeStatus,
  rewriteFrontmatter,
};
