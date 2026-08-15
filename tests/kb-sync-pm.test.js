"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toRecord,
  syncIdFor,
  recordToMarkdown,
  recordPath,
  emitYaml,
  resolveConfig,
  scanKbFiles,
} = require("../scripts/kb-sync-pm.js");
const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");

test("syncIdFor prefers frontmatter id, falls back to path", () => {
  assert.equal(syncIdFor("backlog/foo.md", { id: "PM-161" }), "kb:PM-161");
  assert.equal(syncIdFor("evidence/notes/foo.md", {}), "kb:evidence/notes/foo.md");
});

test("backlog file maps to backlog_item with status/kind/tags mapping", () => {
  const fm = {
    type: "backlog",
    id: "PM-161",
    title: "Knowledge Base Sync",
    outcome: "KB changes auto-sync",
    status: "drafted",
    priority: "high",
    labels: ["infrastructure", "sync"],
    research_refs: ["evidence/research/kb-sync.md"],
  };
  const record = toRecord("backlog/knowledge-base-sync.md", fm, "## Outcome\n\nBody.");
  assert.equal(record.type, "backlog_item");
  assert.equal(record.payload.sync_id, "kb:PM-161");
  assert.equal(record.payload.status, "planned"); // drafted → planned
  assert.equal(record.payload.kind, "proposal"); // has research_refs
  assert.deepEqual(record.payload.tags, ["infrastructure", "sync"]);
  assert.deepEqual(record.refs, [{ path: "evidence/research/kb-sync.md", kind: "source" }]);
  assert.equal(record.payload.meta.kb_path, "backlog/knowledge-base-sync.md");
});

test("backlog without refs is a task; bug label wins; unknown status → idea", () => {
  const task = toRecord("backlog/a.md", { type: "backlog", title: "A", status: "weird" }, "");
  assert.equal(task.payload.kind, "task");
  assert.equal(task.payload.status, "idea");
  const bug = toRecord("backlog/b.md", { type: "backlog", title: "B", labels: ["bug"] }, "");
  assert.equal(bug.payload.kind, "bug");
});

test("evidence/research file maps to research with question fallback", () => {
  const fm = {
    type: "evidence",
    evidence_type: "research",
    topic: "Coding Agent Evals",
    source_origin: "external",
    sources: ["https://example.com/a", { url: "https://example.com/b", accessed: "2026-04-11" }],
  };
  const record = toRecord("evidence/research/coding-agent-evals.md", fm, "Findings.");
  assert.equal(record.type, "research");
  assert.equal(record.payload.title, "Coding Agent Evals");
  assert.equal(record.payload.question, "Coding Agent Evals");
  assert.equal(record.payload.source_origin, "external");
  assert.deepEqual(record.payload.source_urls, ["https://example.com/a", "https://example.com/b"]);
});

test("plain evidence maps source_type from subdir", () => {
  const record = toRecord(
    "evidence/user-feedback/churn-note.md",
    { type: "evidence", topic: "Churn note", created: "2026-04-02" },
    "They churned."
  );
  assert.equal(record.type, "evidence");
  assert.equal(record.payload.source_type, "feedback");
  assert.equal(record.payload.captured_at, "2026-04-02");
});

test("insight maps sources to evidence links", () => {
  const fm = {
    type: "insight",
    topic: "Landscape",
    status: "active",
    confidence: "high",
    sources: ["evidence/research/landscape.md"],
  };
  const record = toRecord("insights/product/landscape.md", fm, "Claim.");
  assert.equal(record.type, "insight");
  assert.equal(record.payload.status, "active");
  assert.deepEqual(record.refs, [{ path: "evidence/research/landscape.md", kind: "evidence" }]);
});

test("non-record files are skipped", () => {
  assert.equal(toRecord("strategy.md", { generated: "2026-04-25" }, "index"), null);
});

test("recordToMarkdown round-trips preserved frontmatter with server overrides", () => {
  const fm = {
    type: "backlog",
    id: "PM-161",
    title: "Old title",
    status: "drafted",
    priority: "high",
    labels: ["sync"],
  };
  const record = {
    type: "backlog_item",
    title: "New title",
    outcome: "Outcome",
    status: "in-progress",
    priority: "high",
    tags: ["sync"],
    body: "Updated body.",
    updated_at: "2026-08-15T10:00:00Z",
    meta: { kb_path: "backlog/foo.md", fm },
  };
  const markdown = recordToMarkdown(record);
  const parsed = parseFrontmatter(markdown);
  assert.equal(parsed.data.title, "New title");
  assert.equal(parsed.data.status, "in-progress");
  assert.equal(parsed.data.id, "PM-161"); // local-only field preserved
  assert.equal(parsed.data.type, "backlog");
  assert.equal(parsed.data.updated, "2026-08-15");
  assert.equal(parsed.body.trim(), "Updated body.");
});

test("recordPath uses kb_path when present, slugs server-born records by type", () => {
  assert.equal(
    recordPath({ type: "insight", meta: { kb_path: "insights/product/x.md" } }),
    "insights/product/x.md"
  );
  assert.equal(
    recordPath({ type: "backlog_item", title: "Ship It: Now!", meta: {} }),
    "backlog/ship-it-now.md"
  );
  assert.equal(recordPath({ type: "research", title: "Q", meta: null }), "evidence/research/q.md");
});

test("status maps cover the canonical local vocabulary in both directions", () => {
  const { BACKLOG_STATUS, LOCAL_STATUS } = require("../scripts/kb-sync-pm.js");
  const { CANONICAL_CARD_STATUSES } = require("../scripts/loop-card-state.js");
  for (const status of CANONICAL_CARD_STATUSES)
    assert.ok(BACKLOG_STATUS[status], `push map missing local status ${status}`);
  for (const [server, local] of Object.entries(LOCAL_STATUS))
    assert.ok(
      CANONICAL_CARD_STATUSES.includes(local),
      `pull map sends server ${server} to non-canonical ${local}`
    );
});

test("local-only statuses push as active server statuses, never idea", () => {
  const shipping = toRecord(
    "backlog/a.md",
    { type: "backlog", title: "A", status: "shipping" },
    ""
  );
  assert.equal(shipping.payload.status, "in-progress");
  const needsHuman = toRecord(
    "backlog/b.md",
    { type: "backlog", title: "B", status: "needs-human" },
    ""
  );
  assert.equal(needsHuman.payload.status, "blocked");
});

test("server-only statuses pull as canonical local statuses", () => {
  const record = {
    type: "backlog_item",
    title: "T",
    outcome: "O",
    status: "blocked",
    priority: null,
    tags: [],
    body: "Body.",
    updated_at: "2026-08-15T10:00:00Z",
    meta: { kb_path: "backlog/t.md", fm: { type: "backlog", title: "T", status: "in-progress" } },
  };
  assert.equal(parseFrontmatter(recordToMarkdown(record)).data.status, "needs-human");
  assert.equal(
    parseFrontmatter(recordToMarkdown({ ...record, status: "canceled" })).data.status,
    "needs-human"
  );
});

test("push upserts in dependency order with links; pull writes conflict artifact", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { push, pull } = require("../scripts/kb-sync-pm.js");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-"));
  const pmDir = path.join(tmp, "pm");
  const stateDir = path.join(tmp, ".pm");
  fs.mkdirSync(path.join(pmDir, "evidence", "research"), { recursive: true });
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "evidence", "research", "study.md"),
    "---\ntype: evidence\nevidence_type: research\ntopic: Study\nsource_origin: external\nsources:\n  - https://x.com\n---\n\nFindings.\n"
  );
  fs.writeFileSync(
    path.join(pmDir, "backlog", "feature.md"),
    "---\ntype: backlog\nid: PM-1\ntitle: Feature\noutcome: Works\nstatus: proposed\npriority: high\nlabels: []\nresearch_refs:\n  - evidence/research/study.md\n---\n\nScope.\n"
  );

  const created = [];
  let nextId = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        const body = JSON.parse(raw);
        created.push(body);
        res.end(JSON.stringify({ id: `rec_${nextId++}`, sync_id: body.sync_id }));
      } else {
        // One updated backlog record on the server side.
        res.end(
          JSON.stringify({
            records: [
              {
                id: "rec_1",
                type: "backlog_item",
                sync_id: "kb:PM-1",
                title: "Feature",
                outcome: "Works",
                status: "in-progress",
                priority: "high",
                tags: [],
                body: "Server body.",
                updated_at: "2026-08-15T12:00:00Z",
                meta: {
                  kb_path: "backlog/feature.md",
                  fm: {
                    type: "backlog",
                    id: "PM-1",
                    title: "Feature",
                    outcome: "Works",
                    status: "proposed",
                    priority: "high",
                  },
                },
              },
            ],
            next_cursor: null,
          })
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}`, project: "test", token: "t" };

  try {
    const pushResult = await push(pmDir, stateDir, config);
    assert.equal(pushResult.ok, true);
    assert.equal(pushResult.uploaded, 2);
    // Research pushed before backlog, and the backlog carries a source link to it.
    assert.equal(created[0].type, "research");
    assert.equal(created[1].type, "backlog_item");
    assert.deepEqual(created[1].links, [{ to_id: "rec_0", kind: "source" }]);

    // Unchanged files are not re-pushed.
    const secondPush = await push(pmDir, stateDir, config);
    assert.equal(secondPush.uploaded, 0);

    // Local edit + server change → server wins, local copy preserved.
    const backlogPath = path.join(pmDir, "backlog", "feature.md");
    fs.writeFileSync(backlogPath, fs.readFileSync(backlogPath, "utf8") + "\nLocal edit.\n");
    const pullResult = await pull(pmDir, stateDir, config);
    assert.equal(pullResult.ok, true);
    assert.equal(pullResult.downloaded, 1);
    const pulled = fs.readFileSync(backlogPath, "utf8");
    assert.match(pulled, /Server body\./);
    assert.match(pulled, /status: in-progress/);
    assert.ok(fs.existsSync(backlogPath + ".local-conflict"));

    // Push after pull carries if_updated_at from the pulled server version.
    fs.writeFileSync(backlogPath, pulled + "\nMore.\n");
    const thirdPush = await push(pmDir, stateDir, config);
    assert.equal(thirdPush.ok, true);
    const last = created[created.length - 1];
    assert.equal(last.sync_id, "kb:PM-1");
    assert.equal(last.if_updated_at, "2026-08-15T12:00:00Z");
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pull disambiguates slug collisions and writes state files owner-only", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { pull } = require("../scripts/kb-sync-pm.js");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-collide-"));
  const pmDir = path.join(tmp, "pm");
  const stateDir = path.join(tmp, ".pm");
  fs.mkdirSync(pmDir, { recursive: true });

  const record = (id) => ({
    id,
    type: "backlog_item",
    sync_id: null,
    title: "Same Name",
    outcome: "Same Name",
    status: "idea",
    priority: null,
    tags: [],
    body: `Body of ${id}.`,
    updated_at: "2026-08-15T12:00:00Z",
    meta: {},
  });
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ records: [record("rec_a"), record("rec_b")], next_cursor: null }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}`, project: "test", token: "t" };

  try {
    const result = await pull(pmDir, stateDir, config);
    assert.equal(result.ok, true);
    assert.equal(result.downloaded, 2);
    const files = fs.readdirSync(path.join(pmDir, "backlog")).sort();
    assert.deepEqual(files, ["same-name-recb.md", "same-name.md"]);
    assert.match(fs.readFileSync(path.join(pmDir, "backlog", "same-name.md"), "utf8"), /rec_a/);
    assert.match(
      fs.readFileSync(path.join(pmDir, "backlog", "same-name-recb.md"), "utf8"),
      /rec_b/
    );

    // Idempotent: a second pull rewrites nothing.
    const again = await pull(pmDir, stateDir, config);
    assert.equal(again.downloaded, 0);

    // Sync state is written atomically with owner-only permissions.
    const cacheMode = fs.statSync(path.join(stateDir, "sync-pm-cache.json")).mode & 0o777;
    assert.equal(cacheMode, 0o600);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("resolveConfig surfaces each misconfiguration distinctly", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-config-"));
  const write = (sync) => fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ sync }));

  try {
    assert.match(resolveConfig(tmp).error, /no \.pm\/config\.json/);
    write({ backend: "git" });
    assert.match(resolveConfig(tmp).error, /not productmemory/);
    write({ backend: "productmemory" });
    assert.match(resolveConfig(tmp).error, /sync\.project/);

    write({ backend: "productmemory", project: "test", url: "https://pm.example.com/" });
    process.env.PRODUCTMEMORY_TOKEN = "tok";
    const config = resolveConfig(tmp);
    assert.equal(config.error, undefined);
    assert.equal(config.token, "tok");
    assert.equal(config.url, "https://pm.example.com"); // trailing slash stripped
  } finally {
    delete process.env.PRODUCTMEMORY_TOKEN;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI status reports missing token as ok:false JSON", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  // HOME points at tmp so the real ~/.pm/credentials is never consulted.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-cli-"));
  fs.mkdirSync(path.join(tmp, ".pm"));
  fs.writeFileSync(
    path.join(tmp, ".pm", "config.json"),
    JSON.stringify({ sync: { backend: "productmemory", project: "test" } })
  );

  try {
    const out = execFileSync(
      process.execPath,
      [path.resolve(__dirname, "..", "scripts", "kb-sync-pm.js"), "status"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: tmp, CLAUDE_PROJECT_DIR: tmp, PRODUCTMEMORY_TOKEN: "" },
      }
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /no productmemory token/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("push aborts on network-level failure instead of erroring per record", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { push } = require("../scripts/kb-sync-pm.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-net-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  for (const name of ["a", "b"]) {
    fs.writeFileSync(
      path.join(pmDir, "backlog", `${name}.md`),
      `---\ntype: backlog\ntitle: ${name}\n---\n\nBody.\n`
    );
  }

  try {
    const result = await push(pmDir, path.join(tmp, ".pm"), {
      url: "http://127.0.0.1:1",
      project: "test",
      token: "t",
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1); // one abort, not one error per record
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("push reports stale conflict per record without aborting", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { push } = require("../scripts/kb-sync-pm.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-stale-"));
  const pmDir = path.join(tmp, "pm");
  const stateDir = path.join(tmp, ".pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  const file = path.join(pmDir, "backlog", "a.md");
  fs.writeFileSync(file, "---\ntype: backlog\ntitle: A\n---\n\nBody.\n");

  // First (unconditional) create succeeds; any conditional write is stale.
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const body = JSON.parse(raw);
      if (body.if_updated_at) {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: { code: "stale", message: "record changed" } }));
      } else {
        res.end(
          JSON.stringify({
            id: "rec_9",
            sync_id: body.sync_id,
            updated_at: "2026-08-15T09:00:00Z",
          })
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}`, project: "test", token: "t" };

  try {
    const first = await push(pmDir, stateDir, config);
    assert.equal(first.ok, true);

    fs.appendFileSync(file, "\nLocal edit.\n");
    const second = await push(pmDir, stateDir, config);
    assert.equal(second.ok, false);
    assert.equal(second.errors.length, 1);
    assert.match(second.errors[0], /changed on server since last pull/);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("notes rollup expands into per-entry evidence records", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-notes-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(path.join(pmDir, "evidence", "notes"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "evidence", "notes", "2026-08.md"),
    [
      "---",
      "type: notes",
      "month: 2026-08",
      "---",
      "",
      "### 2026-08-14 09:30 — sales call",
      "Customer asked for CSV export.",
      "Tags: export, csv",
      "",
      "### 2026-08-15 10:00 — slack",
      "Another note.",
      "",
    ].join("\n")
  );

  try {
    const entries = scanKbFiles(pmDir);
    assert.equal(entries.length, 2);
    const [first, second] = entries;
    assert.equal(first.type, "evidence");
    assert.equal(first.payload.sync_id, "kb:evidence/notes/2026-08.md#2026-08-14 09:30");
    assert.equal(first.payload.source_type, "note");
    assert.equal(first.payload.captured_at, "2026-08-14");
    assert.equal(first.payload.body, "Customer asked for CSV export.");
    assert.deepEqual(first.payload.tags, ["export", "csv"]);
    assert.equal(second.payload.title, "Note 2026-08-15 10:00 — slack");
    assert.equal(second.payload.tags, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pull skips note-entry records instead of writing files", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { pull } = require("../scripts/kb-sync-pm.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-noteskip-"));
  const pmDir = path.join(tmp, "pm");

  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        records: [
          {
            id: "rec_5",
            type: "evidence",
            sync_id: "kb:evidence/notes/2026-08.md#2026-08-14 09:30",
            title: "Note 2026-08-14 09:30 — sales call",
            body: "Edited on server.",
            updated_at: "2026-08-15T12:00:00Z",
            meta: { kb_path: "evidence/notes/2026-08.md" },
          },
        ],
        next_cursor: null,
      })
    );
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}`, project: "test", token: "t" };

  try {
    const result = await pull(pmDir, path.join(tmp, ".pm"), config);
    assert.equal(result.ok, true);
    assert.equal(result.downloaded, 0);
    assert.ok(!fs.existsSync(path.join(pmDir, "evidence")));
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pull preserves an uncached differing local file as .local-conflict", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { pull } = require("../scripts/kb-sync-pm.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-pm-uncached-"));
  const pmDir = path.join(tmp, "pm");
  const localPath = path.join(pmDir, "backlog", "feature.md");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, "---\ntype: backlog\n---\n\nNever-synced local work.\n");

  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        records: [
          {
            id: "rec_9",
            type: "backlog_item",
            sync_id: "kb:backlog/feature.md",
            title: "Feature",
            outcome: "Feature",
            status: "planned",
            body: "Server version.",
            updated_at: "2026-08-15T12:00:00Z",
            meta: { kb_path: "backlog/feature.md" },
          },
        ],
        next_cursor: null,
      })
    );
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}`, project: "test", token: "t" };

  try {
    const result = await pull(pmDir, path.join(tmp, ".pm"), config);
    assert.equal(result.ok, true);
    assert.equal(result.downloaded, 1);
    assert.match(fs.readFileSync(localPath, "utf8"), /Server version\./);
    assert.match(
      fs.readFileSync(localPath + ".local-conflict", "utf8"),
      /Never-synced local work\./
    );
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("oversized frontmatter drops fm from meta but keeps kb_path", () => {
  const big = toRecord(
    "backlog/big.md",
    { type: "backlog", title: "Big", blob: "x".repeat(9000) },
    "Body."
  );
  assert.deepEqual(big.payload.meta, { kb_path: "backlog/big.md" });
  const small = toRecord("backlog/small.md", { type: "backlog", title: "S" }, "");
  assert.ok(small.payload.meta.fm);
});

test("emitYaml output parses back via kb-frontmatter", () => {
  const fm = {
    title: "Needs: quoting",
    labels: ["a", "b"],
    sources: [{ url: "https://x.com", accessed: "2026-01-01" }],
    count: 3,
  };
  const parsed = parseFrontmatter(`---\n${emitYaml(fm)}---\nbody`);
  assert.equal(parsed.data.title, "Needs: quoting");
  assert.deepEqual(parsed.data.labels, ["a", "b"]);
  assert.equal(parsed.data.sources[0].url, "https://x.com");
});
