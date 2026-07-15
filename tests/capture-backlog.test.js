"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  captureBacklogItem,
  enrichBacklogItem,
  nextBacklogId,
  slugify,
} = require("../scripts/capture-backlog.js");
const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");

const execFileAsync = promisify(execFile);
const captureCli = path.join(__dirname, "..", "scripts", "capture-backlog.js");

function makeTmpPm() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-backlog-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  return {
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("PM-51 capture: slugify handles punctuation and spaces", () => {
  assert.equal(slugify("Bump ESLint to v10"), "bump-eslint-to-v10");
  assert.equal(slugify("  Fix: header —  broken link"), "fix-header-broken-link");
  assert.equal(slugify("CSV export error"), "csv-export-error");
});

test("PM-51 capture: nextBacklogId starts at PM-001 when backlog empty", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  assert.equal(nextBacklogId(pmDir), "PM-001");
});

test("PM-51 capture: nextBacklogId skips past existing max", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  fs.writeFileSync(path.join(pmDir, "backlog", "a.md"), "---\ntype: backlog\nid: PM-003\n---\n");
  fs.writeFileSync(path.join(pmDir, "backlog", "b.md"), "---\ntype: backlog\nid: PM-007\n---\n");
  assert.equal(nextBacklogId(pmDir), "PM-008");
});

test("PM-51 capture: writes task item with kind=task and defaults", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "task",
    title: "Bump ESLint to v10",
    outcome: "ESLint is on v10",
  });
  assert.equal(result.slug, "bump-eslint-to-v10");
  assert.equal(result.id, "PM-001");
  const content = fs.readFileSync(result.filePath, "utf8");
  const parsed = parseFrontmatter(content);
  assert.equal(parsed.data.kind, "task");
  assert.equal(parsed.data.status, "proposed");
  assert.equal(parsed.data.priority, "medium");
  assert.deepEqual(parsed.data.labels, ["chore"]);
  assert.equal(parsed.data.title, "Bump ESLint to v10");
});

test("PM-51 capture: writes bug item with priority=high override", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "bug",
    title: "CSV export fails on UTF-8",
    priority: "high",
    labels: ["bug"],
    body: "## Observed\n\nExport truncates Unicode.\n",
  });
  const parsed = parseFrontmatter(fs.readFileSync(result.filePath, "utf8"));
  assert.equal(parsed.data.kind, "bug");
  assert.equal(parsed.data.priority, "high");
  assert.deepEqual(parsed.data.labels, ["bug"]);
  assert.match(parsed.body, /## Observed/);
});

test("PM-51 capture: refuses to overwrite existing file", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  captureBacklogItem(pmDir, { kind: "task", title: "Dup" });
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Dup" }),
    /refusing to overwrite/
  );
});

test("PM-51 capture: bug kind defaults labels to [bug] when not passed", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "bug",
    title: "Something broke",
  });
  const parsed = parseFrontmatter(fs.readFileSync(result.filePath, "utf8"));
  assert.deepEqual(parsed.data.labels, ["bug"]);
  assert.equal(parsed.data.priority, "high");
});

test("PM-51 capture: task kind defaults labels to [chore]", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "task",
    title: "Chore work",
  });
  const parsed = parseFrontmatter(fs.readFileSync(result.filePath, "utf8"));
  assert.deepEqual(parsed.data.labels, ["chore"]);
});

test("PM-51 capture: slug collision does not burn the next id", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const first = captureBacklogItem(pmDir, { kind: "task", title: "Bump Dep" });
  assert.equal(first.id, "PM-001");
  // Second capture with same title collides on slug. We expect it to throw
  // BEFORE allocating PM-002, so the next successful capture still gets PM-002.
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Bump Dep" }),
    /refusing to overwrite/
  );
  const second = captureBacklogItem(pmDir, { kind: "task", title: "Different title" });
  assert.equal(second.id, "PM-002", "id must not be burned on slug collision");
});

test("PM-51 capture: captured file passes validator", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  captureBacklogItem(pmDir, {
    kind: "task",
    title: "Version bump test",
    outcome: "bumped",
  });
  const { execFileSync } = require("child_process");
  const out = execFileSync(
    "node",
    [path.join(__dirname, "..", "scripts", "validate.js"), "--dir", pmDir],
    { encoding: "utf8" }
  );
  const result = JSON.parse(out);
  assert.equal(result.ok, true, JSON.stringify(result.details));
});

test("capture rejects malformed policy and path inputs before writing", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);

  assert.throws(() => captureBacklogItem(pmDir, { kind: "proposal", title: "No" }), /kind/);
  assert.throws(() => captureBacklogItem(pmDir, { kind: "task", title: "   " }), /title/);
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "No", priority: "immediate" }),
    /priority/
  );
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "No", slug: "../escape" }),
    /slug/
  );
  assert.throws(() => captureBacklogItem(pmDir, { kind: "task", title: "No", id: "PM-one" }), /id/);
  assert.throws(() => captureBacklogItem(pmDir, { kind: "task", title: "No", id: "PM-000" }), /id/);
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "No", id: "PM-9007199254740993" }),
    /id/
  );
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "No", body: "bad\0body" }),
    /NUL/
  );
  assert.deepEqual(fs.readdirSync(path.join(pmDir, "backlog")), []);
});

test("capture rejects a symlinked backlog directory", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "capture-backlog-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.rmSync(path.join(pmDir, "backlog"), { recursive: true });
  fs.symlinkSync(outside, path.join(pmDir, "backlog"));

  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Escape" }),
    /backlog.*real directory|ancestor/
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("capture rejects a symlinked PM root and existing Markdown symlinks", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const linkedRoot = `${pmDir}-link`;
  fs.symlinkSync(pmDir, linkedRoot);
  assert.throws(
    () => captureBacklogItem(linkedRoot, { kind: "task", title: "Root escape" }),
    /pmDir must be a real directory/
  );

  const outside = path.join(path.dirname(pmDir), "outside.md");
  fs.writeFileSync(outside, "---\ntype: backlog\nid: PM-001\n---\n");
  fs.symlinkSync(outside, path.join(pmDir, "backlog", "linked.md"));
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Sibling escape" }),
    /symlink|regular file/i
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "---\ntype: backlog\nid: PM-001\n---\n");
});

test("explicit IDs cannot duplicate an existing backlog ID", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  captureBacklogItem(pmDir, { kind: "task", title: "First", id: "PM-001" });
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "bug", title: "Second", id: "PM-001" }),
    /id PM-001 already exists|id must equal next allocated id PM-002/
  );
  assert.equal(fs.existsSync(path.join(pmDir, "backlog", "second.md")), false);
});

test("explicit IDs must equal the next locked allocation", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Jump", id: "PM-999999" }),
    /id must equal next allocated id PM-001/
  );
});

test("parallel CLI captures serialize ID allocation", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const captures = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      execFileAsync(process.execPath, [
        captureCli,
        "--pm-dir",
        pmDir,
        "--kind",
        index % 2 === 0 ? "task" : "bug",
        "--title",
        `Parallel capture ${index}`,
      ])
    )
  );
  const receipts = captures.map(({ stdout }) => JSON.parse(stdout));
  const ids = receipts.map((receipt) => receipt.id).sort();
  assert.deepEqual(
    ids,
    Array.from({ length: 12 }, (_, index) => `PM-${String(index + 1).padStart(3, "0")}`)
  );
});

test("parallel first captures safely initialize a missing backlog directory", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  fs.rmSync(path.join(pmDir, "backlog"), { recursive: true });
  const captures = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      execFileAsync(process.execPath, [
        captureCli,
        "--pm-dir",
        pmDir,
        "--kind",
        "task",
        "--title",
        `Cold capture ${index}`,
      ])
    )
  );
  assert.equal(new Set(captures.map(({ stdout }) => JSON.parse(stdout).id)).size, 8);
});

test("same-slug concurrent capture has one winner and consumes one ID", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      execFileAsync(process.execPath, [
        captureCli,
        "--pm-dir",
        pmDir,
        "--kind",
        "task",
        "--title",
        "Same slug",
      ])
    )
  );
  assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 5);
  const next = captureBacklogItem(pmDir, { kind: "task", title: "Next slug" });
  assert.equal(next.id, "PM-002");
});

test("CLI rejects unknown, conflicting, and action-incompatible flags", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  await assert.rejects(
    execFileAsync(process.execPath, [
      captureCli,
      "--pm-dir",
      pmDir,
      "--kind",
      "task",
      "--title",
      "No",
      "--wat",
      "yes",
    ]),
    /unknown option --wat/
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      captureCli,
      "--pm-dir",
      pmDir,
      "--kind",
      "task",
      "--title",
      "No",
      "--body",
      "a",
      "--body-file",
      __filename,
    ]),
    /body and --body-file cannot be combined/
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      captureCli,
      "--action",
      "enrich",
      "--pm-dir",
      pmDir,
      "--kind",
      "task",
      "--slug",
      "missing",
      "--expected-sha256",
      `sha256:${"a".repeat(64)}`,
      "--title",
      "No",
    ]),
    /option --title is not valid for enrich/
  );
});

test("CLI body-file input must be a bounded regular file", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const root = path.dirname(pmDir);
  const body = path.join(root, "body.md");
  const linked = path.join(root, "body-link.md");
  const oversized = path.join(root, "oversized.md");
  fs.writeFileSync(body, "literal body\n");
  fs.symlinkSync(body, linked);
  fs.writeFileSync(oversized, "x".repeat(64 * 1024 + 1));

  for (const invalid of [root, linked]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        captureCli,
        "--pm-dir",
        pmDir,
        "--kind",
        "task",
        "--title",
        "Unsafe body",
        "--body-file",
        invalid,
      ]),
      /body-file must be a regular file/
    );
  }
  await assert.rejects(
    execFileAsync(process.execPath, [
      captureCli,
      "--pm-dir",
      pmDir,
      "--kind",
      "task",
      "--title",
      "Oversized body",
      "--body-file",
      oversized,
    ]),
    /body-file exceeds 65536-byte budget/
  );
  assert.deepEqual(fs.readdirSync(path.join(pmDir, "backlog")), []);
});

test("request-file captures adversarial text literally without shell evaluation", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const sentinel = path.join(path.dirname(pmDir), "must-not-exist");
  const requestPath = path.join(path.dirname(pmDir), "request.json");
  const title = '--title "quoted" $(touch must-not-exist) `touch must-not-exist`';
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      action: "create",
      kind: "task",
      title,
      outcome: "Keep $() and backticks literal",
    })
  );
  fs.chmodSync(requestPath, 0o600);
  const { stdout } = await execFileAsync(
    process.execPath,
    [captureCli, "--pm-dir", pmDir, "--request-file", requestPath],
    { cwd: path.dirname(pmDir) }
  );
  const receipt = JSON.parse(stdout);
  const parsed = parseFrontmatter(fs.readFileSync(receipt.filePath, "utf8"));
  assert.equal(parsed.data.title, title);
  assert.equal(fs.existsSync(sentinel), false);
});

test("request-file input must be private and descriptor-bounded", async (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const requestPath = path.join(path.dirname(pmDir), "public-request.json");
  fs.writeFileSync(
    requestPath,
    JSON.stringify({ action: "create", kind: "task", title: "Private request" }),
    { mode: 0o644 }
  );
  fs.chmodSync(requestPath, 0o644);

  await assert.rejects(
    execFileAsync(process.execPath, [captureCli, "--pm-dir", pmDir, "--request-file", requestPath]),
    /request-file path is not a restrictive regular file/
  );
  assert.deepEqual(fs.readdirSync(path.join(pmDir, "backlog")), []);
});

test("JS APIs reject unknown keys and enrich validates the complete existing artifact", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Typo", prioirty: "high" }),
    /unknown option prioirty/
  );
  const captured = captureBacklogItem(pmDir, { kind: "task", title: "Valid" });
  assert.throws(
    () =>
      enrichBacklogItem(pmDir, captured.slug, {
        kind: "task",
        expectedSha256: captured.content_sha256,
        priorty: "high",
      }),
    /unknown option priorty/
  );
  const content = fs
    .readFileSync(captured.filePath, "utf8")
    .replace('status: "proposed"', 'status: "done"');
  fs.writeFileSync(captured.filePath, content);
  const corruptSha = `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
  assert.throws(
    () =>
      enrichBacklogItem(pmDir, captured.slug, {
        kind: "task",
        expectedSha256: corruptSha,
        priority: "high",
      }),
    /status must be proposed/
  );
  assert.equal(fs.readFileSync(captured.filePath, "utf8"), content);
});

test("enrichment uses expected content identity and preserves capture policy", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const captured = captureBacklogItem(pmDir, { kind: "bug", title: "Export broke" });
  const before = fs.readFileSync(captured.filePath);
  const expectedSha256 = `sha256:${crypto.createHash("sha256").update(before).digest("hex")}`;
  const enriched = enrichBacklogItem(pmDir, captured.slug, {
    kind: "bug",
    expectedSha256,
    priority: "critical",
    labels: ["bug", "customer-impact"],
    body: "## Observed\n\nBlank file.\n\n## Expected\n\nA CSV.\n\n## Reproduction\n\nExport once.\n",
  });
  const parsed = parseFrontmatter(fs.readFileSync(enriched.filePath, "utf8"));
  assert.equal(parsed.data.id, "PM-001");
  assert.equal(parsed.data.kind, "bug");
  assert.equal(parsed.data.priority, "critical");
  assert.deepEqual(parsed.data.labels, ["bug", "customer-impact"]);
  assert.match(parsed.body, /## Reproduction\n\nExport once/);

  assert.throws(
    () =>
      enrichBacklogItem(pmDir, captured.slug, {
        kind: "bug",
        expectedSha256,
        priority: "low",
      }),
    /changed since capture/
  );
  assert.equal(
    parseFrontmatter(fs.readFileSync(enriched.filePath, "utf8")).data.priority,
    "critical"
  );
});

test("bug enrichment preserves the kind-owned label when adding extras", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const captured = captureBacklogItem(pmDir, { kind: "bug", title: "Keep bug label" });
  enrichBacklogItem(pmDir, captured.slug, {
    kind: "bug",
    expectedSha256: captured.content_sha256,
    labels: ["customer-impact"],
  });
  const parsed = parseFrontmatter(fs.readFileSync(captured.filePath, "utf8"));
  assert.deepEqual(parsed.data.labels, ["bug", "customer-impact"]);
});

test("wrong-kind enrichment preserves the exact captured bytes", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const captured = captureBacklogItem(pmDir, { kind: "task", title: "Keep identity" });
  const before = fs.readFileSync(captured.filePath);
  assert.throws(
    () =>
      enrichBacklogItem(pmDir, captured.slug, {
        kind: "bug",
        expectedSha256: captured.content_sha256,
        priority: "critical",
      }),
    /expected kind bug, found task/
  );
  assert.deepEqual(fs.readFileSync(captured.filePath), before);
});

test("enrichment rejects a no-op request", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const captured = captureBacklogItem(pmDir, { kind: "task", title: "One" });
  assert.throws(
    () =>
      enrichBacklogItem(pmDir, captured.slug, {
        kind: "task",
        expectedSha256: captured.content_sha256,
      }),
    /at least one change/
  );
});

test("bug body parsing ignores section-looking text inside fenced reproduction", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const body = [
    "## Observed",
    "",
    "Export fails.",
    "",
    "## Expected",
    "",
    "Export succeeds.",
    "",
    "## Reproduction",
    "",
    "```md",
    "## Observed",
    "literal fixture text",
    "```",
    "",
  ].join("\n");
  const captured = captureBacklogItem(pmDir, { kind: "bug", title: "Fenced repro", body });
  const parsed = parseFrontmatter(fs.readFileSync(captured.filePath, "utf8"));
  assert.match(parsed.body, /```md\n## Observed\nliteral fixture text\n```/);
});
