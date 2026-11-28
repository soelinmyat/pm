"use strict";

// Reads the PR and CI state a standing-authorization merge is decided on from
// GitHub itself, through the `gh` CLI. merge-check grants merge authority only
// from state read here, never from a file the agent wrote.
//
// Read-only. Five `gh api` GET requests, in order (the PR again, up to twice,
// while GitHub has not computed its mergeable state):
//   repos/{owner}/{repo}                                  default branch
//   repos/{owner}/{repo}/pulls/{n}                        state, draft, base, head, mergeable
//   repos/{owner}/{repo}/branches/{base}                  required status checks and their enforcement
//   repos/{owner}/{repo}/commits/{head}/check-runs?per_page=100
//   repos/{owner}/{repo}/commits/{head}/status?per_page=100
//
// `runGh(args)` is injectable so tests never reach the network. It returns
// the shape of `spawnSync`: `{ status, stdout, stderr, error }`. Each request
// goes through pr-state's `runGhWithRetry`, so a transient 5xx, gateway error
// or timeout is retried before the read refuses; auth and 4xx answers are not.

const { spawnSync } = require("node:child_process");
const { runGhWithRetry } = require("../pr-state");

const GH_TIMEOUT_MS = 30_000;
// GitHub computes `mergeable` in the background after a PR changes, and
// answers null until it is done. The PR is read again a few times before an
// unknown state is reported, which merge-check refuses.
const MERGEABLE_ATTEMPTS = 3;
const MERGEABLE_WAIT_MS = 2000;
const MAX_GH_OUTPUT_BYTES = 8 * 1024 * 1024;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const PR_STATES = { open: "OPEN", closed: "CLOSED" };
// Commit statuses mapped onto the check-run shape the CI summary reads.
const STATUS_STATES = {
  success: { status: "completed", conclusion: "success" },
  pending: { status: "in_progress", conclusion: null },
  failure: { status: "completed", conclusion: "failure" },
  error: { status: "completed", conclusion: "error" },
};

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function defaultRunGh(args) {
  return spawnSync("gh", args, {
    encoding: "utf8",
    timeout: GH_TIMEOUT_MS,
    maxBuffer: MAX_GH_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
  });
}

class ReadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function classifyFailure(endpoint, result) {
  if (result?.error?.code === "ENOENT")
    return new ReadError("gh-unavailable", "the GitHub CLI (gh) is not installed or not on PATH");
  const stderr = String(result?.stderr || result?.error?.message || "").trim();
  const tail = stderr.slice(-300) || `exit ${result?.status ?? result?.signal ?? "unknown"}`;
  if (/HTTP 401|Bad credentials|gh auth login|not logged in|authentication required/i.test(stderr))
    return new ReadError("gh-unauthenticated", `gh is not authenticated to GitHub: ${tail}`);
  if (/rate limit|HTTP 429/i.test(stderr))
    return new ReadError("gh-rate-limited", `GitHub rate-limited the read of ${endpoint}: ${tail}`);
  if (result?.error)
    return new ReadError("github-read-failed", `gh api ${endpoint}: ${result.error.message}`);
  return new ReadError("github-read-failed", `gh api ${endpoint} failed: ${tail}`);
}

function api(runGh, sleep, endpoint) {
  let result = null;
  runGhWithRetry(["api", endpoint], {
    sleep,
    runGh: (args) => {
      result = runGh(args);
      const ok = Boolean(result) && !result.error && result.status === 0;
      return {
        code: ok ? 0 : 1,
        stdout: String(result?.stdout || ""),
        stderr: String(result?.stderr || result?.error?.message || ""),
      };
    },
  });
  if (!result || result.error || result.status !== 0) throw classifyFailure(endpoint, result);
  try {
    const value = JSON.parse(String(result.stdout || ""));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("not an object");
    return value;
  } catch (error) {
    throw new ReadError(
      "github-read-failed",
      `gh api ${endpoint} returned no JSON object: ${error.message}`
    );
  }
}

function appId(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Branch protection's required status checks. Without protection, or with no
// required check, there is nothing GitHub enforces at the merge.
function requiredChecks(branch) {
  const rules = branch?.protected === true ? branch.protection?.required_status_checks : null;
  const enforcement =
    branch?.protected === true && branch.protection?.enabled !== false
      ? typeof rules?.enforcement_level === "string"
        ? rules.enforcement_level
        : null
      : "off";
  let required = [];
  if (Array.isArray(rules?.checks) && rules.checks.length)
    required = rules.checks
      .filter((item) => typeof item?.context === "string")
      .map((item) => ({ name: item.context, app_id: appId(item.app_id) }));
  else if (Array.isArray(rules?.contexts))
    required = rules.contexts
      .filter((name) => typeof name === "string")
      .map((name) => ({ name, app_id: null }));
  return { enforcement, required };
}

// When a run started, or a status was set, in epoch ms; null when unknown.
function startedAt(value) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// GitHub judges a required check by its latest result at the head: a check
// rerun, or one run by both a push and a pull_request workflow, reports more
// than once. Results are grouped by name and source (the app, or commit
// statuses), and by name alone for a context any source may satisfy, and
// only the most recently started one is kept, so a newer pending or failed
// run always wins over an older pass. A group that cannot be ordered, because
// a time is missing or two results tie, is left whole and reads as ambiguous.
function latestPerContext(runs, required) {
  const anySource = new Set(
    required.filter((item) => item.app_id === null).map((item) => item.name)
  );
  const reduce = (list, keyOf) => {
    const groups = new Map();
    for (const item of list) {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const kept = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        kept.push(group[0]);
        continue;
      }
      const times = group.map((item) => item.started_at_ms);
      if (times.some((time) => time === null)) {
        kept.push(...group);
        continue;
      }
      const newest = Math.max(...times);
      const latest = group.filter((item) => item.started_at_ms === newest);
      kept.push(...(latest.length === 1 ? latest : group));
    }
    return kept;
  };
  const perSource = reduce(runs, (item) => JSON.stringify([item.name, item.app_id, item.kind]));
  const reduced = reduce(perSource, (item) =>
    anySource.has(item.name)
      ? JSON.stringify([item.name])
      : JSON.stringify([item.name, item.app_id, item.kind])
  );
  return reduced.map(({ started_at_ms: _time, kind: _kind, ...item }) => item);
}

function readGithubMergeObservation({
  repository,
  prNumber,
  runGh = defaultRunGh,
  now = () => new Date().toISOString(),
  sleep = defaultSleep,
} = {}) {
  const fail = (error) => ({
    observation: null,
    error: { code: error.code || "github-read-failed", message: error.message },
    source: "github",
  });
  if (typeof repository !== "string" || !REPOSITORY.test(repository) || repository.includes(".."))
    return fail(new ReadError("pr-unknown", "the delivery contract names no valid OWNER/REPO"));
  if (!Number.isSafeInteger(prNumber) || prNumber < 1)
    return fail(new ReadError("pr-unknown", "the release transaction names no verified PR number"));
  const observedAt = now();
  const get = (endpoint) => api(runGh, sleep, endpoint);
  try {
    const repo = get(`repos/${repository}`);
    let pr = get(`repos/${repository}/pulls/${prNumber}`);
    for (let attempt = 1; attempt < MERGEABLE_ATTEMPTS && pr.mergeable === null; attempt += 1) {
      sleep(MERGEABLE_WAIT_MS);
      pr = get(`repos/${repository}/pulls/${prNumber}`);
    }
    const base = typeof pr.base?.ref === "string" ? pr.base.ref : null;
    const head = typeof pr.head?.sha === "string" ? pr.head.sha : null;
    if (!base || !COMMIT.test(head || ""))
      throw new ReadError("github-read-failed", "GitHub returned a PR without a base and head");
    const branch = get(`repos/${repository}/branches/${encodeURIComponent(base)}`);
    const protection = requiredChecks(branch);
    const runs = get(`repos/${repository}/commits/${head}/check-runs?per_page=100`);
    const statuses = get(`repos/${repository}/commits/${head}/status?per_page=100`);
    const checkRuns = Array.isArray(runs.check_runs) ? runs.check_runs : null;
    const commitStatuses = Array.isArray(statuses.statuses) ? statuses.statuses : null;
    const complete =
      checkRuns !== null &&
      commitStatuses !== null &&
      Number.isSafeInteger(runs.total_count) &&
      runs.total_count <= checkRuns.length &&
      (!Number.isSafeInteger(statuses.total_count) ||
        statuses.total_count <= commitStatuses.length);
    return {
      observation: {
        repository,
        // GitHub answers a renamed repository's old path with the repository
        // itself, and names it canonically here, in GitHub's own case.
        canonical_repository:
          typeof repo.full_name === "string" && REPOSITORY.test(repo.full_name)
            ? repo.full_name
            : null,
        pr_number: prNumber,
        state: pr.merged === true ? "MERGED" : PR_STATES[pr.state] || "UNKNOWN",
        draft: pr.draft === true,
        base,
        default_branch: typeof repo.default_branch === "string" ? repo.default_branch : null,
        head_oid: head,
        head_ref: typeof pr.head?.ref === "string" ? pr.head.ref : null,
        head_repository:
          typeof pr.head?.repo?.full_name === "string" ? pr.head.repo.full_name : null,
        mergeable:
          pr.mergeable === true ? "MERGEABLE" : pr.mergeable === false ? "CONFLICTING" : "UNKNOWN",
        mergeable_state: typeof pr.mergeable_state === "string" ? pr.mergeable_state : "unknown",
        observed_at: observedAt,
        protection: {
          protected: branch.protected === true,
          required_checks_enforcement: protection.enforcement,
        },
        checks: {
          // The list is known once protection was read; whether GitHub
          // enforces it for everyone is judged separately by merge-check.
          requirements_known: ["everyone", "non_admins"].includes(protection.enforcement),
          observation_complete: complete,
          required: protection.required,
          runs: latestPerContext(
            [
              ...(checkRuns || []).map((run) => ({
                name: run?.name,
                app_id: appId(run?.app?.id),
                head_sha: run?.head_sha,
                status: run?.status,
                conclusion: run?.conclusion ?? null,
                kind: "check-run",
                started_at_ms: startedAt(run?.started_at),
              })),
              ...(commitStatuses || []).map((status) => ({
                name: status?.context,
                app_id: null,
                head_sha: head,
                ...(STATUS_STATES[status?.state] || { status: "unknown", conclusion: null }),
                kind: "status",
                started_at_ms: startedAt(status?.created_at),
              })),
            ],
            protection.required
          ),
        },
      },
      error: null,
      source: "github",
    };
  } catch (error) {
    return fail(error);
  }
}

module.exports = { defaultRunGh, readGithubMergeObservation };
