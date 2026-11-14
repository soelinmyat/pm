"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  createSession,
  applyRouting,
  grantAuthority,
  writeSession,
} = require("../../scripts/lib/dev-session-schema");
const { createReleaseTransaction } = require("../../scripts/lib/release-transaction-schema");
const CLI = path.resolve(__dirname, "../../scripts/dev-session.js");
const digest = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-require-qa-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  const remote = `${root}-origin.git`;
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git("init", "--bare", "-b", "main", remote);
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  git("checkout", "-b", "fix/transport");
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts/transport.js"), "module.exports = true;\n");
  git("add", "scripts/transport.js");
  git("commit", "-m", "transport fixture");
  const head = git("rev-parse", "HEAD");
  let session = applyRouting(createSession({ slug: "transport", sourceDir: root }), {
    kind: "bug",
    size: "S",
    risk: { behavioral: 1, ui: 0 },
    acceptance_criteria: ["Transport failures remain retryable"],
    work_units: [],
  });
  session = grantAuthority(
    session,
    ["push_feature_branch", "create_pr", "merge"],
    "fixture authorization"
  );
  session.phase = "ship";
  session.status = "blocked";
  session.blockers.push({
    code: "pm-unrouted-mobile-qa-contract",
    reason: "missing first QA",
    phase: "ship",
    recorded_at: session.updated_at,
  });
  const runtime = { provider: "codex", model: "inherit", reasoning: "inherit", session_id: null };
  session.attempts.push({
    phase: "review",
    attempt: 1,
    status: "passed",
    summary: "fixture reviewed",
    commit: head,
    recorded_at: session.updated_at,
    runtime,
  });
  for (const phase of ["implementation", "review"])
    session.evidence[phase] = {
      commit: head,
      records: [
        {
          kind: phase === "review" ? "review" : "test",
          command: "fixture",
          exit_code: 0,
          artifact: "README.md",
        },
      ],
      recorded_at: session.updated_at,
    };
  const sessionPath = path.join(root, ".pm/dev-sessions/transport/session.json");
  writeSession(sessionPath, session);
  const transaction = createReleaseTransaction({
    runId: session.run_id,
    slug: session.slug,
    repository: "test/repo",
    deliveryRemote: "origin",
    pushUrlSha256: `sha256:${"a".repeat(64)}`,
    headBranch: "fix/transport",
    baseBranch: "main",
    releaseMode: "delivery-only",
    manifestHashes: [],
    preparedCommit: head,
  });
  const transactionPath = path.join(path.dirname(sessionPath), "ship/release-transaction.json");
  fs.mkdirSync(path.dirname(transactionPath), { recursive: true });
  fs.writeFileSync(transactionPath, JSON.stringify(transaction, null, 2) + "\n");
  const before = fs.readFileSync(sessionPath);
  const beforeTransaction = fs.readFileSync(transactionPath);
  const args = [
    "require-qa",
    "--session",
    sessionPath,
    "--expected-session-sha256",
    digest(before),
    "--commit",
    head,
    "--reason",
    "Run first QA without skipping the mobile gate",
    "--json",
  ];
  return {
    root,
    session,
    sessionPath,
    transactionPath,
    before,
    beforeTransaction,
    head,
    args,
    run: (extra = args) =>
      spawnSync(process.execPath, [CLI, ...extra], { cwd: root, encoding: "utf8" }),
  };
}
module.exports = { fixture, digest };
