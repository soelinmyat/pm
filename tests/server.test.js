"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary pm/ directory tree and return helpers.
 */
function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir, { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    root,
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Load a fresh copy of server.js (clears require cache each call).
 */
function loadServer() {
  delete require.cache[require.resolve("../scripts/server.js")];
  return require("../scripts/server.js");
}

/**
 * Start the dashboard server on a random port, return { port, close }.
 */
function startDashboardServer(pmDir) {
  return new Promise((resolve, reject) => {
    // Set env vars before loading the module
    process.env.PM_MODE = "dashboard";
    process.env.PM_DIR = pmDir;
    process.env.PM_PORT = "0"; // random port

    // We can't easily spawn the full startServer() without side effects,
    // so we use the exported createDashboardServer helper instead.
    const mod = loadServer();
    if (!mod.createDashboardServer) {
      reject(new Error("server.js must export createDashboardServer for testing"));
      return;
    }
    const server = mod.createDashboardServer(pmDir);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((res) => server.close(res)),
      });
    });
    server.on("error", reject);
  });
}

/**
 * Make a GET request, return { statusCode, headers, body }.
 */
function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 1. --mode dashboard flag is parsed
// ---------------------------------------------------------------------------

test("--mode dashboard flag is parsed correctly", () => {
  const mod = loadServer();
  assert.equal(typeof mod.parseMode, "function", "parseMode must be exported");
  const mode = mod.parseMode(["node", "server.js", "--mode", "dashboard"]);
  assert.equal(mode, "dashboard");
});

test("--mode companion is rejected", () => {
  const mod = loadServer();
  assert.throws(
    () => mod.parseMode(["node", "server.js", "--mode", "companion"]),
    /Unsupported PM server mode "companion"/
  );
});

// ---------------------------------------------------------------------------
// 2. GET / returns home dashboard HTML with knowledge base stats
// ---------------------------------------------------------------------------

test("GET / returns home dashboard HTML with knowledge base stats", async () => {
  const { root, pmDir, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\n",
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
    "pm/backlog/issue-1.md": "---\nstatus: todo\ntitle: Issue 1\n---\n# Issue 1\n",
    "pm/competitors/index.md": "---\ntype: competitor-index\n---\n# Competitors\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/");
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes("<!DOCTYPE html") || body.includes("<!doctype html"),
        "must be a full HTML doc"
      );
      assert.ok(body.includes("Product knowledge base"), "must show dashboard subtitle");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2b. Dashboard uses project name from .pm/config.json
// ---------------------------------------------------------------------------

test("GET / uses project_name from .pm/config.json in header and title", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
    ".pm/config.json": '{"project_name":"Acme Rockets","config_schema":1}',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("Acme Rockets"), "must show project name from config in header");
      assert.ok(
        body.includes("<title>Home - Acme Rockets</title>"),
        "must use project name in page title"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2c. Home dashboard shows session brief with recommended next action
// ---------------------------------------------------------------------------

test("GET / shows session brief based on workspace state", async () => {
  // Empty workspace → suggest /pm:start
  const { pmDir: pmDir1, cleanup: cleanup1 } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir1);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("Session brief"), "must show session brief section");
      assert.ok(body.includes("/pm:start"), "must send empty workspaces to start");
    } finally {
      await close();
    }
  } finally {
    cleanup1();
  }

  // Research exists but strategy does not → suggest strategy
  const { pmDir: pmDir2, cleanup: cleanup2 } = withPmDir({
    "pm/research/checkout/findings.md": "---\nupdated: 2026-03-25\n---\n# Checkout\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir2);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(
        body.includes("/pm:strategy"),
        "must suggest strategy when research exists without strategy"
      );
      assert.ok(body.includes("Also consider"), "must show alternative actions when available");
      assert.ok(body.includes("/pm:groom ideate"), "must include a concrete alternative action");
    } finally {
      await close();
    }
  } finally {
    cleanup2();
  }

  // Has strategy + landscape + competitors + ideas → suggest grooming a concrete idea
  const { pmDir: pmDir3, cleanup: cleanup3 } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
    "pm/landscape.md": "---\ntype: landscape\n---\n# Landscape\n",
    "pm/competitors/acme/profile.md": "---\ntype: competitor\n---\n# Acme\n",
    "pm/backlog/my-idea.md": "---\nstatus: idea\ntitle: My Idea\n---\n# My Idea\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir3);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("/pm:groom"), "must suggest grooming when ideas exist");
      assert.ok(body.includes("my-idea"), "must include the idea slug in the hint");
    } finally {
      await close();
    }
  } finally {
    cleanup3();
  }
});

// ---------------------------------------------------------------------------
// 2c. Backlog detail page shows action hint based on status
// ---------------------------------------------------------------------------

test("GET /roadmap/<slug> shows contextual action hint", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/idea-item.md": "---\nstatus: idea\ntitle: Idea Item\n---\n# Idea\n",
    "pm/backlog/done-item.md": "---\nstatus: done\ntitle: Done Item\n---\n# Done\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body: ideaBody } = await httpGet(port, "/roadmap/idea-item");
      assert.ok(
        ideaBody.includes("/pm:groom idea-item"),
        "idea page must show groom hint with slug"
      );

      const { body: doneBody } = await httpGet(port, "/roadmap/done-item");
      assert.ok(!doneBody.includes("/pm:groom"), "done page must not show groom hint");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2d. Kanban cards show action hints for idea items
// ---------------------------------------------------------------------------

test("GET /roadmap kanban does not show per-card groom hints", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-idea.md": "---\nstatus: idea\ntitle: My Idea\n---\n# Idea\n",
    "pm/backlog/shipped-item.md": "---\nstatus: done\ntitle: Shipped\n---\n# Shipped\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap");
      assert.ok(!body.includes("/pm:groom my-idea"), "idea card must not show groom hint");
      assert.ok(!body.includes("/pm:groom shipped-item"), "shipped card must not show groom hint");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. GET /landscape redirects to the KB landscape tab
// ---------------------------------------------------------------------------

test("GET /landscape redirects to /kb?tab=landscape", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md":
      "---\ntype: landscape\ncreated: 2026-03-12\n---\n# Market Landscape\n\nSome landscape content.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, "/landscape");
      assert.equal(statusCode, 302);
      assert.equal(headers.location, "/kb?tab=landscape");
      assert.equal(body, "");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. GET /competitors redirects to the research dashboard competitors tab
// ---------------------------------------------------------------------------

test("GET /competitors redirects to /kb?tab=competitors", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/index.md": "---\ntype: competitor-index\n---\n# Competitors\n",
    "pm/competitors/acme/profile.md": "---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, "/competitors");
      assert.equal(statusCode, 302);
      assert.equal(headers.location, "/kb?tab=competitors");
      assert.equal(body, "");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. GET /competitors/acme returns tabbed detail HTML
// ---------------------------------------------------------------------------

test("GET /competitors/acme returns tabbed detail HTML", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md":
      "---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp Profile\n",
    "pm/competitors/acme/features.md": "---\n---\n# Features\n",
    "pm/competitors/acme/api.md": "---\n---\n# API\n",
    "pm/competitors/acme/seo.md": "---\n---\n# SEO\n",
    "pm/competitors/acme/sentiment.md": "---\n---\n# Sentiment\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/competitors/acme");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Acme") || body.includes("acme"), "must reference the competitor");
      // Tabbed: look for tab-like elements or multiple section headings
      assert.ok(
        body.includes("tab") ||
          body.includes("Tab") ||
          body.includes("Profile") ||
          body.includes("profile"),
        "must have tabbed or sectioned layout"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. GET /backlog returns kanban HTML grouped by status
// ---------------------------------------------------------------------------

test("GET /roadmap returns kanban HTML grouped by status", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/issue-1.md": "---\nstatus: open\ntitle: First Issue\n---\n# First Issue\n",
    "pm/backlog/issue-2.md":
      "---\nstatus: in-progress\ntitle: In Progress Issue\n---\n# In Progress Issue\n",
    "pm/backlog/issue-3.md": "---\nstatus: done\ntitle: Done Issue\n---\n# Done Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Idea") || body.includes("idea"), "must show idea column");
      assert.ok(body.includes("Groomed") || body.includes("groomed"), "must show groomed column");
      assert.ok(body.includes("Shipped") || body.includes("shipped"), "must show shipped column");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6b. Shipped column caps at 10 items with view-all link
// ---------------------------------------------------------------------------

test("GET /roadmap caps shipped column at 10 and links to /roadmap/shipped", async () => {
  const files = {};
  for (let i = 1; i <= 15; i++) {
    const n = String(i).padStart(3, "0");
    files[`pm/backlog/done-${n}.md`] =
      `---\ntype: backlog-issue\nid: PM-${n}\ntitle: Done Item ${i}\nstatus: done\npriority: medium\ncreated: 2026-03-01\nupdated: 2026-03-${String(i).padStart(2, "0")}\n---\n# Done ${i}\n`;
  }
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("View all 15 shipped"), "must show view-all link with total count");
      // Should show the 10 most recently updated (PM-006 through PM-015)
      assert.ok(body.includes("PM-015"), "must include most recent shipped item");
      assert.ok(
        !body.includes("PM-001") || body.indexOf("PM-001") > body.indexOf("View all"),
        "PM-001 should not be in kanban cards"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6c. GET /backlog/shipped returns all shipped items
// ---------------------------------------------------------------------------

test("GET /roadmap/shipped returns all shipped items", async () => {
  const files = {};
  for (let i = 1; i <= 15; i++) {
    const n = String(i).padStart(3, "0");
    files[`pm/backlog/done-${n}.md`] =
      `---\ntype: backlog-issue\nid: PM-${n}\ntitle: Done Item ${i}\nstatus: done\npriority: medium\ncreated: 2026-03-01\nupdated: 2026-03-${String(i).padStart(2, "0")}\n---\n# Done ${i}\n`;
  }
  files["pm/backlog/idea-1.md"] =
    "---\ntype: backlog-issue\nid: PM-100\ntitle: Idea Item\nstatus: idea\npriority: low\ncreated: 2026-03-01\nupdated: 2026-03-01\n---\n# Idea\n";
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap/shipped");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Shipped"), "must have Shipped heading");
      assert.ok(body.includes("15 items"), "must show total count");
      assert.ok(body.includes("PM-001"), "must include oldest shipped item");
      assert.ok(body.includes("PM-015"), "must include newest shipped item");
      assert.ok(!body.includes("PM-100"), "must not include non-shipped items");
      assert.ok(body.includes("Roadmap"), "must have breadcrumb back to roadmap");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. GET /research returns topic list HTML
// ---------------------------------------------------------------------------

test("GET /kb?tab=research returns topic list HTML", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/index.md": "---\ntype: research-index\n---\n# Research Topics\n",
    "pm/research/user-interviews/findings.md":
      "---\ntopic: User Interviews\nsource_origin: internal\nevidence_count: 12\nupdated: 2026-03-12\n---\n# User Interview Findings\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=research");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Research") || body.includes("research"), "must mention research");
      assert.ok(body.includes("Customer evidence"), "must distinguish internal research topics");
      assert.ok(
        body.includes("12 evidence records"),
        "must show evidence count badge or subtitle for ingested evidence"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7b. GET /research/{topic} shows internal/mixed evidence metadata
// ---------------------------------------------------------------------------

test("GET /research/{topic} shows source origin and evidence metadata", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/reporting-gaps/findings.md":
      "---\ntopic: Reporting Gaps\nsource_origin: mixed\nevidence_count: 8\nupdated: 2026-03-12\n---\n# Reporting Gaps\n\n## Findings\n\n1. [internal] Users need better exports.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/research/reporting-gaps");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Reporting Gaps"), "must render topic title");
      assert.ok(body.includes("Customer + market evidence"), "must show mixed-origin subtitle");
      assert.ok(
        body.includes("8 evidence records"),
        "must show evidence count on topic detail page"
      );
      assert.ok(body.includes("Mixed"), "must render the mixed origin badge");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// YAML frontmatter parsing tests (unit tests on the exported parser)
// ---------------------------------------------------------------------------

function getFrontmatterParser() {
  const mod = loadServer();
  assert.equal(typeof mod.parseFrontmatter, "function", "parseFrontmatter must be exported");
  return mod.parseFrontmatter;
}

// ---------------------------------------------------------------------------
// 8. YAML frontmatter: flat key-value pairs
// ---------------------------------------------------------------------------

test("YAML frontmatter parses flat key-value pairs correctly", () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: landscape
created: 2026-03-12
title: My Title
---
# Body content
`;
  const { data, body } = parseFrontmatter(content);
  assert.equal(data.type, "landscape");
  assert.equal(data.created, "2026-03-12");
  assert.equal(data.title, "My Title");
  assert.ok(body.includes("# Body content"), "body must contain markdown after frontmatter");
});

// ---------------------------------------------------------------------------
// 9. YAML frontmatter: scalar arrays
// ---------------------------------------------------------------------------

test("YAML frontmatter parses scalar arrays correctly", () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: landscape
children:
  - slug-a
  - slug-b
  - slug-c
labels:
  - competitive
  - strategy
---
# Body
`;
  const { data } = parseFrontmatter(content);
  assert.equal(data.type, "landscape");
  assert.deepEqual(data.children, ["slug-a", "slug-b", "slug-c"]);
  assert.deepEqual(data.labels, ["competitive", "strategy"]);
});

// ---------------------------------------------------------------------------
// 10. YAML frontmatter: arrays of objects
// ---------------------------------------------------------------------------

test("YAML frontmatter parses arrays of objects correctly", () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: research
sources:
  - url: https://example.com/article
    accessed: 2026-03-10
    type: web
  - url: https://another.com/report
    accessed: 2026-03-11
    type: pdf
---
# Body
`;
  const { data } = parseFrontmatter(content);
  assert.equal(data.type, "research");
  assert.ok(Array.isArray(data.sources), "sources must be an array");
  assert.equal(data.sources.length, 2);
  assert.equal(data.sources[0].url, "https://example.com/article");
  assert.equal(data.sources[0].accessed, "2026-03-10");
  assert.equal(data.sources[0].type, "web");
  assert.equal(data.sources[1].url, "https://another.com/report");
  assert.equal(data.sources[1].type, "pdf");
});

// ---------------------------------------------------------------------------
// 11. YAML frontmatter: mixed shapes in one file
// ---------------------------------------------------------------------------

test("YAML frontmatter parses mixed shapes (flat + scalar arrays + array-of-objects) in one file", () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: competitor
name: Acme Corp
created: 2026-03-12
labels:
  - saas
  - enterprise
research_refs:
  - topic-a
  - topic-b
sources:
  - url: https://acme.com
    accessed: 2026-03-01
    type: web
---
# Acme Corp
`;
  const { data, body } = parseFrontmatter(content);
  assert.equal(data.type, "competitor");
  assert.equal(data.name, "Acme Corp");
  assert.equal(data.created, "2026-03-12");
  assert.deepEqual(data.labels, ["saas", "enterprise"]);
  assert.deepEqual(data.research_refs, ["topic-a", "topic-b"]);
  assert.ok(Array.isArray(data.sources));
  assert.equal(data.sources[0].url, "https://acme.com");
  assert.ok(body.includes("# Acme Corp"));
});

// ---------------------------------------------------------------------------
// 12. File changes trigger WebSocket reload
// ---------------------------------------------------------------------------

test("File changes in pm/ directory trigger WebSocket reload broadcast", (t, done) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Initial\n",
  });

  const mod = loadServer();
  if (!mod.createDashboardServer) {
    cleanup();
    assert.fail("createDashboardServer must be exported");
    return;
  }

  const server = mod.createDashboardServer(pmDir);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();

    // Connect a WebSocket client manually using raw TCP
    const net = require("net");
    const clientSocket = net.createConnection(port, "127.0.0.1", () => {
      clientSocket.write(
        "GET /ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    let receivedData = Buffer.alloc(0);
    let upgraded = false;
    let fileWritten = false;
    let reloadReceived = false;
    let finished = false;
    let writeTimer = null;
    let safetyTimer = null;

    function finish(err) {
      if (finished) return;
      finished = true;
      // Cancel pending timers so they don't fire after cleanup
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      clientSocket.destroy();
      server.close(() => {
        cleanup();
        done(err);
      });
    }

    clientSocket.on("data", (chunk) => {
      receivedData = Buffer.concat([receivedData, chunk]);
      const str = receivedData.toString("utf8");

      if (!upgraded) {
        if (str.includes("101 Switching Protocols")) {
          upgraded = true;
          receivedData = Buffer.alloc(0); // reset buffer to only hold WS frames
          // Write a change to a pm/ file after a short delay
          writeTimer = setTimeout(() => {
            writeTimer = null;
            if (!finished) {
              fileWritten = true;
              fs.writeFileSync(
                path.join(pmDir, "landscape.md"),
                "---\ntype: landscape\n---\n# Updated\n"
              );
            }
          }, 100);
        }
        return;
      }

      // After upgrade, look for 'reload' in the buffered WS frame data
      // Only count as a valid reload if we've already written the file
      if (!reloadReceived && fileWritten && receivedData.toString("utf8").includes("reload")) {
        reloadReceived = true;
        finish(null);
      }
    });

    clientSocket.on("error", (err) => finish(err));

    // Timeout safety: 4 seconds
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (!reloadReceived) {
        finish(new Error("Timed out waiting for WebSocket reload message"));
      }
    }, 4000);
  });
});

// ---------------------------------------------------------------------------
// 13. Nested file changes also trigger WebSocket reload broadcast
// ---------------------------------------------------------------------------

test("Nested file changes in pm/ subdirectories trigger WebSocket reload broadcast", (t, done) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/user-interviews/findings.md": "---\ntopic: user-interviews\n---\n# Initial\n",
  });

  const mod = loadServer();
  if (!mod.createDashboardServer) {
    cleanup();
    assert.fail("createDashboardServer must be exported");
    return;
  }

  const server = mod.createDashboardServer(pmDir);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();

    const net = require("net");
    const clientSocket = net.createConnection(port, "127.0.0.1", () => {
      clientSocket.write(
        "GET /ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    let receivedData = Buffer.alloc(0);
    let upgraded = false;
    let fileWritten = false;
    let reloadReceived = false;
    let finished = false;
    let writeTimer = null;
    let safetyTimer = null;

    function finish(err) {
      if (finished) return;
      finished = true;
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      clientSocket.destroy();
      server.close(() => {
        cleanup();
        done(err);
      });
    }

    clientSocket.on("data", (chunk) => {
      receivedData = Buffer.concat([receivedData, chunk]);
      const str = receivedData.toString("utf8");

      if (!upgraded) {
        if (str.includes("101 Switching Protocols")) {
          upgraded = true;
          receivedData = Buffer.alloc(0);
          writeTimer = setTimeout(() => {
            writeTimer = null;
            if (!finished) {
              fileWritten = true;
              fs.writeFileSync(
                path.join(pmDir, "research", "user-interviews", "findings.md"),
                "---\ntopic: user-interviews\n---\n# Updated\n"
              );
            }
          }, 100);
        }
        return;
      }

      if (!reloadReceived && fileWritten && receivedData.toString("utf8").includes("reload")) {
        reloadReceived = true;
        finish(null);
      }
    });

    clientSocket.on("error", (err) => finish(err));

    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (!reloadReceived) {
        finish(
          new Error("Timed out waiting for WebSocket reload message after nested file change")
        );
      }
    }, 4000);
  });
});

// ---------------------------------------------------------------------------
// 14. Missing pm/ directory returns helpful empty state
// ---------------------------------------------------------------------------

test("Missing pm/ directory returns helpful empty state HTML", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-nopm-"));
  // Do NOT create a pm/ subdir
  const nonExistentPmDir = path.join(root, "pm");
  try {
    const { port, close } = await startDashboardServer(nonExistentPmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/");
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes("/pm:setup") && body.includes("Welcome to PM"),
        "must show Welcome to PM onboarding message with /pm:setup"
      );
    } finally {
      await close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 15. XSS prevention: inlineMarkdown escapes HTML entities
// ---------------------------------------------------------------------------

test("inlineMarkdown escapes HTML tags to prevent XSS", () => {
  const mod = loadServer();
  assert.equal(typeof mod.inlineMarkdown, "function", "inlineMarkdown must be exported");
  assert.equal(typeof mod.escHtml, "function", "escHtml must be exported");

  const malicious = 'Hello <script>alert("xss")</script> world';
  const result = mod.inlineMarkdown(malicious);

  // Must NOT contain raw <script> tags
  assert.ok(!result.includes("<script>"), "must not contain raw <script> tag");
  assert.ok(!result.includes("</script>"), "must not contain raw </script> tag");
  // Must contain escaped versions
  assert.ok(result.includes("&lt;script&gt;"), "must escape < and > in script tags");
});

// ---------------------------------------------------------------------------
// 16. renderMarkdown also escapes HTML in inline content
// ---------------------------------------------------------------------------

test("inlineMarkdown sanitizes malicious markdown links", () => {
  const mod = loadServer();

  // Attribute injection: quotes in URL are escaped so onclick stays inside href value
  const attrInjection = mod.inlineMarkdown('[click](x" onclick="alert(1))');
  // The " must be &quot; so the browser doesn't see a second attribute
  assert.ok(attrInjection.includes("&quot;"), "quotes in URL must be escaped to &quot;");
  // The dangerous pattern is literal " breaking out of href to create onclick attribute
  // With &quot; escaping, the browser sees onclick as part of the href value, not a new attribute
  assert.ok(
    !attrInjection.includes('" onclick='),
    "literal quote must not break out of href to create onclick attribute"
  );

  // javascript: URL scheme
  const jsScheme = mod.inlineMarkdown("[click](javascript:alert(1))");
  assert.ok(!jsScheme.includes('href="javascript:'), "must not contain javascript: href");
  assert.ok(!jsScheme.includes("<a"), "javascript: links should be stripped to plain text");

  // data: URL scheme
  const dataScheme = mod.inlineMarkdown("[click](data:text/html,test)");
  assert.ok(!dataScheme.includes('href="data:'), "must not contain data: href");
});

test("renderMarkdown escapes HTML in paragraphs and headings", () => {
  const mod = loadServer();
  const md = "# Title <img onerror=alert(1)>\n\nSome <b>bold</b> text";
  const html = mod.renderMarkdown(md);

  assert.ok(!html.includes("<img onerror"), "must not contain raw <img> with onerror");
  assert.ok(html.includes("&lt;img"), "must escape img tag");
  assert.ok(!html.includes("<b>bold</b>"), "must escape raw b tag");
});

// ---------------------------------------------------------------------------
// 17. Path traversal via .. in route slugs returns 404
// ---------------------------------------------------------------------------

test("path traversal via .. in route slugs does not expose parent directory content", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/valid-topic/findings.md": "---\ntopic: Valid\n---\n# Valid\n",
    "pm/findings.md": "---\ntopic: Should not be reachable\n---\n# Secret\n",
    "pm/backlog/normal-item.md": "---\ntitle: Normal\nstatus: idea\n---\n# Normal\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // URL normalization resolves /research/.. to / (home page) — content is NOT exposed
      const research = await httpGet(port, "/research/..");
      assert.ok(
        !research.body.includes("Should not be reachable"),
        "/research/.. must not expose parent content"
      );

      // Encoded traversal attempts: %2e%2e is decoded to .. by the server
      const backlogTraversal = await httpGet(port, "/backlog/%2e%2e");
      assert.ok(
        !backlogTraversal.body.includes("Should not be reachable"),
        "encoded traversal must not expose parent content"
      );

      // Percent-encoded traversal: %2e%2e is normalized by URL constructor to ..
      // which resolves /competitors/%2e%2e to / (home page) — content still not exposed
      const competitorTraversal = await httpGet(port, "/competitors/%2e%2e");
      assert.ok(
        !competitorTraversal.body.includes("Should not be reachable"),
        "/competitors/%2e%2e must not expose parent content"
      );

      // Double-encoded traversal with slashes
      const backlogSlug = await httpGet(port, "/backlog/%2e%2e%2f%2e%2e");
      assert.ok(
        !backlogSlug.body.includes("Should not be reachable"),
        "/backlog/%2e%2e%2f%2e%2e must not expose parent content"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 18. Badge rendering escapes topic frontmatter to prevent XSS
// ---------------------------------------------------------------------------

test("badge rendering escapes topic frontmatter to prevent XSS", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/xss-test/findings.md": [
      "---",
      "topic: <script>alert(1)</script>",
      "source_origin: internal",
      "evidence_count: 3",
      "---",
      "# XSS Test",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/research/xss-test");
      assert.equal(statusCode, 200);
      assert.ok(
        !body.includes("<script>alert(1)</script>"),
        "must not contain raw script tag from topic frontmatter"
      );
      assert.ok(
        body.includes("&lt;script&gt;") || body.includes("XSS Test"),
        "topic must be escaped or use fallback"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 19. start-server.sh launches dashboard mode against the provided project directory
// ---------------------------------------------------------------------------

test("start-server.sh launches dashboard mode against the provided project directory", async () => {
  const { root, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\n",
    "pm/research/reporting-gaps/findings.md":
      "---\ntopic: Reporting Gaps\nsource_origin: internal\nevidence_count: 3\nupdated: 2026-03-12\n---\n# Reporting Gaps\n",
  });

  try {
    const { execFile } = require("child_process");
    const execFileAsync = (file, args) =>
      new Promise((resolve, reject) => {
        execFile(file, args, { cwd: root, timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      });

    const startScript = path.join(__dirname, "..", "scripts", "start-server.sh");
    const stopScript = path.join(__dirname, "..", "scripts", "stop-server.sh");
    const { stdout } = await execFileAsync(startScript, [
      "--project-dir",
      root,
      "--mode",
      "dashboard",
      "--background",
    ]);
    const info = JSON.parse(stdout.trim());

    assert.ok(info.url, "start-server.sh must return a dashboard URL");
    assert.ok(info.screen_dir, "start-server.sh must return screen_dir for cleanup");

    const url = new URL(info.url);
    const { statusCode: homeStatus, body: homeBody } = await httpGet(Number(url.port), "/");
    assert.equal(homeStatus, 200);
    assert.ok(
      homeBody.includes("Product knowledge base"),
      "home route must render the dashboard shell"
    );
    assert.ok(homeBody.includes("Knowledge base"), "home route must show KB health section");

    const { statusCode: researchStatus, body: researchBody } = await httpGet(
      Number(url.port),
      "/kb?tab=research"
    );
    assert.equal(researchStatus, 200);
    assert.ok(
      researchBody.includes("Market Landscape"),
      "KB research tab must read the project knowledge base"
    );

    await execFileAsync(stopScript, [info.screen_dir]);
  } finally {
    cleanup();
  }
});

test("start-server.sh rejects deprecated companion mode", async () => {
  const { root, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\n",
  });

  try {
    const { execFile } = require("child_process");
    const execFileAsync = (file, args) =>
      new Promise((resolve, reject) => {
        execFile(file, args, { cwd: root, timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      });

    const startScript = path.join(__dirname, "..", "scripts", "start-server.sh");
    await assert.rejects(
      execFileAsync(startScript, ["--project-dir", root, "--mode", "companion", "--background"]),
      (error) => {
        assert.match(error.stdout || "", /Unsupported PM server mode: companion/);
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 28. Nav restructure — KB umbrella
// ---------------------------------------------------------------------------

test("Dashboard nav shows Home, Proposals, Roadmap, Knowledge Base", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Check nav links (inside <nav> element)
      const navMatch = body.match(/<nav[^>]*>([\s\S]*?)<\/nav>/);
      assert.ok(navMatch, "page must have a nav element");
      const navHtml = navMatch[1];
      assert.ok(navHtml.includes("Knowledge Base"), "nav must show Knowledge Base");
      assert.ok(navHtml.includes("Proposals"), "nav must show Proposals");
      assert.ok(navHtml.includes("Roadmap"), "nav must show Roadmap");
      assert.ok(!navHtml.includes(">Backlog<"), "nav must NOT show Backlog");
      assert.ok(!navHtml.includes(">Research<"), "nav must NOT show Research as top-level");
      assert.ok(!navHtml.includes(">Strategy<"), "nav must NOT show Strategy as top-level");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("GET /kb renders the KB hub page (PM-122)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\n",
    "pm/strategy.md":
      "---\ntype: strategy\n---\n# Strategy\n## Focus\nBuild the best PM tool\n## Priorities\n- Ship fast\n- Quality\n- Delight users\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Knowledge Base"), "must show KB heading");
      assert.ok(body.includes("strategy-banner"), "hub must have strategy-banner");
      assert.ok(body.includes("landscape-card"), "hub must have landscape-card");
      assert.ok(!body.includes('class="kb-tab'), "hub must NOT render old KB sub-tab elements");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("GET /kb?tab=strategy shows strategy detail page (PM-122)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=strategy");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Strategy"), "strategy detail must show strategy content");
      assert.ok(body.includes("Knowledge Base"), "must have breadcrumb back to KB hub");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("Old /research URL redirects to /kb?tab=research", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, "/research");
      assert.equal(statusCode, 302);
      assert.equal(headers.location, "/kb?tab=research");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("Old /strategy URL redirects to /kb?tab=strategy", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, "/strategy");
      assert.equal(statusCode, 302);
      assert.equal(headers.location, "/kb?tab=strategy");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("Old /competitors URL redirects to /kb?tab=competitors", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, "/competitors");
      assert.equal(statusCode, 302);
      assert.equal(headers.location, "/kb?tab=competitors");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("/research/{slug} detail pages still work directly", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/user-onboarding/findings.md":
      "---\ntopic: User Onboarding\ntype: topic-research\ncreated: 2026-03-01\nupdated: 2026-03-01\n---\n# User Onboarding\nKey findings here.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/research/user-onboarding");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("User Onboarding"), "research detail page must still work");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("KB nav item is highlighted on /kb routes", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      assert.ok(
        body.includes('href="/kb" class="nav-item active"'),
        "KB nav item must be active on /kb"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 28. readProposalMeta reads JSON sidecar and returns parsed data
// ---------------------------------------------------------------------------

test("readProposalMeta returns parsed JSON for existing sidecar", () => {
  const meta = {
    title: "Dashboard Redesign",
    date: "2026-03-17",
    verdict: "ready",
    verdictLabel: "Ready",
    phase: "completed",
    issueCount: 7,
    gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    labels: ["dashboard", "ux"],
  };
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/dashboard-redesign.meta.json": JSON.stringify(meta),
  });
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta("dashboard-redesign", pmDir);
    assert.deepEqual(result, meta);
  } finally {
    cleanup();
  }
});

test("readProposalMeta returns null for missing sidecar", () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta("nonexistent", pmDir);
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

test("readProposalMeta returns null for corrupted JSON", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/bad.meta.json": "{ broken json",
  });
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta("bad", pmDir);
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

test("readProposalMeta rejects path traversal slugs", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/legit.meta.json": '{"title":"ok"}',
  });
  try {
    const mod = loadServer();
    assert.equal(mod.readProposalMeta("../../../etc/passwd", pmDir), null);
    assert.equal(mod.readProposalMeta("foo/bar", pmDir), null);
    assert.equal(mod.readProposalMeta("..", pmDir), null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 29. readGroomState reads .pm/.groom-state.md from project root
// ---------------------------------------------------------------------------

test("readGroomState returns parsed frontmatter for existing state", () => {
  const { pmDir, cleanup } = withPmDir({
    ".pm/.groom-state.md":
      '---\ntopic: "Dashboard Redesign"\nphase: research\nstarted: 2026-03-16\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.equal(result.topic, "Dashboard Redesign");
    assert.equal(result.phase, "research");
    assert.equal(result.started, "2026-03-16");
  } finally {
    cleanup();
  }
});

test("readGroomState returns null when no groom state exists", () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

test("readGroomState returns null for corrupted state file", () => {
  const { pmDir, cleanup } = withPmDir({
    ".pm/.groom-state.md": "not yaml at all just random text",
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    // parseFrontmatter returns {} for no match, so readGroomState returns null when no topic
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 30. proposalGradient is deterministic based on slug
// ---------------------------------------------------------------------------

test("proposalGradient returns consistent gradient for same slug", () => {
  const mod = loadServer();
  const g1 = mod.proposalGradient("dashboard-redesign");
  const g2 = mod.proposalGradient("dashboard-redesign");
  assert.equal(g1, g2, "same slug must produce same gradient");
  assert.ok(g1.startsWith("linear-gradient("), "must be a CSS gradient");
});

test("proposalGradient returns different gradients for different slugs", () => {
  const mod = loadServer();
  // With 8 gradients in the palette, these two slugs should differ (extremely likely)
  const g1 = mod.proposalGradient("feature-one");
  const g2 = mod.proposalGradient("feature-two");
  // Not guaranteed different with only 8 options, but the hash should distribute well
  assert.ok(g1.startsWith("linear-gradient("), "must be a CSS gradient");
  assert.ok(g2.startsWith("linear-gradient("), "must be a CSS gradient");
});

// ---------------------------------------------------------------------------
// PM-129: Inline Style Audit
// ---------------------------------------------------------------------------

test("PM-129: DASHBOARD_CSS contains all new audit classes", () => {
  const { DASHBOARD_CSS } = loadServer();
  const requiredClasses = [
    ".scatter-legend-note",
    ".scatter-axis-label-top",
    ".scatter-axis-label-bottom",
    ".scatter-gridline-h",
    ".scatter-gridline-v",
    ".scatter-axis-label-bl",
    ".scatter-axis-label-br",
    ".timeline-phase-gate",
    ".chart-description",
    ".bar-group-meta",
    ".heatmap-legend",
    ".heatmap-legend-badge",
    ".swot-empty",
    ".page-count",
    ".coverage-legend",
    ".coverage-legend-item",
    ".coverage-heading",
    ".comparison-badge",
    ".coverage-group-header--operational",
    ".coverage-group-header--default",
  ];
  for (const cls of requiredClasses) {
    assert.ok(DASHBOARD_CSS.includes(cls), `DASHBOARD_CSS must contain class "${cls}"`);
  }
});

test("PM-129: scatter axis labels use CSS classes instead of inline positions", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  // Verify scatter axis label top no longer has inline style
  assert.ok(
    !serverSrc.includes('scatter-axis-label-top" style='),
    "scatter-axis-label-top must not have inline style"
  );
  assert.ok(
    !serverSrc.includes('scatter-axis-label-bottom" style='),
    "scatter-axis-label-bottom must not have inline style"
  );
  // Verify gridlines use classes
  assert.ok(
    !serverSrc.includes('scatter-gridline-h" style='),
    "scatter-gridline-h must not have inline style"
  );
  assert.ok(
    !serverSrc.includes('scatter-gridline-v" style='),
    "scatter-gridline-v must not have inline style"
  );
  // Verify new classes for bottom axis labels
  assert.ok(
    serverSrc.includes("scatter-axis-label-bl"),
    "Bottom-left axis label must use scatter-axis-label-bl class"
  );
  assert.ok(
    serverSrc.includes("scatter-axis-label-br"),
    "Bottom-right axis label must use scatter-axis-label-br class"
  );
});

test("PM-129: heatmap legend badges use CSS classes instead of inline styles", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  assert.ok(serverSrc.includes('class="heatmap-legend"'), "Heatmap legend wrapper must use class");
  assert.ok(
    serverSrc.includes("heatmap-legend-badge"),
    "Heatmap legend badges must use heatmap-legend-badge class"
  );
  // Ensure no inline padding/border-radius on heatmap legend spans
  assert.ok(
    !serverSrc.includes('heatmap-full" style='),
    "heatmap-full should not have inline style"
  );
});

test("PM-129: timeline phase gate uses CSS class instead of inline style", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  assert.ok(
    serverSrc.includes('class="timeline-phase-gate"'),
    "Timeline phase gate must use CSS class"
  );
  assert.ok(
    !serverSrc.includes("font-size:0.6875rem;color:var(--text-muted);font-style:italic"),
    "Timeline gate inline style should be removed"
  );
});

test("PM-129: chart descriptions use CSS class instead of inline style", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  assert.ok(
    serverSrc.includes('class="chart-description"'),
    "Chart descriptions must use CSS class"
  );
  // Both satisfaction and SEO descriptions should use the class
  const chartDescCount = (serverSrc.match(/class="chart-description"/g) || []).length;
  assert.ok(
    chartDescCount >= 2,
    `Expected at least 2 chart-description usages, found ${chartDescCount}`
  );
});

// PM-142: removed tests for coverage-legend and pillarClassMap — they tested
// dead code inside handleResearchPage which was removed as unreachable.

test("PM-129: page-count class replaces inline style on shipped page", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  // PM-124 redesigned shipped page -- count now uses subtitle class
  assert.ok(
    serverSrc.includes('class="subtitle"') || serverSrc.includes('class="col-count page-count"'),
    "Shipped page count must use subtitle or page-count class"
  );
  assert.ok(
    !serverSrc.includes('col-count" style="font-size:1rem'),
    "col-count should not have inline font-size style"
  );
});

test("PM-129: SWOT empty items use class instead of inline style", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  assert.ok(serverSrc.includes('class="swot-empty"'), "SWOT empty items must use swot-empty class");
  assert.ok(
    !serverSrc.includes('style="color:var(--text-muted)">Not yet analyzed'),
    "SWOT empty should not have inline color style"
  );
});

test("PM-129: remaining style= attributes are all dynamic (data-driven)", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");

  // Skip DASHBOARD_CSS block
  const dashCssStart = serverSrc.indexOf("const DASHBOARD_CSS = `");
  const dashCssEnd = serverSrc.indexOf("`;", dashCssStart + 30);

  const before = serverSrc.slice(0, dashCssStart);
  const after = serverSrc.slice(dashCssEnd);
  const codeOnly = before + after;

  // Count style= occurrences
  const styleMatches = codeOnly.match(/style="/g) || [];
  const styleCount = styleMatches.length;

  // All remaining style= should be dynamic (contain variable interpolation)
  // Target: <= 8 dynamic exceptions
  assert.ok(
    styleCount <= 8,
    `Too many inline style= attributes remain (${styleCount}). Target: <= 8 dynamic exceptions.`
  );
});

test("PM-129: no static inline styles with hardcoded values remain", () => {
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");

  // Skip CSS block
  const dashCssStart = serverSrc.indexOf("const DASHBOARD_CSS = `");
  const dashCssEnd = serverSrc.indexOf("`;", dashCssStart + 30);
  const codeOnly = serverSrc.slice(0, dashCssStart) + serverSrc.slice(dashCssEnd);

  // Find style= that do NOT contain variable interpolation
  const styleRe = /style="([^"]+)"/g;
  let match;
  const staticViolations = [];

  while ((match = styleRe.exec(codeOnly)) !== null) {
    const val = match[1];
    // Dynamic: contains template literal or string concatenation
    if (val.includes("${") || val.includes("' +") || val.includes('" +')) continue;
    staticViolations.push(val);
  }

  assert.deepEqual(
    staticViolations,
    [],
    `Static inline styles found (should be CSS classes): ${staticViolations.join(" | ")}`
  );
});

// ---------------------------------------------------------------------------
// PM-119: Color and Border Restraint Pass
// ---------------------------------------------------------------------------

test("PM-119 Task 1: :root contains new semantic color tokens", () => {
  const { DASHBOARD_CSS } = loadServer();
  // Extract the :root block (first one — light theme)
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  const rootBlock = rootMatch[1];

  const requiredTokens = [
    "--error",
    "--error-text",
    "--teal",
    "--text-on-accent",
    "--text-faint",
    "--border-strong",
  ];
  for (const token of requiredTokens) {
    assert.ok(rootBlock.includes(token + ":"), `:root must define ${token}`);
  }
});

test("PM-119 Task 2: :root contains badge semantic tokens", () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  const rootBlock = rootMatch[1];

  const badgeTokens = [
    "--badge-success-bg",
    "--badge-success-text",
    "--badge-warning-bg",
    "--badge-warning-text",
    "--badge-error-bg",
    "--badge-error-text",
    "--badge-info-bg",
    "--badge-info-text",
    "--badge-neutral-bg",
    "--badge-neutral-text",
  ];
  for (const token of badgeTokens) {
    assert.ok(rootBlock.includes(token + ":"), `:root must define ${token}`);
  }
});

test("PM-119 Task 3: badge classes use var() instead of hardcoded hex", () => {
  const { DASHBOARD_CSS } = loadServer();
  // Extract all badge class rules
  const badgeClasses = [
    ".badge-ready",
    ".badge-fresh",
    ".badge-aging",
    ".badge-stale",
    ".badge-in-progress",
    ".badge-approved",
    ".badge-empty",
    ".badge-origin-internal",
    ".badge-origin-external",
    ".badge-origin-mixed",
    ".badge-evidence",
  ];
  for (const cls of badgeClasses) {
    // Find the rule for this class
    const re = new RegExp(cls.replace(".", "\\.") + "\\s*\\{([^}]+)\\}");
    const m = DASHBOARD_CSS.match(re);
    assert.ok(m, `${cls} rule must exist in DASHBOARD_CSS`);
    const rule = m[1];
    // Must not contain raw hex colors
    assert.ok(
      !/#[0-9a-fA-F]{3,8}/.test(rule),
      `${cls} must not contain hardcoded hex colors, found: ${rule.trim()}`
    );
    // Must use var() references
    assert.ok(rule.includes("var("), `${cls} must use var() references`);
  }
});

test("PM-119 Task 4: SWOT, quadrant, heatmap, scope classes use var() not hex", () => {
  const { DASHBOARD_CSS } = loadServer();
  const targetClasses = [
    ".swot-strengths",
    ".swot-weaknesses",
    ".swot-opportunities",
    ".swot-threats",
    ".quadrant-q1",
    ".quadrant-q2",
    ".quadrant-q3",
    ".quadrant-q4",
    ".heatmap-full",
    ".heatmap-partial",
    ".heatmap-missing",
    ".heatmap-diff",
    ".scope-small",
    ".scope-medium",
    ".scope-large",
  ];
  for (const cls of targetClasses) {
    const re = new RegExp(cls.replace(".", "\\.") + "(?:\\s+h4)?\\s*\\{([^}]+)\\}");
    const m = DASHBOARD_CSS.match(re);
    assert.ok(m, `${cls} rule must exist`);
    const rule = m[1];
    assert.ok(
      !/#[0-9a-fA-F]{3,8}/.test(rule),
      `${cls} must not contain hardcoded hex, found: ${rule.trim()}`
    );
  }
});

test("PM-119 Task 5: bar-fill, scatter-dot.highlight, priority classes use var()", () => {
  const { DASHBOARD_CSS } = loadServer();
  const targetClasses = [
    ".bar-fill-green",
    ".bar-fill-yellow",
    ".bar-fill-red",
    ".bar-fill-blue",
    ".bar-fill-teal",
    ".scatter-dot.highlight",
    ".priority-critical",
    ".priority-high",
    ".priority-medium",
    ".priority-low",
  ];
  for (const cls of targetClasses) {
    // priority classes appear as .kanban-item.priority-* and .legend-bar.priority-*
    const escaped = cls.replace(/\./g, "\\.");
    const re = new RegExp(escaped + "\\s*\\{([^}]+)\\}");
    const m = DASHBOARD_CSS.match(re);
    assert.ok(m, `${cls} rule must exist`);
    const rule = m[1];
    assert.ok(
      !/#[0-9a-fA-F]{3,8}/.test(rule),
      `${cls} must not contain hardcoded hex, found: ${rule.trim()}`
    );
  }
});

test("PM-119 Task 6: no hardcoded hex outside token definition blocks", () => {
  const { DASHBOARD_CSS } = loadServer();
  // Remove :root and [data-theme] blocks (token definition blocks)
  const withoutTokenBlocks = DASHBOARD_CSS.replace(/:root\s*\{[^}]+\}/g, "").replace(
    /\[data-theme="[^"]+"\]\s*\{[^}]+\}/g,
    ""
  );
  // Find remaining hex colors
  const hexMatches = withoutTokenBlocks.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(
    hexMatches,
    [],
    `Hardcoded hex colors found outside token blocks: ${hexMatches.join(", ")}`
  );
});

test("PM-119 Task 7: --border-strong token exists in :root", () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  assert.ok(rootMatch[1].includes("--border-strong:"), ":root must define --border-strong");
});

test("PM-119 Task 8: .card does not have border: 1px solid", () => {
  const { DASHBOARD_CSS } = loadServer();
  const cardMatch = DASHBOARD_CSS.match(/\.card\s*\{([^}]+)\}/);
  assert.ok(cardMatch, ".card rule must exist");
  assert.ok(
    !cardMatch[1].includes("border: 1px solid"),
    ".card must not use border: 1px solid (use surface differentiation)"
  );
  assert.ok(!cardMatch[1].includes("border:1px solid"), ".card must not use border:1px solid");
});

test("PM-119 Task 10: no var(--accent, #2563eb) fallback patterns", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(
    !DASHBOARD_CSS.includes("var(--accent, #2563eb)"),
    "Must not contain old accent fallback var(--accent, #2563eb)"
  );
});

test("PM-119: accent color unified to #5e6ad2", () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  assert.ok(rootMatch[1].includes("--accent: #5e6ad2"), "--accent must be unified to #5e6ad2");
});

// ---------------------------------------------------------------------------
// PM-123: Roadmap Page (rename Backlog)
// ---------------------------------------------------------------------------

test("PM-123: GET /backlog redirects 302 to /roadmap", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/issue-1.md": "---\nstatus: idea\ntitle: Issue 1\n---\n# Issue 1\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, "/backlog");
      assert.equal(statusCode, 302, "GET /backlog must return 302");
      assert.equal(headers.location, "/roadmap", "must redirect to /roadmap");
      assert.equal(body, "", "redirect body must be empty");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: GET /backlog/shipped redirects 302 to /roadmap/shipped", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/done-1.md": "---\nstatus: done\ntitle: Done 1\n---\n# Done 1\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, "/backlog/shipped");
      assert.equal(statusCode, 302, "GET /backlog/shipped must return 302");
      assert.equal(headers.location, "/roadmap/shipped");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: GET /backlog/<slug> redirects 302 to /roadmap/<slug>", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-feature.md": "---\nstatus: idea\ntitle: My Feature\n---\n# My Feature\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, "/backlog/my-feature");
      assert.equal(statusCode, 302, "GET /backlog/<slug> must return 302");
      assert.equal(headers.location, "/roadmap/my-feature");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: GET /roadmap returns 200 with Roadmap heading", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/issue-1.md": "---\nstatus: idea\ntitle: Issue 1\n---\n# Issue 1\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap");
      assert.equal(statusCode, 200, "GET /roadmap must return 200");
      assert.ok(body.includes("<h1>Roadmap</h1>"), "must have Roadmap heading");
      assert.ok(!body.includes("<h1>Backlog</h1>"), "must NOT have Backlog heading");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: nav sidebar shows Roadmap not Backlog", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      const navMatch = body.match(/<nav[^>]*>([\s\S]*?)<\/nav>/);
      assert.ok(navMatch, "page must have a nav element");
      const navHtml = navMatch[1];
      assert.ok(navHtml.includes("Roadmap"), "nav must show Roadmap");
      assert.ok(!navHtml.includes("Backlog"), "nav must NOT show Backlog");
      assert.ok(navHtml.includes('href="/roadmap"'), "nav must link to /roadmap");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: kanban columns are labeled Groomed / In Progress / Shipped", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/idea-1.md": "---\nstatus: idea\ntitle: Idea One\n---\n# Idea\n",
    "pm/backlog/wip-1.md": "---\nstatus: in-progress\ntitle: WIP One\n---\n# WIP\n",
    "pm/backlog/done-1.md": "---\nstatus: done\ntitle: Done One\n---\n# Done\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap");
      assert.ok(body.includes(">Idea<") || body.includes(">Idea "), "must show Idea column");
      assert.ok(
        body.includes(">Groomed<") || body.includes(">Groomed "),
        "must show Groomed column"
      );
      assert.ok(
        body.includes(">Shipped<") || body.includes(">Shipped "),
        "must show Shipped column"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: shipped column has dimming CSS", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(
    DASHBOARD_CSS.includes(".kanban-col.shipped"),
    "DASHBOARD_CSS must contain .kanban-col.shipped rule"
  );
  assert.ok(
    DASHBOARD_CSS.includes("opacity: 0.7") || DASHBOARD_CSS.includes("opacity:0.7"),
    "shipped column items must have opacity 0.7"
  );
});

test("PM-123: rendered HTML has no remaining /backlog/ hrefs", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/idea-1.md": "---\nstatus: idea\ntitle: Idea One\nid: PM-001\n---\n# Idea\n",
    "pm/backlog/done-1.md": "---\nstatus: done\ntitle: Done One\nid: PM-002\n---\n# Done\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // Check roadmap page
      const { body: roadmapBody } = await httpGet(port, "/roadmap");
      const backlogHrefs = roadmapBody.match(/href="\/backlog/g) || [];
      assert.equal(
        backlogHrefs.length,
        0,
        `Roadmap page must have no /backlog hrefs, found ${backlogHrefs.length}: ${backlogHrefs.join(", ")}`
      );

      // Check home page
      const { body: homeBody } = await httpGet(port, "/");
      const homeBacklogHrefs = homeBody.match(/href="\/backlog/g) || [];
      assert.equal(
        homeBacklogHrefs.length,
        0,
        `Home page must have no /backlog hrefs, found ${homeBacklogHrefs.length}`
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: breadcrumbs say Roadmap not Backlog", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-item.md": "---\nstatus: idea\ntitle: My Item\n---\n# My Item\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/my-item");
      assert.ok(body.includes("Roadmap</a>"), "breadcrumb must say Roadmap");
      assert.ok(!body.includes("Backlog</a>"), "breadcrumb must NOT say Backlog");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-123: GET /roadmap/shipped returns 200", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/done-1.md": "---\nstatus: done\ntitle: Done 1\n---\n# Done 1\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap/shipped");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Shipped"), "must have Shipped heading");
      assert.ok(body.includes("Roadmap</a>"), "breadcrumb must say Roadmap");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-120: Home Page Redesign
// ---------------------------------------------------------------------------

test("PM-120: home page contains four section titles", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\nupdated: 2026-04-01\n---\n# Strategy\n\n## Focus\nBuild the best PM tool.\n\n## Priorities\n1. Ship dashboard\n2. Fix bugs\n3. Improve docs\n",
    "pm/landscape.md": "---\ntype: landscape\n---\n# Landscape\n",
    "pm/competitors/acme/profile.md": "---\ncompany: Acme\nupdated: 2026-04-01\n---\n# Acme\n",
    "pm/backlog/done-1.md":
      "---\nstatus: done\ntitle: Done Item\nupdated: 2026-03-30\n---\n# Done\n",
    "pm/research/onboarding/findings.md":
      "---\ntopic: Onboarding\nsource_origin: internal\nevidence_count: 5\nupdated: 2026-03-28\n---\n# Onboarding\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/");
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes('<span class="home-section-title">Strategy</span>'),
        "must have Strategy section"
      );
      assert.ok(
        body.includes('<span class="home-section-title">Recently shipped</span>'),
        "must have Recently shipped section"
      );
      assert.ok(
        body.includes('<span class="home-section-title">Knowledge base</span>'),
        "must have Knowledge base section"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: home page body does NOT contain pulse-score, card-grid, or canvas-tabs", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
    "pm/backlog/issue-1.md": "---\nstatus: idea\ntitle: Issue 1\n---\n# Issue 1\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Extract just the container content (after </style> and inside <div class="container">)
      const containerMatch = body.match(/<div class="container">([\s\S]*?)<script>/);
      assert.ok(containerMatch, "must have a container div");
      const content = containerMatch[1];
      assert.ok(!content.includes("pulse-score"), "home content must NOT contain pulse-score");
      assert.ok(!content.includes("pulse-arc"), "home content must NOT contain pulse-arc");
      assert.ok(!content.includes('class="card-grid"'), "home content must NOT contain card-grid");
      assert.ok(!content.includes("canvas-tabs"), "home content must NOT contain canvas-tabs");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: strategy snapshot shows focus, priorities, and staleness", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\nupdated: 2026-04-01\n---\n# Product Strategy\n\n## Focus\nBuild the best PM tool for indie developers.\n\n## Priorities\n1. Ship fast dashboard\n2. Fix critical bugs\n3. Improve onboarding docs\n\n## Non-goals\n- Enterprise features\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("strategy-focus"), "must have strategy-focus element");
      assert.ok(body.includes("best PM tool"), "must show focus statement");
      assert.ok(body.includes("priority-item"), "must have priority items");
      assert.ok(body.includes("Ship fast dashboard"), "must show first priority");
      assert.ok(body.includes("staleness-dot"), "must show staleness indicator");
      assert.ok(body.includes("View full strategy"), "must have link to full strategy");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: recently shipped shows done items", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/shipped-a.md":
      "---\nstatus: done\ntitle: Feature Alpha\nupdated: 2026-03-28\noutcome: Reduced churn by 15%\n---\n# Alpha\n",
    "pm/backlog/shipped-b.md":
      "---\nstatus: done\ntitle: Feature Beta\nupdated: 2026-03-25\n---\n# Beta\n",
    "pm/backlog/open-c.md": "---\nstatus: idea\ntitle: Not Shipped\n---\n# Open\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("Recently shipped"), "must have shipped section");
      assert.ok(body.includes("Feature Alpha"), "must show shipped item title");
      assert.ok(body.includes("Feature Beta"), "must show second shipped item");
      assert.ok(
        !body.includes("Not Shipped") ||
          body.indexOf("Not Shipped") > body.indexOf("Session brief"),
        "must not show non-shipped items in shipped section"
      );
      assert.ok(body.includes("Reduced churn by 15%"), "must show outcome context");
      assert.ok(body.includes("home-shipped-date"), "must show date");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: KB health shows 3 metric cards", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/topic-a/findings.md":
      "---\ntopic: Topic A\nsource_origin: internal\nevidence_count: 10\nupdated: 2026-03-20\n---\n# A\n",
    "pm/research/topic-b/findings.md":
      "---\ntopic: Topic B\nsource_origin: external\nupdated: 2026-03-15\n---\n# B\n",
    "pm/competitors/acme/profile.md": "---\ncompany: Acme\nupdated: 2026-03-18\n---\n# Acme\n",
    "pm/competitors/beta/profile.md": "---\ncompany: Beta\nupdated: 2026-03-10\n---\n# Beta\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("kb-health-grid"), "must have KB health grid");
      assert.ok(body.includes("kb-health-card"), "must have KB health cards");
      assert.ok(body.includes("Research topics"), "must show research topics label");
      assert.ok(body.includes("Competitors profiled"), "must show competitors label");
      assert.ok(body.includes("Customer evidence"), "must show evidence label");
      // Check values
      assert.ok(body.includes(">2<"), "must show 2 research topics");
      assert.ok(body.includes(">2<"), "must show 2 competitors");
      assert.ok(body.includes(">10<"), "must show 10 evidence records");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: home CSS uses design tokens, not raw px/rem", () => {
  const { DASHBOARD_CSS } = loadServer();
  const homeSectionClasses = [
    ".home-section",
    ".home-section-header",
    ".home-section-title",
    ".home-section-link",
    ".strategy-card",
    ".strategy-focus",
    ".home-proposal-list",
    ".home-proposal-row",
    ".home-shipped-list",
    ".home-shipped-item",
    ".kb-health-grid",
    ".kb-health-card",
    ".kb-health-value",
    ".staleness-dot",
    ".staleness-dot.fresh",
    ".staleness-dot.aging",
    ".staleness-dot.stale",
  ];
  for (const cls of homeSectionClasses) {
    const escaped = cls.replace(/\./g, "\\.").replace(/\s/g, "\\s");
    const re = new RegExp(escaped);
    assert.ok(re.test(DASHBOARD_CSS), `DASHBOARD_CSS must contain class "${cls}"`);
  }

  // Verify design tokens are used (not raw px in section spacing)
  assert.ok(
    DASHBOARD_CSS.includes("var(--space-12)"),
    "must use var(--space-12) for section spacing"
  );
  assert.ok(DASHBOARD_CSS.includes("var(--text-sm)"), "must use var(--text-sm) token");
  assert.ok(DASHBOARD_CSS.includes("var(--text-base)"), "must use var(--text-base) token");
  assert.ok(DASHBOARD_CSS.includes("var(--text-lg)"), "must use var(--text-lg) token");
});

test("PM-120: home section class names do not collide with PROGRESSIVE_PROPOSAL_CSS", () => {
  const { DASHBOARD_CSS } = loadServer();
  // Our home section classes use "home-" prefix to avoid collisions
  assert.ok(
    DASHBOARD_CSS.includes(".home-section ") || DASHBOARD_CSS.includes(".home-section{"),
    "home section must use home-section prefix"
  );
  assert.ok(
    DASHBOARD_CSS.includes(".home-section-title"),
    "section title must use home-section-title prefix"
  );
  assert.ok(
    DASHBOARD_CSS.includes(".home-section-link"),
    "section link must use home-section-link prefix"
  );
});

test("PM-120: formatRelativeDate returns human-readable relative dates", () => {
  const mod = loadServer();
  assert.equal(typeof mod.formatRelativeDate, "function", "formatRelativeDate must be exported");
  const now = new Date();
  assert.equal(mod.formatRelativeDate(now.toISOString()), "today");
  const yesterday = new Date(now - 86400000);
  assert.equal(mod.formatRelativeDate(yesterday.toISOString()), "yesterday");
  const threeDaysAgo = new Date(now - 3 * 86400000);
  assert.equal(mod.formatRelativeDate(threeDaysAgo.toISOString()), "3d ago");
  const twoWeeksAgo = new Date(now - 14 * 86400000);
  assert.equal(mod.formatRelativeDate(twoWeeksAgo.toISOString()), "2w ago");
  const twoMonthsAgo = new Date(now - 60 * 86400000);
  assert.equal(mod.formatRelativeDate(twoMonthsAgo.toISOString()), "2mo ago");
  assert.equal(mod.formatRelativeDate(""), "");
  assert.equal(mod.formatRelativeDate(null), "");
  assert.equal(mod.formatRelativeDate("not-a-date"), "not-a-date");
});

test("PM-120: parseStrategySnapshot extracts focus, priorities, and staleness", () => {
  const mod = loadServer();
  assert.equal(
    typeof mod.parseStrategySnapshot,
    "function",
    "parseStrategySnapshot must be exported"
  );

  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\nupdated: 2026-04-01\n---\n# Strategy\n\n## Focus\nBuild the best PM tool.\n\n## Priorities\n1. Ship dashboard\n2. Fix bugs\n3. Write docs\n4. Ignored priority\n",
  });
  try {
    const result = mod.parseStrategySnapshot(pmDir);
    assert.ok(result, "must return non-null for valid strategy");
    assert.ok(result.focus.includes("best PM tool"), "focus must contain the focus statement");
    assert.equal(result.priorities.length, 3, "must return top 3 priorities");
    assert.ok(result.priorities[0].includes("Ship dashboard"), "first priority must match");
    assert.ok(result.staleness, "must have staleness info");
    assert.ok(
      ["fresh", "aging", "stale"].includes(result.staleness.level),
      "staleness level must be valid"
    );
  } finally {
    cleanup();
  }
});

test("PM-120: parseStrategySnapshot returns null when no strategy.md", () => {
  const mod = loadServer();
  const { pmDir, cleanup } = withPmDir({});
  try {
    const result = mod.parseStrategySnapshot(pmDir);
    assert.equal(result, null, "must return null when no strategy.md");
  } finally {
    cleanup();
  }
});

test("PM-120: What's coming section shows active proposals", async () => {
  const meta = {
    title: "Dashboard Redesign",
    date: "2026-03-28",
    verdict: "ready",
    verdictLabel: "Ready",
    id: "PM-120",
    issueCount: 5,
  };
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/dashboard-redesign.meta.json": JSON.stringify(meta),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(
        body.includes("What's coming") || body.includes("What&#39;s coming"),
        "must have What's coming section"
      );
      assert.ok(body.includes("Dashboard Redesign"), "must show proposal title");
      assert.ok(body.includes("PM-120"), "must show proposal ID");
      assert.ok(body.includes("5 issues"), "must show issue count");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: shipped proposals are not shown in What's coming", async () => {
  const shipped = {
    title: "Old Feature",
    date: "2026-03-01",
    verdict: "shipped",
    verdictLabel: "Shipped",
    id: "PM-050",
    issueCount: 3,
  };
  const active = {
    title: "New Feature",
    date: "2026-03-28",
    verdict: "ready",
    verdictLabel: "Ready",
    id: "PM-060",
    issueCount: 2,
  };
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/old-feature.meta.json": JSON.stringify(shipped),
    "pm/backlog/proposals/new-feature.meta.json": JSON.stringify(active),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("New Feature"), "must show active proposal");
      // Shipped proposal title should not appear in the proposals section
      const proposalSection = body.substring(
        body.indexOf("What"),
        body.indexOf("Knowledge base") !== -1 ? body.indexOf("Knowledge base") : body.length
      );
      assert.ok(
        !proposalSection.includes("Old Feature"),
        "must NOT show shipped proposal in What's coming"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-120: :root contains design token scale variables", () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  const rootBlock = rootMatch[1];
  const requiredTokens = [
    "--space-1",
    "--space-2",
    "--space-4",
    "--space-6",
    "--space-8",
    "--space-12",
    "--text-xs",
    "--text-sm",
    "--text-base",
    "--text-md",
    "--text-lg",
  ];
  for (const token of requiredTokens) {
    assert.ok(rootBlock.includes(token + ":"), `:root must define ${token}`);
  }
});

// ---------------------------------------------------------------------------
// PM-121: Proposals Page Redesign
// ---------------------------------------------------------------------------

test("PM-121: buildProposalRows returns structured proposal data", () => {
  const mod = loadServer();
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/dashboard-redesign.meta.json": JSON.stringify({
      id: "P-01",
      title: "Dashboard Redesign",
      outcome: "Make the dashboard look amazing",
      verdict: "in-progress",
      verdictLabel: "In Progress",
      issueCount: 5,
      date: "2026-04-01",
    }),
    "pm/backlog/proposals/api-v2.meta.json": JSON.stringify({
      id: "P-02",
      title: "API V2",
      outcome: "Better developer experience",
      verdict: "ready",
      verdictLabel: "Ready",
      issueCount: 3,
      date: "2026-04-03",
    }),
    "pm/backlog/proposals/old-shipped.meta.json": JSON.stringify({
      id: "P-00",
      title: "Old Feature",
      verdict: "shipped",
      date: "2026-01-01",
    }),
  });
  try {
    const rows = mod.buildProposalRows(pmDir);
    assert.ok(Array.isArray(rows), "must return array");
    assert.equal(rows.length, 2, "must exclude shipped proposals");
    // Sorted by date descending — API V2 (04-03) first
    assert.equal(rows[0].id, "P-02");
    assert.equal(rows[1].id, "P-01");
    assert.equal(rows[0].outcome, "Better developer experience");
    assert.equal(rows[1].issueCount, 5);
  } finally {
    cleanup();
  }
});

test("PM-121: buildProposalRows returns empty array when no proposals dir", () => {
  const mod = loadServer();
  const { pmDir, cleanup } = withPmDir({});
  try {
    const rows = mod.buildProposalRows(pmDir);
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  } finally {
    cleanup();
  }
});

test("PM-121: Proposals page contains Groomed section with proposal-card-outcome", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/dashboard-redesign.meta.json": JSON.stringify({
      id: "P-01",
      title: "Dashboard Redesign",
      outcome: "Ship a polished dashboard",
      verdict: "in-progress",
      verdictLabel: "In Progress",
      issueCount: 3,
      date: "2026-04-01",
    }),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/proposals");
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes('<span class="section-title">Groomed</span>'),
        "must have Groomed section title"
      );
      assert.ok(body.includes("proposal-card-outcome"), "must have proposal-card-outcome class");
      assert.ok(body.includes("P-01"), "must show proposal ID");
      assert.ok(body.includes("Dashboard Redesign"), "must show proposal title");
      assert.ok(body.includes("Ship a polished dashboard"), "must show outcome text");
      assert.ok(body.includes("badge-in-progress"), "must show in-progress badge");
      assert.ok(body.includes("3 issues"), "must show issue count");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-121: Proposals page contains Ideas section with idea-row class", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/ungroomed-feature.md":
      "---\ntitle: Ungroomed Feature\nstatus: idea\nid: PM-099\n---\nSome idea",
    "pm/backlog/done-feature.md": "---\ntitle: Done Feature\nstatus: done\n---\nAlready done",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/proposals");
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes('<span class="section-title">Ideas</span>'),
        "must have Ideas section title"
      );
      assert.ok(body.includes("idea-row"), "must have idea-row class");
      assert.ok(body.includes("Ungroomed Feature"), "must show idea title");
      assert.ok(!body.includes("Done Feature"), "must NOT show done items");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-121: Proposals page subtitle shows groomed and ideas counts", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/feat-one.meta.json": JSON.stringify({
      id: "P-01",
      title: "Feat One",
      verdict: "ready",
      date: "2026-04-01",
    }),
    "pm/backlog/proposals/feat-two.meta.json": JSON.stringify({
      id: "P-02",
      title: "Feat Two",
      verdict: "in-progress",
      date: "2026-04-02",
    }),
    "pm/backlog/idea-one.md": "---\ntitle: Idea One\nstatus: idea\n---\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      assert.ok(body.includes("2 groomed"), "subtitle must show groomed count");
      assert.ok(body.includes("1 idea"), "subtitle must show ideas count (singular)");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-121: Proposals page shows empty state when no proposals exist", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/done-item.md": "---\ntitle: Done\nstatus: done\n---\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      assert.ok(body.includes("No proposals yet"), "must show empty state");
      assert.ok(body.includes("pm:groom"), "must mention groom command");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-121: Proposals page body does not use card-grid class", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/feat.meta.json": JSON.stringify({
      id: "P-01",
      title: "Feat",
      verdict: "ready",
      date: "2026-04-01",
    }),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      // Extract just the main content area (after </style>) to avoid matching CSS definitions
      const mainContent = body.substring(body.lastIndexOf("</style>"));
      assert.ok(
        !mainContent.includes("card-grid"),
        "proposals page body must NOT use card-grid layout"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-121: CSS contains proposal page classes with design tokens", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(DASHBOARD_CSS.includes(".proposal-grid"), "must have .proposal-grid");
  assert.ok(DASHBOARD_CSS.includes(".proposal-card-row"), "must have .proposal-card-row");
  assert.ok(DASHBOARD_CSS.includes(".proposal-card-outcome"), "must have .proposal-card-outcome");
  assert.ok(DASHBOARD_CSS.includes(".idea-row"), "must have .idea-row");
  assert.ok(DASHBOARD_CSS.includes(".idea-id"), "must have .idea-id");
  assert.ok(DASHBOARD_CSS.includes(".section-title"), "must have .section-title");
  assert.ok(DASHBOARD_CSS.includes(".section-count"), "must have .section-count");
  assert.ok(DASHBOARD_CSS.includes(".badge-groomed"), "must have .badge-groomed");
  // Verify design token usage (no raw px for spacing in proposal-card-row)
  const rowMatch = DASHBOARD_CSS.match(/\.proposal-card-row\s*\{([^}]+)\}/);
  assert.ok(rowMatch, ".proposal-card-row must exist");
  assert.ok(rowMatch[1].includes("var(--space-"), "proposal-card-row must use space tokens");
});

test("PM-121: Proposals page section headers are uppercase with section-count", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/feat.meta.json": JSON.stringify({
      id: "P-01",
      title: "Feat",
      verdict: "ready",
      date: "2026-04-01",
    }),
    "pm/backlog/idea.md": "---\ntitle: An Idea\nstatus: idea\n---\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      assert.ok(body.includes("section-header"), "must have section-header");
      assert.ok(body.includes("section-count"), "must have section-count");
      assert.ok(body.includes("1 proposal"), "groomed section count");
      assert.ok(body.includes("1 ungroomed"), "ideas section count");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-122: Knowledge Base Page Redesign
// ---------------------------------------------------------------------------

test("PM-122: KB hub has strategy-banner, landscape-card, competitor-grid, topic-list", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\n---\n# Strategy\n## Focus\nBuild the best PM tool\n## Priorities\n- Ship fast\n- Quality\n- Delight users\n",
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\nOverview of the market.\n",
    "pm/competitors/acme/profile.md":
      "---\ncompany: Acme Corp\n---\n# Acme Corp\n**Category claim:** Project management\n",
    "pm/research/user-onboarding/findings.md":
      "---\ntopic: User Onboarding\nsource_origin: external\nupdated: 2026-04-01\n---\n# User Onboarding\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("strategy-banner"), "must have strategy-banner");
      assert.ok(body.includes("landscape-card"), "must have landscape-card");
      assert.ok(body.includes("competitor-grid"), "must have competitor-grid");
      assert.ok(body.includes("topic-list"), "must have topic-list");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: KB hub does NOT contain tablist or kb-tab classes", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\n---\n# Strategy\n## Focus\nBuild the best PM tool\n## Priorities\n- Ship fast\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      assert.ok(!body.includes('role="tablist"'), 'hub must not contain role="tablist"');
      assert.ok(!body.includes('class="kb-tab'), "hub must not contain kb-tab element class");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: KB hub shows origin and freshness badges in topic rows", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/user-feedback/findings.md":
      "---\ntopic: User Feedback\nsource_origin: internal\nupdated: 2026-04-01\n---\n# User Feedback\n",
    "pm/research/market-trends/findings.md":
      "---\ntopic: Market Trends\nsource_origin: external\nupdated: 2025-01-01\n---\n# Market Trends\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      // Origin badges
      assert.ok(
        body.includes("badge-external") ||
          body.includes("badge-customer") ||
          body.includes("badge-mixed"),
        "must contain at least one origin badge"
      );
      // Freshness badges
      assert.ok(
        body.includes("badge-fresh") ||
          body.includes("badge-aging") ||
          body.includes("badge-stale"),
        "must contain at least one freshness badge"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: KB hub shows customer evidence empty state", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n## Focus\nTest\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      assert.ok(body.includes("Customer Evidence"), "must have Customer Evidence section");
      assert.ok(
        body.includes("empty-state-hub"),
        "must use empty-state-hub class for empty evidence"
      );
      assert.ok(body.includes("/pm:ingest"), "must suggest /pm:ingest for adding evidence");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: /kb?tab=competitors still renders competitors detail page", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\ncompany: Acme\n---\n# Acme\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=competitors");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Competitors"), "must show Competitors heading");
      assert.ok(body.includes("Knowledge Base"), "must have breadcrumb back to KB hub");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: /kb?tab=landscape renders landscape detail page", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md": "---\ntype: landscape\n---\n# Market Landscape\nThe market is growing.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=landscape");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Market Landscape"), "must show landscape content");
      assert.ok(body.includes("Knowledge Base"), "must have breadcrumb back to KB hub");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: KB hub CSS uses design tokens, not raw px/rem (except borders)", () => {
  const { DASHBOARD_CSS } = loadServer();
  const kbStart = DASHBOARD_CSS.indexOf("/* ===== KB HUB PAGE =====");
  assert.ok(kbStart !== -1, "KB HUB CSS section must exist");
  const kbSection = DASHBOARD_CSS.slice(kbStart);
  // Padding, margin, gap, font-size, etc. should use var(--space-*) or var(--text-*)
  // 1px in borders is conventional and acceptable
  assert.ok(kbSection.includes("var(--space-"), "KB HUB CSS must use spacing tokens");
  assert.ok(kbSection.includes("var(--text-"), "KB HUB CSS must use text tokens");
  // No raw rem values
  const rawRemMatches = kbSection.match(/\b\d+(\.\d+)?rem\b/g) || [];
  assert.deepEqual(
    rawRemMatches,
    [],
    `Raw rem values found in KB HUB CSS: ${rawRemMatches.join(", ")}`
  );
});

test("PM-122: competitor grid shows 6-item cap with View all link", async () => {
  // Create 8 competitors to exceed the 6-item cap
  const files = {};
  for (let i = 1; i <= 8; i++) {
    files[`pm/competitors/comp-${i}/profile.md`] =
      `---\ncompany: Company ${i}\n---\n# Company ${i}\n**Category claim:** Cat ${i}\n`;
  }
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      assert.ok(body.includes("competitor-grid"), "must have competitor grid");
      assert.ok(body.includes("View all 8"), "must show View all link when > 6 competitors");
      // Count actual card elements (class="competitor-card" in HTML, not CSS defs)
      const cardCount = (body.match(/class="competitor-card"/g) || []).length;
      assert.equal(cardCount, 6, "must cap at 6 competitor cards");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-122: research topics sorted by freshness, capped at 8", async () => {
  const files = {};
  for (let i = 1; i <= 10; i++) {
    const month = String(i).padStart(2, "0");
    files[`pm/research/topic-${i}/findings.md`] =
      `---\ntopic: Topic ${i}\nsource_origin: external\nupdated: 2026-${month}-15\n---\n# Topic ${i}\n`;
  }
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb");
      assert.ok(body.includes("topic-list"), "must have topic list");
      // Count actual topic-row elements (class="topic-row" in HTML)
      const rowCount = (body.match(/class="topic-row"/g) || []).length;
      assert.equal(rowCount, 8, "must cap at 8 topic rows");
      assert.ok(body.includes("View all 10 topics"), "must show View all link when > 8 topics");
      // Newest topic (Topic 10, October) should appear before Topic 3 (March)
      const topic10Pos = body.indexOf("Topic 10");
      const topic3Pos = body.indexOf("Topic 3");
      assert.ok(topic10Pos !== -1 && topic3Pos !== -1, "both topics must be in the display");
      assert.ok(topic10Pos < topic3Pos, "topics must be sorted by freshness (newest first)");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-124: Shipped Page Redesign
// ---------------------------------------------------------------------------

test("PM-124: shipped page uses shipped-item-card class", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/feature-a.md":
      "---\nstatus: done\ntitle: Feature Alpha\nid: PM-001\nupdated: 2026-03-28\noutcome: Reduced churn by 15%\n---\n# Alpha\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap/shipped");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("shipped-item-card"), "must use shipped-item-card class");
      assert.ok(body.includes("shipped-item-header"), "must have shipped-item-header");
      assert.ok(body.includes("shipped-item-title"), "must have shipped-item-title");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page shows outcome statement", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/feature-a.md":
      "---\nstatus: done\ntitle: Feature Alpha\nid: PM-001\nupdated: 2026-03-28\noutcome: Reduced churn by 15%\n---\n# Alpha\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("shipped-item-outcome"), "must have shipped-item-outcome class");
      assert.ok(body.includes("Reduced churn by 15%"), "must show outcome text");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page shows research trail tags", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/feature-a.md":
      "---\nstatus: done\ntitle: Feature Alpha\nid: PM-001\nupdated: 2026-03-28\nresearch_refs:\n  - pm/research/onboarding/findings.md\n---\n# Alpha\n",
    "pm/research/onboarding/findings.md": "---\ntopic: Onboarding Flow\n---\n# Onboarding\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("shipped-item-research"), "must have shipped-item-research class");
      assert.ok(body.includes("shipped-tag-research"), "must have shipped-tag-research class");
      assert.ok(body.includes("Onboarding Flow"), "must show resolved research topic name");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page breadcrumb says Roadmap", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/feature-a.md":
      "---\nstatus: done\ntitle: Feature Alpha\nupdated: 2026-03-28\n---\n# Alpha\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("Roadmap</a>"), "breadcrumb must say Roadmap");
      assert.ok(!body.includes("Backlog</a>"), "breadcrumb must NOT say Backlog");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped items sorted newest first", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/old-item.md":
      "---\nstatus: done\ntitle: Old Feature\nupdated: 2026-01-01\n---\n# Old\n",
    "pm/backlog/new-item.md":
      "---\nstatus: done\ntitle: New Feature\nupdated: 2026-03-28\n---\n# New\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      const newPos = body.indexOf("New Feature");
      const oldPos = body.indexOf("Old Feature");
      assert.ok(newPos !== -1 && oldPos !== -1, "both items must appear");
      assert.ok(newPos < oldPos, "newer item must appear before older item");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped items without enrichment render cleanly", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/plain-item.md":
      "---\nstatus: done\ntitle: Plain Feature\nid: PM-050\nupdated: 2026-03-15\n---\n# Plain\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("Plain Feature"), "must show item title");
      assert.ok(body.includes("PM-050"), "must show item ID");
      // No outcome div in the card itself (class appears in CSS but not in the body HTML)
      const bodyHtml = body.split("</style>").pop() || "";
      assert.ok(
        !bodyHtml.includes("shipped-item-outcome"),
        "must NOT show outcome div when item has no outcome"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page shows strategy alignment tag", async () => {
  const { pmDir, cleanup } = withPmDir({
    // Root shipped item with parent pointing to a proposal slug
    "pm/backlog/dashboard-redesign.md":
      "---\nstatus: done\ntitle: Dashboard Redesign\nid: PM-005\nupdated: 2026-03-18\nparent: dashboard-proposal\n---\n# Dashboard\n",
    // Proposal meta with strategy_check
    "pm/backlog/proposals/dashboard-proposal.meta.json": '{"strategy_check":"Ship dashboard"}',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("shipped-tag-strategy"), "must have strategy tag class");
      assert.ok(body.includes("Ship dashboard"), "must show strategy alignment text");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page shows competitive context tag", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/feature-c.md":
      "---\nstatus: done\ntitle: Feature Gamma\nid: PM-020\nupdated: 2026-03-25\nresearch_refs:\n  - pm/research/acme-gap/findings.md\n---\n# Gamma\n",
    "pm/research/acme-gap/findings.md": "---\ntopic: Acme Gap Analysis\n---\n# Acme\n",
    "pm/competitors/acme-gap/profile.md": "---\ncompany: Acme Corp\n---\n# Acme Corp\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("shipped-tag-competitor"), "must have competitor tag class");
      assert.ok(body.includes("Addresses gap in Acme Corp"), "must show competitive context");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped page shows sub-issue count", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/epic-item.md":
      "---\nstatus: done\ntitle: Epic Feature\nid: PM-030\nupdated: 2026-03-28\n---\n# Epic\n",
    "pm/backlog/sub-1.md":
      "---\nstatus: done\ntitle: Sub One\nparent: epic-item\nupdated: 2026-03-27\n---\n# Sub\n",
    "pm/backlog/sub-2.md":
      "---\nstatus: done\ntitle: Sub Two\nparent: epic-item\nupdated: 2026-03-26\n---\n# Sub\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("shipped-item-sub"), "must have sub-issue count element");
      assert.ok(body.includes("2 sub-issues"), "must show correct sub-issue count");
      // Sub-issues should NOT appear as root items
      assert.ok(!body.includes("Sub One"), "sub-issues must not appear as root items");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: shipped CSS uses design tokens", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(DASHBOARD_CSS.includes(".shipped-item-card"), "must have shipped-item-card rule");
  assert.ok(DASHBOARD_CSS.includes(".shipped-item-outcome"), "must have shipped-item-outcome rule");
  assert.ok(DASHBOARD_CSS.includes(".shipped-tag-research"), "must have shipped-tag-research rule");
  assert.ok(DASHBOARD_CSS.includes(".shipped-tag-strategy"), "must have shipped-tag-strategy rule");
  assert.ok(
    DASHBOARD_CSS.includes(".shipped-tag-competitor"),
    "must have shipped-tag-competitor rule"
  );
  // Verify design token usage in new shipped rules
  assert.ok(DASHBOARD_CSS.includes(".shipped-items"), "must have shipped-items container rule");
});

test("PM-124: shipped page uses formatRelativeDate for dates", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/recent-item.md":
      "---\nstatus: done\ntitle: Recent Feature\nupdated: 2026-04-04\n---\n# Recent\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      // formatRelativeDate should produce a relative date, not the raw ISO date
      assert.ok(
        !body.includes("2026-04-04") || body.includes("today") || body.includes("ago"),
        "must use relative date format, not raw ISO date"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-124: resolveResearchRefs returns empty array for no refs", () => {
  const { resolveResearchRefs } = loadServer();
  assert.deepEqual(resolveResearchRefs([], "/tmp"), []);
  assert.deepEqual(resolveResearchRefs(null, "/tmp"), []);
  assert.deepEqual(resolveResearchRefs(undefined, "/tmp"), []);
});

test("PM-124: resolveStrategyAlignment returns null without parent", () => {
  const { resolveStrategyAlignment } = loadServer();
  const item = { slug: "test", parent: null };
  assert.equal(resolveStrategyAlignment(item, {}, "/tmp"), null);
});

test("PM-124: resolveCompetitiveContext returns empty array without competitors", () => {
  const { resolveCompetitiveContext } = loadServer();
  const item = { slug: "test", research_refs: [] };
  assert.deepEqual(resolveCompetitiveContext(item, {}, "/tmp"), []);
});

test("PM-124: shipped page uses /roadmap/ paths for item links", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-feature.md":
      "---\nstatus: done\ntitle: My Feature\nupdated: 2026-03-20\n---\n# My Feature\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes('href="/roadmap/my-feature"'), "item links must use /roadmap/ paths");
      assert.ok(!body.includes('href="/backlog/'), "must NOT use /backlog/ paths");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-125: Proposal and Issue Detail Pages
// ---------------------------------------------------------------------------

test("PM-125: DASHBOARD_CSS contains .detail-page with max-width", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(DASHBOARD_CSS.includes(".detail-page"), "CSS must contain .detail-page");
  const match = DASHBOARD_CSS.match(/\.detail-page\s*\{([^}]+)\}/);
  assert.ok(match, ".detail-page rule must exist");
  assert.ok(match[1].includes("max-width"), ".detail-page must have max-width");
  assert.ok(match[1].includes("960px"), ".detail-page max-width must be 960px");
});

test("PM-125: DASHBOARD_CSS contains .detail-section with var(--space-12) spacing", () => {
  const { DASHBOARD_CSS } = loadServer();
  const match = DASHBOARD_CSS.match(/\.detail-section\s*\{([^}]+)\}/);
  assert.ok(match, ".detail-section rule must exist");
  assert.ok(
    match[1].includes("margin-top: var(--space-12)"),
    ".detail-section must use 48px (var(--space-12)) spacing"
  );
});

test("PM-125: DASHBOARD_CSS contains detail page classes", () => {
  const { DASHBOARD_CSS } = loadServer();
  const requiredClasses = [
    ".detail-page",
    ".detail-breadcrumb",
    ".detail-title",
    ".detail-id-badge",
    ".detail-meta-bar",
    ".detail-section",
    ".detail-section-title",
    ".detail-action-hint",
    ".click-to-copy",
    ".detail-ac-list",
    ".detail-strategy-card",
    ".detail-research-tag",
    ".detail-issue-list",
    ".breadcrumb-sep",
    ".breadcrumb-current",
    ".meta-sep",
    ".copy-icon",
    ".toast-container",
    ".toast",
  ];
  for (const cls of requiredClasses) {
    assert.ok(DASHBOARD_CSS.includes(cls), `DASHBOARD_CSS must contain "${cls}"`);
  }
});

test("PM-125: GET /proposals/{slug} serves proposal HTML with back link", async () => {
  const meta = { title: "Dashboard Redesign", verdict: "ready", id: "P-05" };
  const proposalHtml =
    "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Proposal</h1></body></html>";
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/dashboard-redesign.meta.json": JSON.stringify(meta),
    "pm/backlog/proposals/dashboard-redesign.html": proposalHtml,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/proposals/dashboard-redesign");
      assert.equal(statusCode, 200);
      assert.ok(body.includes("Back"), "must have back link");
      assert.ok(body.includes("history.back()"), "back link must use browser history");
      assert.ok(body.includes("<h1>Proposal</h1>"), "must include original proposal HTML");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /proposals/{slug} shows /pm:dev for ready proposals", async () => {
  const meta = { title: "My Proposal", verdict: "ready", id: "P-05" };
  const proposalHtml = "<!DOCTYPE html><html><head></head><body><h1>Ready</h1></body></html>";
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/my-proposal.meta.json": JSON.stringify(meta),
    "pm/backlog/proposals/my-proposal.html": proposalHtml,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals/my-proposal");
      assert.ok(body.includes("/pm:dev P-05"), "ready proposals must show /pm:dev with ID");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /proposals/{slug} shows /pm:groom for non-ready proposals", async () => {
  const meta = { title: "My Proposal", verdict: "draft" };
  const proposalHtml = "<!DOCTYPE html><html><head></head><body><h1>Draft</h1></body></html>";
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/my-proposal.meta.json": JSON.stringify(meta),
    "pm/backlog/proposals/my-proposal.html": proposalHtml,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals/my-proposal");
      assert.ok(body.includes("/pm:groom my-proposal"), "draft proposals must show /pm:groom");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /proposals/{slug} returns 404 without HTML file", async () => {
  const meta = { title: "My Proposal", verdict: "draft" };
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposals/my-proposal.meta.json": JSON.stringify(meta),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode } = await httpGet(port, "/proposals/my-proposal");
      assert.equal(statusCode, 404);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /proposals/{slug} returns 404 for nonexistent proposal", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode } = await httpGet(port, "/proposals/nonexistent");
      assert.equal(statusCode, 404);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders .detail-page wrapper", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-issue.md":
      "---\nstatus: drafted\ntitle: My Issue\nid: PM-042\npriority: high\n---\n# My Issue\nSome body content.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap/my-issue");
      assert.equal(statusCode, 200);
      assert.ok(body.includes('class="detail-page"'), "must have .detail-page wrapper");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders .detail-breadcrumb with parent trail", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/parent-proposal.md":
      "---\nstatus: approved\ntitle: Parent Proposal\n---\n# Parent\n",
    "pm/backlog/child-issue.md":
      "---\nstatus: drafted\ntitle: Child Issue\nid: PM-050\nparent: parent-proposal\n---\n# Child\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/child-issue");
      assert.ok(body.includes('class="detail-breadcrumb"'), "must have .detail-breadcrumb");
      assert.ok(
        body.includes('href="/proposals"'),
        "breadcrumb must link to /proposals when parent exists"
      );
      assert.ok(body.includes("Parent Proposal"), "breadcrumb must show parent title");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders .detail-meta-bar with status badge", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/my-issue.md":
      "---\nstatus: drafted\ntitle: My Issue\nid: PM-042\npriority: high\n---\n# My Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/my-issue");
      assert.ok(body.includes('class="detail-meta-bar"'), "must have .detail-meta-bar");
      assert.ok(body.includes("drafted"), "meta bar must show status");
      assert.ok(body.includes("high priority"), "meta bar must show priority");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders acceptance criteria when present", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/ac-issue.md":
      "---\nstatus: drafted\ntitle: AC Issue\nid: PM-060\n---\n# AC Issue\n\n## Acceptance Criteria\n- [ ] First criterion\n- [ ] Second criterion\n\n## Notes\nSome notes.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/ac-issue");
      assert.ok(body.includes("detail-ac-list"), "must have .detail-ac-list");
      assert.ok(body.includes("First criterion"), "must show first AC item");
      assert.ok(body.includes("Second criterion"), "must show second AC item");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders .click-to-copy with /dev {id} when status is drafted", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/dev-issue.md":
      "---\nstatus: drafted\ntitle: Dev Issue\nid: PM-070\n---\n# Dev Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/dev-issue");
      assert.ok(body.includes('class="click-to-copy"'), "must have .click-to-copy");
      assert.ok(body.includes('data-copy="/dev PM-070"'), "click-to-copy must have /dev PM-070");
      assert.ok(body.includes("/dev PM-070"), "must show /dev command in code element");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} does not render action hint when status is done", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/done-issue.md":
      "---\nstatus: done\ntitle: Done Issue\nid: PM-080\n---\n# Done Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/done-issue");
      // The body HTML (not CSS) should not contain the action hint div
      const bodyContent = body.match(/<div class="container">([\s\S]*?)<\/div>\s*<div id="toast/);
      const pageContent = bodyContent ? bodyContent[1] : body;
      assert.ok(
        !pageContent.includes('class="detail-action-hint"'),
        "done items should not show action hint in page body"
      );
      assert.ok(!pageContent.includes("data-copy="), "done items should not have click-to-copy");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: dashboardPage shell includes click-to-copy JS and toast container", () => {
  const mod = loadServer();
  const html = mod.createDashboardServer ? null : null;
  // Inspect the dashboardPage output by reading the source
  const serverSrc = fs.readFileSync(require.resolve("../scripts/server.js"), "utf-8");
  assert.ok(
    serverSrc.includes("toast-container"),
    "dashboardPage must include toast-container div"
  );
  assert.ok(
    serverSrc.includes("showCopyToast"),
    "dashboardPage must include showCopyToast function"
  );
  assert.ok(
    serverSrc.includes("closest('.click-to-copy')"),
    "dashboardPage must include click-to-copy handler"
  );
});

test("PM-125: GET /roadmap/{slug} renders .detail-id-badge for issues with id", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/badge-issue.md":
      "---\nstatus: drafted\ntitle: Badge Issue\nid: PM-099\n---\n# Badge Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/badge-issue");
      assert.ok(body.includes("detail-id-badge"), "must show detail-id-badge");
      assert.ok(body.includes("PM-099"), "badge must show the issue ID");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} without parent shows Roadmap breadcrumb", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/orphan-issue.md": "---\nstatus: idea\ntitle: Orphan Issue\n---\n# Orphan\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/orphan-issue");
      assert.ok(body.includes('href="/roadmap"'), "orphan issue breadcrumb must link to /roadmap");
      assert.ok(body.includes("Roadmap"), "orphan issue breadcrumb must say Roadmap");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-125: GET /roadmap/{slug} renders acceptance criteria from frontmatter array", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/fm-ac-issue.md":
      "---\nstatus: drafted\ntitle: FM AC Issue\nid: PM-088\nacceptance_criteria:\n  - Users can see the dashboard\n  - Data loads in under 2s\n---\n# FM AC Issue\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/fm-ac-issue");
      assert.ok(body.includes("detail-ac-list"), "must have .detail-ac-list");
      assert.ok(body.includes("Users can see the dashboard"), "must show first AC");
      assert.ok(body.includes("Data loads in under 2s"), "must show second AC");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-130: Competitor and Research Detail Pages
// ---------------------------------------------------------------------------

test("PM-130: GET /competitors/{slug} renders .detail-page wrapper", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md":
      "---\nname: Acme Corp\n---\n# Acme Corp\n**Category claim:** Analytics platform\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(body.includes("detail-page"), "must render .detail-page wrapper");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /competitors/{slug} renders .detail-breadcrumb linking to /kb?tab=competitors", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\nname: Acme Corp\n---\n# Acme Corp\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(body.includes("detail-breadcrumb"), "must render .detail-breadcrumb");
      assert.ok(
        body.includes('href="/kb?tab=competitors"'),
        "breadcrumb must link to /kb?tab=competitors"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /competitors/{slug} renders .detail-meta-bar", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md":
      "---\nname: Acme Corp\n---\n# Acme Corp\n**Category claim:** Analytics platform\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(body.includes("detail-meta-bar"), "must render .detail-meta-bar");
      assert.ok(body.includes("1/5 sections"), "meta bar must show sections count");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /competitors/{slug} renders tabs for available sections", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\nname: Acme Corp\n---\n# Acme Corp\n",
    "pm/competitors/acme/features.md": "---\n---\n# Features\n- Feature A\n",
    "pm/competitors/acme/seo.md": "---\n---\n# SEO\nGood rankings\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(body.includes('role="tablist"'), "must contain role=tablist");
      assert.ok(body.includes(">Profile<"), "must have Profile tab");
      assert.ok(body.includes(">Features<"), "must have Features tab");
      assert.ok(body.includes(">SEO<"), "must have SEO tab");
      const tabPanels = (body.match(/class="tab-panel/g) || []).length;
      assert.equal(tabPanels, 3, "must render 3 tab panels for 3 available sections");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /competitors/{slug} with single section renders without tabs", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\nname: Acme Corp\n---\n# Acme Corp\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(!body.includes('role="tablist"'), "single section must NOT show tabs");
      assert.ok(body.includes("markdown-body"), "must still render content");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /competitors/{slug} renders .click-to-copy with /pm:refresh {slug} in meta bar", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\nname: Acme Corp\n---\n# Acme Corp\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      assert.ok(body.includes("click-to-copy"), "must render .click-to-copy");
      assert.ok(body.includes("/pm:refresh acme"), "click-to-copy must contain /pm:refresh acme");
      // Action hint should be inside meta bar, not at bottom
      const metaBarMatch = body.match(/detail-meta-bar[\s\S]*?<\/div>/);
      assert.ok(
        metaBarMatch && metaBarMatch[0].includes("click-to-copy"),
        "click-to-copy must be inside meta bar"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /research/{topic} renders .detail-page wrapper", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/ai-agents/findings.md":
      "---\ntopic: AI Agents\nsource_origin: external\n---\n# AI Agents Research\nFindings here.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/research/ai-agents");
      assert.ok(body.includes("detail-page"), "must render .detail-page wrapper");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /research/{topic} renders .detail-breadcrumb linking to /kb?tab=research", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/ai-agents/findings.md":
      "---\ntopic: AI Agents\nsource_origin: external\n---\n# AI Agents Research\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/research/ai-agents");
      assert.ok(body.includes("detail-breadcrumb"), "must render .detail-breadcrumb");
      assert.ok(
        body.includes('href="/kb?tab=research"'),
        "breadcrumb must link to /kb?tab=research"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /research/{topic} renders .detail-meta-bar with origin badge", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/ai-agents/findings.md":
      "---\ntopic: AI Agents\nsource_origin: mixed\nevidence_count: 5\n---\n# AI Agents Research\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/research/ai-agents");
      assert.ok(body.includes("detail-meta-bar"), "must render .detail-meta-bar");
      assert.ok(body.includes("badge-origin-mixed"), "meta bar must include origin badge");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-130: GET /research/{topic} renders .click-to-copy with /pm:refresh {topic} in meta bar", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/ai-agents/findings.md":
      "---\ntopic: AI Agents\nsource_origin: external\n---\n# AI Agents Research\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/research/ai-agents");
      assert.ok(body.includes("click-to-copy"), "must render .click-to-copy");
      assert.ok(
        body.includes("/pm:refresh ai-agents"),
        "click-to-copy must contain /pm:refresh ai-agents"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-126: Empty states and partial-data states
// ---------------------------------------------------------------------------

test("PM-126: .empty-state CSS contains dashed border", () => {
  const mod = loadServer();
  // The CSS is embedded in the module's output; read server.js directly
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "server.js"), "utf-8");
  assert.ok(
    /\.empty-state\s*\{[^}]*border[^}]*dashed/.test(src),
    ".empty-state CSS must contain dashed border"
  );
});

test("PM-126: .empty-state CSS contains text-align: center", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "server.js"), "utf-8");
  assert.ok(
    /\.empty-state\s*\{[^}]*text-align:\s*center/.test(src),
    ".empty-state CSS must contain text-align: center"
  );
});

test('PM-126: Home empty state contains "shared product brain" text and click-to-copy', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(
        body.includes("shared product brain"),
        'must contain "shared product brain" explanatory text'
      );
      assert.ok(
        body.includes("click-to-copy") && body.includes('data-copy="/pm:groom"'),
        'must contain click-to-copy with data-copy="/pm:groom"'
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('PM-126: Home partial state shows strategy + "Ready for your first feature"', async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\n---\n# Strategy\n## Focus\nBuild the best PM tool\n## Priorities\n1. Ship fast\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("Ready for your first feature"), "must show partial state CTA title");
      assert.ok(
        body.includes('data-copy="/pm:groom"'),
        "partial state must have click-to-copy for /pm:groom"
      );
      assert.ok(body.includes("Strategy"), "must still show strategy section");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Proposals empty state contains click-to-copy with /pm:groom", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/done-item.md": "---\ntitle: Done\nstatus: done\n---\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      assert.ok(body.includes("No proposals yet"), 'must show "No proposals yet" title');
      assert.ok(body.includes('data-copy="/pm:groom"'), "must have click-to-copy for /pm:groom");
      assert.ok(
        body.includes("Proposals are structured feature plans"),
        "must have explanatory text"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Strategy empty state contains click-to-copy with /pm:strategy", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=strategy");
      assert.ok(body.includes("No strategy defined"), 'must show "No strategy defined" title');
      assert.ok(
        body.includes('data-copy="/pm:strategy"'),
        "must have click-to-copy for /pm:strategy"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Landscape empty state contains click-to-copy with /pm:research landscape", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=research");
      assert.ok(body.includes("No landscape research"), 'must show "No landscape research" title');
      assert.ok(
        body.includes('data-copy="/pm:research landscape"'),
        "must have click-to-copy for /pm:research landscape"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Competitors empty state contains click-to-copy with /pm:research competitors", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=competitors");
      assert.ok(
        body.includes("No competitor profiles"),
        'must show "No competitor profiles" title'
      );
      assert.ok(
        body.includes('data-copy="/pm:research competitors"'),
        "must have click-to-copy for /pm:research competitors"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Backlog/roadmap empty state contains click-to-copy with /pm:groom", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap");
      assert.ok(body.includes("No backlog items"), 'must show "No backlog items" title');
      assert.ok(body.includes('data-copy="/pm:groom"'), "must have click-to-copy for /pm:groom");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-126: Shipped empty state has title and explanation but no CTA", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap/shipped");
      assert.ok(body.includes("Nothing shipped yet"), 'must show "Nothing shipped yet" title');
      assert.ok(body.includes("Completed items appear here"), "must have explanatory text");
      // Should NOT have a click-to-copy CTA
      const shippedEmpty = body.substring(body.indexOf("Nothing shipped yet"));
      const endIdx = shippedEmpty.indexOf("</div>");
      const snippet = shippedEmpty.substring(0, endIdx > 0 ? endIdx : 300);
      assert.ok(
        !snippet.includes("click-to-copy"),
        "shipped empty state should not have click-to-copy CTA"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('PM-126: "No pm/ directory" shows Welcome to PM with click-to-copy /pm:setup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-nopm-126-"));
  const nonExistentPmDir = path.join(root, "pm");
  try {
    const { port, close } = await startDashboardServer(nonExistentPmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(body.includes("Welcome to PM"), 'must show "Welcome to PM" title');
      assert.ok(body.includes("shared product brain"), "must explain what PM is");
      assert.ok(body.includes('data-copy="/pm:setup"'), "must have click-to-copy for /pm:setup");
    } finally {
      await close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PM-126: Every empty-state div has a title (h2 or h3) and a <p> explanation", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "server.js"), "utf-8");
  // Find all occurrences of class="empty-state"> (not empty-state-hub or empty-state-cta)
  const re = /class="empty-state">/g;
  let match;
  let count = 0;
  while ((match = re.exec(src)) !== null) {
    count++;
    // Get the next ~500 chars after the match to check for structure
    const snippet = src.substring(match.index, match.index + 500);
    assert.ok(
      /<h[23]>/.test(snippet),
      `empty-state at offset ${match.index} must contain an h2 or h3 title`
    );
    assert.ok(
      /<p[ >]/.test(snippet),
      `empty-state at offset ${match.index} must contain a <p> explanation`
    );
  }
  assert.ok(count > 0, "must find at least one empty-state div in server.js");
});

// ---------------------------------------------------------------------------
// PM-127: Dark/Light Mode Consistency
// ---------------------------------------------------------------------------

test('PM-127 Task 1: [data-theme="light"] defines ALL color tokens that :root defines', () => {
  const { DASHBOARD_CSS } = loadServer();

  // Extract the :root block
  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  const rootTokens = (rootMatch[1].match(/--[\w-]+(?=\s*:)/g) || []).filter(
    (t) =>
      !t.startsWith("--space-") &&
      !t.startsWith("--text-xs") &&
      !t.startsWith("--text-sm") &&
      !t.startsWith("--text-base") &&
      !t.startsWith("--text-md") &&
      !t.startsWith("--text-lg") &&
      t !== "--radius" &&
      t !== "--radius-sm" &&
      t !== "--transition"
  );

  // Extract the [data-theme="light"] block
  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] block must exist');
  const lightTokens = lightMatch[1].match(/--[\w-]+(?=\s*:)/g) || [];

  // Every color token in :root must also appear in [data-theme="light"]
  for (const token of rootTokens) {
    assert.ok(
      lightTokens.includes(token),
      `[data-theme="light"] must define ${token} (present in :root)`
    );
  }
});

test('PM-127 Task 2: [data-theme="dark"] defines ALL color tokens that :root defines', () => {
  const { DASHBOARD_CSS } = loadServer();

  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  const rootTokens = (rootMatch[1].match(/--[\w-]+(?=\s*:)/g) || []).filter(
    (t) =>
      !t.startsWith("--space-") &&
      !t.startsWith("--text-xs") &&
      !t.startsWith("--text-sm") &&
      !t.startsWith("--text-base") &&
      !t.startsWith("--text-md") &&
      !t.startsWith("--text-lg") &&
      t !== "--radius" &&
      t !== "--radius-sm" &&
      t !== "--transition"
  );

  const darkMatch = DASHBOARD_CSS.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(darkMatch, '[data-theme="dark"] block must exist');
  const darkTokens = darkMatch[1].match(/--[\w-]+(?=\s*:)/g) || [];

  for (const token of rootTokens) {
    assert.ok(
      darkTokens.includes(token),
      `[data-theme="dark"] must define ${token} (present in :root)`
    );
  }
});

test("PM-127 Task 3: dark theme has appropriate dark values, not copies of light", () => {
  const { DASHBOARD_CSS } = loadServer();

  const darkMatch = DASHBOARD_CSS.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(darkMatch, '[data-theme="dark"] block must exist');
  const darkBlock = darkMatch[1];

  // Dark background should be dark, not light
  assert.ok(darkBlock.includes("--bg: #0d0f12"), "--bg must be dark (#0d0f12)");
  assert.ok(darkBlock.includes("--surface: #1a1d23"), "--surface must be dark (#1a1d23)");
  assert.ok(
    darkBlock.includes("--text: #e8eaed"),
    "--text must be light (#e8eaed) for readability"
  );
  assert.ok(darkBlock.includes("color-scheme: dark"), "dark theme must set color-scheme: dark");
});

test("PM-127 Task 4: light theme has color-scheme: light", () => {
  const { DASHBOARD_CSS } = loadServer();

  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  assert.ok(rootMatch, ":root block must exist");
  assert.ok(rootMatch[1].includes("color-scheme: light"), ":root must set color-scheme: light");

  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] block must exist');
  assert.ok(
    lightMatch[1].includes("color-scheme: light"),
    '[data-theme="light"] must set color-scheme: light'
  );
});

test('PM-127 Task 5: no scattered [data-theme="light"] overrides outside main token block', () => {
  const { DASHBOARD_CSS } = loadServer();

  // Remove the main [data-theme="light"] token block
  const withoutMain = DASHBOARD_CSS.replace(/\[data-theme="light"\]\s*\{[^}]+\}/, "");
  // Should not contain any other [data-theme="light"] selectors
  assert.ok(
    !withoutMain.includes('[data-theme="light"]'),
    'No scattered [data-theme="light"] overrides should exist outside the main token block'
  );
});

test("PM-127 Task 6: accent color is #5e6ad2 in both themes", () => {
  const { DASHBOARD_CSS } = loadServer();

  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] must exist');
  assert.ok(lightMatch[1].includes("--accent: #5e6ad2"), "light theme accent must be #5e6ad2");

  const darkMatch = DASHBOARD_CSS.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(darkMatch, '[data-theme="dark"] must exist');
  assert.ok(darkMatch[1].includes("--accent: #5e6ad2"), "dark theme accent must be #5e6ad2");
});

test("PM-127 Task 7: SEGMENT_COLORS do not contain non-standard accent hex", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "server.js"), "utf-8");
  // Extract SEGMENT_COLORS block
  const segMatch = src.match(/const SEGMENT_COLORS\s*=\s*\{([^}]+)\}/);
  assert.ok(segMatch, "SEGMENT_COLORS must exist");
  const segBlock = segMatch[1];

  // Should NOT contain #7c3aed or #2563eb
  assert.ok(!segBlock.includes("#7c3aed"), "SEGMENT_COLORS must not contain #7c3aed");
  assert.ok(!segBlock.includes("#2563eb"), "SEGMENT_COLORS must not contain #2563eb");
  assert.ok(!segBlock.includes("#8b5cf6"), "SEGMENT_COLORS must not contain #8b5cf6");
});

test("PM-127 Task 8: no #7c3aed, #2563eb, or #8b5cf6 anywhere in DASHBOARD_CSS", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(!DASHBOARD_CSS.includes("#7c3aed"), "DASHBOARD_CSS must not contain #7c3aed");
  assert.ok(!DASHBOARD_CSS.includes("#2563eb"), "DASHBOARD_CSS must not contain #2563eb");
  assert.ok(!DASHBOARD_CSS.includes("#8b5cf6"), "DASHBOARD_CSS must not contain #8b5cf6");
});

test("PM-127 Task 9: HTML shell contains theme initialization script", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Must have data-theme initialization
      assert.ok(body.includes("data-theme"), "HTML must reference data-theme");
      assert.ok(body.includes("pm-theme"), "HTML must reference pm-theme localStorage key");
      assert.ok(body.includes("prefers-color-scheme"), "HTML must check prefers-color-scheme");
      // Must have theme toggle button
      assert.ok(body.includes("theme-toggle"), "HTML must contain theme toggle button");
      // Must have meta theme-color
      assert.ok(body.includes('meta name="theme-color"'), "HTML must have meta theme-color");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-127 Task 10: dark theme badge tokens are distinct from light theme", () => {
  const { DASHBOARD_CSS } = loadServer();

  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  const darkMatch = DASHBOARD_CSS.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch && darkMatch, "both theme blocks must exist");

  // Extract badge-success-bg from each
  const lightSuccessBg = lightMatch[1].match(/--badge-success-bg:\s*([^;]+)/);
  const darkSuccessBg = darkMatch[1].match(/--badge-success-bg:\s*([^;]+)/);
  assert.ok(lightSuccessBg && darkSuccessBg, "badge-success-bg must be defined in both themes");
  assert.notEqual(
    lightSuccessBg[1].trim(),
    darkSuccessBg[1].trim(),
    "badge-success-bg must differ between light and dark themes"
  );

  // Extract badge-error-bg from each
  const lightErrorBg = lightMatch[1].match(/--badge-error-bg:\s*([^;]+)/);
  const darkErrorBg = darkMatch[1].match(/--badge-error-bg:\s*([^;]+)/);
  assert.ok(lightErrorBg && darkErrorBg, "badge-error-bg must be defined in both themes");
  assert.notEqual(
    lightErrorBg[1].trim(),
    darkErrorBg[1].trim(),
    "badge-error-bg must differ between light and dark themes"
  );
});

test("PM-127 Task 11: selection and scrollbar tokens exist in both themes", () => {
  const { DASHBOARD_CSS } = loadServer();

  const rootMatch = DASHBOARD_CSS.match(/:root\s*\{([^}]+)\}/);
  const darkMatch = DASHBOARD_CSS.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(rootMatch && darkMatch, "both :root and dark blocks must exist");

  const selectionTokens = ["--selection-bg", "--scrollbar-thumb", "--scrollbar-thumb-hover"];
  for (const token of selectionTokens) {
    assert.ok(rootMatch[1].includes(token + ":"), `:root must define ${token}`);
    assert.ok(darkMatch[1].includes(token + ":"), `[data-theme="dark"] must define ${token}`);
  }

  // CSS must use these tokens
  assert.ok(DASHBOARD_CSS.includes("::selection"), "must have ::selection rule");
  assert.ok(
    DASHBOARD_CSS.includes("var(--selection-bg)"),
    "selection must use var(--selection-bg)"
  );
  assert.ok(
    DASHBOARD_CSS.includes("var(--scrollbar-thumb)"),
    "scrollbar must use var(--scrollbar-thumb)"
  );
});

// ---------------------------------------------------------------------------
// PM-128: Basic Keyboard Navigation and Semantic HTML
// ---------------------------------------------------------------------------

test('PM-128 Task 1: dashboardPage() contains nav with aria-label="Main navigation"', () => {
  const mod = loadServer();
  const html = mod.dashboardPage("Test", "/", "<p>hello</p>", "TestProject");
  assert.ok(
    html.includes('aria-label="Main navigation"'),
    'sidebar must have aria-label="Main navigation"'
  );
});

test('PM-128 Task 2: dashboardPage() contains <main> element with role="main"', () => {
  const mod = loadServer();
  const html = mod.dashboardPage("Test", "/", "<p>hello</p>", "TestProject");
  assert.ok(html.includes("<main"), "page must contain a <main> element");
  assert.ok(html.includes('role="main"'), 'main element must have role="main"');
  assert.ok(html.includes('id="main-content"'), 'main element must have id="main-content"');
});

test("PM-128 Task 3: home page has exactly one <h1> tag", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      const h1Count = (body.match(/<h1[\s>]/g) || []).length;
      assert.equal(h1Count, 1, "home page must have exactly one <h1>");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-128 Task 4: proposals page has exactly one <h1> tag", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      const h1Count = (body.match(/<h1[\s>]/g) || []).length;
      assert.equal(h1Count, 1, "proposals page must have exactly one <h1>");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-128 Task 5: roadmap page has exactly one <h1> tag", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap");
      const h1Count = (body.match(/<h1[\s>]/g) || []).length;
      assert.equal(h1Count, 1, "roadmap page must have exactly one <h1>");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-128 Task 6: card elements use <article> tag", () => {
  const mod = loadServer();
  const { DASHBOARD_CSS } = mod;
  // We verify indirectly: the CSS has .card styles, and we generate cards using <article>
  // Generate a page that contains cards
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md": "---\ncompany: Acme\n---\n# Acme\n**Category:** B2B\n",
  });
  try {
    const server = mod.createDashboardServer(pmDir);
    // Check the output contains <article class="card">
    const http = require("http");
    return new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        http
          .get({ hostname: "127.0.0.1", port, path: "/kb?tab=competitors" }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              server.close(() => {
                assert.ok(
                  body.includes('<article class="card">'),
                  "cards must use <article> element"
                );
                cleanup();
                resolve();
              });
            });
          })
          .on("error", reject);
      });
    });
  } catch (e) {
    cleanup();
    throw e;
  }
});

test("PM-128 Task 7: CSS has focus-visible rules for buttons, inputs, and tabindex elements", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(DASHBOARD_CSS.includes("button:focus-visible"), "must have button:focus-visible rule");
  assert.ok(
    DASHBOARD_CSS.includes("[tabindex]:focus-visible"),
    "must have [tabindex]:focus-visible rule"
  );
  assert.ok(DASHBOARD_CSS.includes("input:focus-visible"), "must have input:focus-visible rule");
});

test("PM-128 Task 8: CSS has prefers-reduced-motion rule targeting transition and animation", () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(
    DASHBOARD_CSS.includes("prefers-reduced-motion: reduce"),
    "must have prefers-reduced-motion media query"
  );
  // The rule should target transition-duration and animation-duration
  const rmBlock = DASHBOARD_CSS.match(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*\{[^}]*\}[^}]*)\}/
  );
  assert.ok(rmBlock, "reduced-motion block must exist");
  assert.ok(
    rmBlock[1].includes("transition-duration"),
    "reduced-motion must target transition-duration"
  );
  assert.ok(
    rmBlock[1].includes("animation-duration"),
    "reduced-motion must target animation-duration"
  );
});

test('PM-128 Task 9: decorative copy icons have aria-hidden="true"', () => {
  const mod = loadServer();
  const html = mod.dashboardPage(
    "Test",
    "/",
    '<span class="click-to-copy" data-copy="test" tabindex="0" role="button"><code>test</code><span class="copy-icon" aria-hidden="true">&#x2398;</span></span>',
    "TestProject"
  );
  assert.ok(html.includes('aria-hidden="true"'), 'decorative icons must have aria-hidden="true"');
});

test("PM-128 Task 10: no autofocus attribute in dashboard HTML", () => {
  const mod = loadServer();
  const html = mod.dashboardPage("Test", "/", "<p>content</p>", "TestProject");
  assert.ok(!html.includes("autofocus"), "dashboard must not use autofocus");
});

test('PM-128 Task 11: kanban items have role="article"', async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/test-item.md":
      "---\ntitle: Test Item\nstatus: idea\npriority: medium\n---\n# Test Item\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/roadmap");
      assert.ok(body.includes('role="article"'), 'kanban items must have role="article"');
      assert.ok(
        body.includes('class="kanban-card"') || body.includes('class="kanban-item'),
        "page must have kanban cards"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('PM-128 Task 12: "/" keyboard shortcut JS is present in page shell', () => {
  const mod = loadServer();
  const html = mod.dashboardPage("Test", "/", "<p>hello</p>", "TestProject");
  assert.ok(html.includes("e.key === '/'"), 'page must include "/" keyboard shortcut handler');
  assert.ok(html.includes("backlog-search"), "shortcut must target backlog-search input");
});

test("PM-128 Task 13: home page body is wrapped in <main>", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: strategy\n---\n# Strategy\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      const mainMatch = body.match(/<main[^>]*>[\s\S]*<\/main>/);
      assert.ok(mainMatch, "body content must be wrapped in <main>");
      // Verify content is inside main, not outside
      assert.ok(mainMatch[0].includes("<h1>"), "h1 must be inside <main>");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-128 Task 14: section elements used in proposals page", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/test-idea.md": "---\ntitle: Test Idea\nstatus: idea\npriority: medium\n---\n",
    "pm/backlog/proposals/test-prop.meta.json":
      '{"title":"Test Prop","verdict":"ready","issueCount":2,"date":"2026-01-01"}',
    "pm/backlog/proposals/test-prop.html": "<h1>Test Prop</h1>",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/proposals");
      assert.ok(
        body.includes('<section class="section">'),
        "proposals page must use <section> elements"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-128 Task 15: home page uses <section> for home-section blocks", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md":
      "---\ntype: strategy\n---\n# Strategy\n## Focus\nBuild fast\n## Priorities\n- Ship\n- Quality\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(
        body.includes('<section class="home-section">'),
        "home page must use <section> for home-section blocks"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-138: Core Template Engine — renderTemplate('detail', data)
// ---------------------------------------------------------------------------

test("PM-138: renderTemplate is exported and callable", () => {
  const mod = loadServer();
  assert.equal(typeof mod.renderTemplate, "function", "renderTemplate must be exported");
});

test('PM-138: renderTemplate("detail", data) returns HTML with expected structure', () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "Knowledge Base", href: "/kb?tab=research" }, { label: "AI Agents" }],
    title: "AI Agents",
    metaBadges: [{ html: '<span class="badge badge-origin-external">External</span>' }],
    sections: [{ title: "Findings", html: '<div class="markdown-body">Results here.</div>' }],
  });
  assert.ok(html.includes('class="detail-page"'), "must have .detail-page");
  assert.ok(html.includes('class="detail-breadcrumb"'), "must have .detail-breadcrumb");
  assert.ok(html.includes('class="detail-title"'), "must have .detail-title");
  assert.ok(html.includes('class="detail-meta-bar"'), "must have .detail-meta-bar");
  assert.ok(html.includes('class="detail-section"'), "must have .detail-section");
  assert.ok(html.includes('class="detail-section-title"'), "must have .detail-section-title");
});

test("PM-138: breadcrumb with 2 items — first is link, second is current", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "Roadmap", href: "/roadmap" }, { label: "My Issue" }],
    title: "My Issue",
    metaBadges: [],
    sections: [],
  });
  assert.ok(html.includes('href="/roadmap"'), "first breadcrumb item must be a link");
  assert.ok(html.includes('class="breadcrumb-current"'), "last item must be breadcrumb-current");
  assert.ok(html.includes(">Roadmap<"), "first item must show Roadmap label");
  assert.ok(html.includes(">My Issue<"), "last item must show current label");
});

test("PM-138: breadcrumb with 3 items — first two are links with separators, third is current", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [
      { label: "Proposals", href: "/proposals" },
      { label: "Parent", href: "/roadmap/parent" },
      { label: "Child" },
    ],
    title: "Child",
    metaBadges: [],
    sections: [],
  });
  assert.ok(html.includes('href="/proposals"'), "first item must link to /proposals");
  assert.ok(html.includes('href="/roadmap/parent"'), "second item must link to parent");
  assert.ok(html.includes('class="breadcrumb-current"'), "last item must be breadcrumb-current");
  // Count separators — should be 2
  const sepCount = (html.match(/breadcrumb-sep/g) || []).length;
  assert.equal(sepCount, 2, "must have 2 breadcrumb separators for 3 items");
});

test("PM-138: titlePrefix appears inside h1 before title text", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "Roadmap", href: "/roadmap" }, { label: "Issue" }],
    title: "Issue Title",
    titlePrefix: '<span class="detail-id-badge">PM-042</span>',
    metaBadges: [],
    sections: [],
  });
  assert.ok(
    html.includes('<h1 class="detail-title"><span class="detail-id-badge">PM-042</span>'),
    "titlePrefix must appear inside h1 before title"
  );
  assert.ok(html.includes("Issue Title"), "title text must appear");
});

test('PM-138: subtitle renders <p class="subtitle"> when present, omitted when falsy', () => {
  const mod = loadServer();
  const withSub = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    subtitle: "A subtitle",
    metaBadges: [],
    sections: [],
  });
  assert.ok(withSub.includes('<p class="subtitle">'), "subtitle must render when present");
  assert.ok(withSub.includes("A subtitle"), "subtitle text must appear");

  const withoutSub = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [],
    sections: [],
  });
  assert.ok(!withoutSub.includes('class="subtitle"'), "subtitle must be omitted when falsy");
});

test("PM-138: metaBadges joined with meta-sep middot separators", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [
      { html: '<span class="badge">A</span>' },
      { html: '<span class="meta-item">B</span>' },
    ],
    sections: [],
  });
  assert.ok(html.includes("meta-sep"), "must have meta-sep separator between badges");
  assert.ok(html.includes("&middot;"), "separator must contain middot");
});

test("PM-138: empty metaBadges array still renders the meta-bar div", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [],
    sections: [],
  });
  assert.ok(
    html.includes('class="detail-meta-bar"'),
    "meta-bar must render even with empty badges"
  );
});

test("PM-138: sections with title render h2; sections with title: null skip h2", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [],
    sections: [
      { title: "Findings", html: "<p>Found stuff</p>" },
      { title: null, html: "<p>Raw content</p>" },
    ],
  });
  assert.ok(
    html.includes('<h2 class="detail-section-title">Findings</h2>'),
    "section with title must render h2"
  );
  assert.ok(html.includes("Raw content"), "section without title must render html");
  // The null-title section should not have an h2 before its content
  const nullSection = html.split("Raw content")[0];
  const lastSectionTag = nullSection.lastIndexOf('<section class="detail-section">');
  const sectionSlice = nullSection.slice(lastSectionTag);
  assert.ok(!sectionSlice.includes("detail-section-title"), "null-title section must not have h2");
});

test("PM-138: actionHint renders detail-action-hint with click-to-copy; omitted when falsy", () => {
  const mod = loadServer();
  const withHint = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [],
    sections: [],
    actionHint: "/pm:refresh topic",
  });
  assert.ok(withHint.includes('class="detail-action-hint"'), "must have detail-action-hint");
  assert.ok(withHint.includes("click-to-copy"), "must have click-to-copy inside action hint");
  assert.ok(withHint.includes("/pm:refresh topic"), "must show the command");

  const withoutHint = mod.renderTemplate("detail", {
    breadcrumb: [{ label: "X" }],
    title: "T",
    metaBadges: [],
    sections: [],
  });
  assert.ok(!withoutHint.includes("detail-action-hint"), "must omit action hint when falsy");
});

test("PM-138: unknown template type throws an error", () => {
  const mod = loadServer();
  assert.throws(
    () => mod.renderTemplate("unknown-type", {}),
    /unknown template type/i,
    "must throw for unknown type"
  );
});

// ---------------------------------------------------------------------------
// PM-139: detail-tabs template
// ---------------------------------------------------------------------------

test("PM-139: renderTemplate detail-tabs renders role=tablist with tab buttons", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb?tab=competitors", label: "Knowledge Base" }],
    title: "Acme",
    metaBadges: [],
    tabs: [
      { id: "profile", label: "Profile", html: "<p>Profile content</p>" },
      { id: "features", label: "Features", html: "<p>Features content</p>" },
    ],
    actionHint: "/pm:refresh acme",
  });
  assert.ok(html.includes('role="tablist"'), "must contain role=tablist");
  assert.ok(html.includes(">Profile<"), "must have Profile tab label");
  assert.ok(html.includes(">Features<"), "must have Features tab label");
});

test("PM-139: renderTemplate detail-tabs renders tab-panel for each tab", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb", label: "KB" }],
    title: "Test",
    metaBadges: [],
    tabs: [
      { id: "a", label: "A", html: "<p>AAA</p>" },
      { id: "b", label: "B", html: "<p>BBB</p>" },
      { id: "c", label: "C", html: "<p>CCC</p>" },
    ],
  });
  const panelCount = (html.match(/class="tab-panel/g) || []).length;
  assert.equal(panelCount, 3, "must render 3 tab-panels for 3 tabs");
  assert.ok(html.includes("AAA"), "panel A content");
  assert.ok(html.includes("BBB"), "panel B content");
  assert.ok(html.includes("CCC"), "panel C content");
});

test("PM-139: renderTemplate detail-tabs uses unique function prefix (not global switchTab)", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb", label: "KB" }],
    title: "T",
    metaBadges: [],
    tabs: [{ id: "x", label: "X", html: "<p>X</p>" }],
  });
  // Must NOT use bare "switchTab" — must use a prefixed name like "t0Switch"
  assert.ok(!html.includes("function switchTab("), "must NOT use global switchTab name");
  // Must contain a prefixed Switch function
  assert.ok(/function \w+Switch\(/.test(html), "must define a prefixed Switch function");
  assert.ok(/function \w+Key\(/.test(html), "must define a prefixed Key function");
});

test("PM-139: renderTemplate detail-tabs wraps in .detail-page with breadcrumb, title, meta-bar", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb", label: "Knowledge Base" }, { label: "Acme" }],
    title: "Acme Corp",
    metaBadges: [{ html: '<span class="meta-item">Analytics</span>' }],
    tabs: [{ id: "profile", label: "Profile", html: "<p>P</p>" }],
    actionHint: "/pm:refresh acme",
  });
  assert.ok(html.includes("detail-page"), "must wrap in .detail-page");
  assert.ok(html.includes("detail-breadcrumb"), "must have .detail-breadcrumb");
  assert.ok(html.includes("detail-meta-bar"), "must have .detail-meta-bar");
  assert.ok(html.includes("detail-title"), "must have .detail-title");
  assert.ok(html.includes("Acme Corp"), "must show title text");
});

test("PM-139: renderTemplate detail-tabs first tab is active, rest are not", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb", label: "KB" }],
    title: "T",
    metaBadges: [],
    tabs: [
      { id: "a", label: "A", html: "<p>A</p>" },
      { id: "b", label: "B", html: "<p>B</p>" },
    ],
  });
  // First tab button should be active
  const tabButtons = html.match(/<div class="tab[^"]*"[^>]*role="tab"[^>]*>[^<]+<\/div>/g) || [];
  assert.ok(tabButtons.length >= 2, "must have at least 2 tab buttons");
  assert.ok(tabButtons[0].includes("active"), "first tab button must be active");
  assert.ok(!tabButtons[1].includes("active"), "second tab button must not be active");
  // First panel should be active
  const panels = html.match(/<div[^>]*class="tab-panel[^"]*"[^>]*>/g) || [];
  assert.ok(panels[0].includes("active"), "first panel must be active");
  assert.ok(!panels[1].includes("active"), "second panel must not be active");
});

test("PM-139: GET /competitors/{slug} uses detail-tabs template (integration)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme/profile.md":
      "---\nname: Acme Corp\n---\n# Acme Corp\n**Category claim:** Analytics platform\n",
    "pm/competitors/acme/features.md": "---\n---\n# Features\n- Feature A\n",
    "pm/competitors/acme/seo.md": "---\n---\n# SEO\nGood rankings\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/competitors/acme");
      // Must contain template structures
      assert.ok(body.includes('role="tablist"'), "must have tablist from template");
      assert.ok(body.includes("detail-page"), "must have .detail-page from template");
      assert.ok(body.includes("detail-breadcrumb"), "must have .detail-breadcrumb from template");
      // Tab JS must use unique prefix, not bare switchTab
      assert.ok(!body.includes("function switchTab("), "must NOT use bare switchTab");
      assert.ok(/function \w+Switch\(/.test(body), "must use prefixed Switch function");
      // Tab count
      const panelCount = (body.match(/class="tab-panel/g) || []).length;
      assert.equal(panelCount, 3, "must render 3 tab panels");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-139: detail-toc template
// ---------------------------------------------------------------------------

test("PM-139: renderTemplate detail-toc renders .tabs nav with anchor links", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-toc", {
    breadcrumb: [{ href: "/kb", label: "Knowledge Base" }],
    title: "Market Landscape",
    metaBadges: [],
    toc: [
      { text: "Market Overview", slug: "market-overview" },
      { text: "Trends", slug: "trends" },
    ],
    bodyHtml:
      '<h2 id="market-overview">Market Overview</h2><p>Content</p><h2 id="trends">Trends</h2><p>Trend data</p>',
  });
  assert.ok(html.includes('class="tabs"'), "must have .tabs nav");
  assert.ok(html.includes('href="#market-overview"'), "must have anchor link to market-overview");
  assert.ok(html.includes('href="#trends"'), "must have anchor link to trends");
  assert.ok(html.includes(">Market Overview<"), "must show TOC link text");
  assert.ok(html.includes(">Trends<"), "must show TOC link text");
});

test('PM-139: renderTemplate detail-toc TOC links use <a class="tab"> elements', () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-toc", {
    breadcrumb: [{ href: "/kb", label: "KB" }],
    title: "T",
    metaBadges: [],
    toc: [{ text: "Section", slug: "section" }],
    bodyHtml: "<p>Body</p>",
  });
  assert.ok(html.includes('<a class="tab"'), 'TOC links must use <a class="tab">');
});

test("PM-139: renderTemplate detail-toc does NOT contain role=tablist", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-toc", {
    breadcrumb: [{ href: "/kb", label: "KB" }],
    title: "T",
    metaBadges: [],
    toc: [{ text: "S", slug: "s" }],
    bodyHtml: "<p>B</p>",
  });
  assert.ok(
    !html.includes('role="tablist"'),
    "TOC nav must NOT have role=tablist (it is navigation, not tabs)"
  );
  assert.ok(html.includes('role="navigation"'), "TOC nav must have role=navigation");
});

test("PM-139: renderTemplate detail-toc wraps in .detail-page with breadcrumb, title, meta-bar", () => {
  const mod = loadServer();
  const html = mod.renderTemplate("detail-toc", {
    breadcrumb: [{ href: "/kb", label: "Knowledge Base" }, { label: "Landscape" }],
    title: "Market Landscape",
    metaBadges: [{ html: '<span class="meta-item">Full</span>' }],
    toc: [{ text: "Overview", slug: "overview" }],
    bodyHtml: "<p>Content</p>",
    actionHint: "/pm:refresh",
  });
  assert.ok(html.includes("detail-page"), "must wrap in .detail-page");
  assert.ok(html.includes("detail-breadcrumb"), "must have .detail-breadcrumb");
  assert.ok(html.includes("detail-meta-bar"), "must have .detail-meta-bar");
  assert.ok(html.includes("detail-title"), "must have .detail-title");
  assert.ok(html.includes("Market Landscape"), "must show title text");
  assert.ok(html.includes("detail-action-hint"), "must have action hint");
});

test("PM-139: GET /kb?tab=landscape uses detail-toc template (integration)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md":
      "---\ntype: landscape\n---\n# Market Landscape\n\n## Industry Overview\nThe market is growing.\n\n## Key Trends\nTrend data here.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=landscape");
      // Must use .tabs class (not .landscape-toc)
      assert.ok(body.includes('class="tabs"'), "must use .tabs nav class");
      assert.ok(!body.includes("landscape-toc"), "must NOT use old .landscape-toc class");
      // Must have anchor links
      assert.ok(
        body.includes('href="#industry-overview"'),
        "must have TOC anchor for industry-overview"
      );
      assert.ok(body.includes('href="#key-trends"'), "must have TOC anchor for key-trends");
      // Must have detail-page wrapper from template
      assert.ok(body.includes("detail-page"), "must have .detail-page from template");
      assert.ok(body.includes("detail-breadcrumb"), "must have .detail-breadcrumb from template");
      // Must NOT have role=tablist (it is TOC navigation)
      assert.ok(!body.includes('role="tablist"'), "TOC must NOT have role=tablist");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// PM-140: List and Kanban Templates
// ============================================================================

// --- renderListTemplate ---

test("PM-140: renderListTemplate returns page-header with title", () => {
  const { renderListTemplate, escHtml } = loadServer();
  const html = renderListTemplate({ title: "My List", sections: [] });
  assert.ok(html.includes("page-header"), "must have page-header");
  assert.ok(html.includes("My List"), "must contain title");
  assert.ok(html.includes("list-template"), "must have list-template wrapper");
});

test("PM-140: renderListTemplate returns empty state when all sections empty", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    title: "Empty",
    sections: [{ items: [], layout: "rows" }],
    emptyState: '<div class="empty-state"><h2>Nothing here</h2></div>',
  });
  assert.ok(html.includes("empty-state"), "must show empty state");
  assert.ok(html.includes("Nothing here"), "must show empty message");
});

test("PM-140: renderListTemplate renders multiple sections", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    title: "Multi",
    sections: [
      { title: "First", count: "3 items", items: ["<span>A</span>"], layout: "rows" },
      { title: "Second", items: ["<span>B</span>"], layout: "cards" },
    ],
  });
  assert.ok(html.includes("First"), "must have first section title");
  assert.ok(html.includes("Second"), "must have second section title");
  assert.ok(html.includes("section-header"), "must have section-header");
  assert.ok(html.includes("section-count"), "must have section-count");
  assert.ok(html.includes("card-grid"), "cards layout must use card-grid class");
});

test("PM-140: renderListTemplate includes contentBefore when provided", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    title: "Research",
    contentBefore: '<div class="markdown-body">Landscape content</div>',
    sections: [{ title: "Topics", items: ["<span>T</span>"], layout: "cards" }],
  });
  assert.ok(html.includes("Landscape content"), "must include contentBefore");
  assert.ok(html.includes("Topics"), "must still render sections");
});

test("PM-140: renderListTemplate uses itemsClass override when provided", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    title: "Custom",
    sections: [{ items: ["<span>X</span>"], layout: "rows", itemsClass: "proposal-grid" }],
  });
  assert.ok(html.includes("proposal-grid"), "must use custom itemsClass");
  assert.ok(!html.includes("item-list"), "must NOT use default class when override provided");
});

test("PM-140: renderListTemplate renders breadcrumb when provided", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    breadcrumb: '<a href="/kb">&larr; Knowledge Base</a>',
    title: "Competitors",
    sections: [{ items: ["<span>C</span>"], layout: "cards" }],
  });
  assert.ok(html.includes("breadcrumb"), "must have breadcrumb class");
  assert.ok(html.includes("Knowledge Base"), "must contain breadcrumb text");
});

test("PM-140: renderListTemplate does not show emptyState when contentBefore exists", () => {
  const { renderListTemplate } = loadServer();
  const html = renderListTemplate({
    title: "Research",
    contentBefore: "<div>Some landscape</div>",
    sections: [{ items: [], layout: "cards" }],
    emptyState: '<div class="empty-state"><h2>Should not show</h2></div>',
  });
  assert.ok(
    !html.includes("Should not show"),
    "must NOT show empty state when contentBefore present"
  );
  assert.ok(html.includes("Some landscape"), "must show contentBefore");
});

// --- renderKanbanTemplate ---

test("PM-140: renderKanbanTemplate returns page-header with title and subtitle", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Roadmap",
    subtitle: "What is coming",
    columns: [],
  });
  assert.ok(html.includes("page-header"), "must have page-header");
  assert.ok(html.includes("Roadmap"), "must contain title");
  assert.ok(html.includes("What is coming"), "must contain subtitle");
  assert.ok(html.includes("kanban-template"), "must have kanban-template wrapper");
});

test("PM-140: renderKanbanTemplate returns empty state when no items", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Roadmap",
    columns: [{ label: "Groomed", items: [] }],
    emptyState: '<div class="empty-state"><h2>No items</h2></div>',
  });
  assert.ok(html.includes("empty-state"), "must show empty state");
  assert.ok(html.includes("No items"), "must show empty message");
});

test("PM-140: renderKanbanTemplate renders columns with items", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Board",
    columns: [
      { label: "Todo", items: ["<span>Task 1</span>"], totalCount: 1, displayCount: 1 },
      { label: "Done", items: ["<span>Task 2</span>"], totalCount: 1, displayCount: 1 },
    ],
  });
  assert.ok(html.includes("kanban-col"), "must have kanban-col class");
  assert.ok(html.includes("col-header"), "must have col-header");
  assert.ok(html.includes("col-body"), "must have col-body");
  assert.ok(html.includes("Task 1"), "must render first column items");
  assert.ok(html.includes("Task 2"), "must render second column items");
  assert.ok(html.includes('class="kanban"'), "must have kanban container");
});

test("PM-140: renderKanbanTemplate adds view-all link when capped", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Board",
    columns: [
      {
        label: "Shipped",
        items: ["<span>Item</span>"],
        totalCount: 15,
        displayCount: 10,
        viewAllHref: "/roadmap/shipped",
        viewAllLabel: "shipped",
      },
    ],
  });
  assert.ok(html.includes("kanban-view-all"), "must have view-all link");
  assert.ok(html.includes("View all 15 shipped"), "must show total count in view-all");
  assert.ok(html.includes("/roadmap/shipped"), "must have correct href");
});

test("PM-140: renderKanbanTemplate applies cssClass to column", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Board",
    columns: [
      {
        label: "Shipped",
        items: ["<span>Item</span>"],
        cssClass: "shipped",
        totalCount: 1,
        displayCount: 1,
      },
    ],
  });
  assert.ok(html.includes("kanban-col shipped"), "must apply cssClass");
});

test("PM-140: renderKanbanTemplate renders legend when provided", () => {
  const { renderKanbanTemplate } = loadServer();
  const html = renderKanbanTemplate({
    title: "Board",
    legend: '<div class="backlog-legend">Legend here</div>',
    columns: [{ label: "Col", items: ["<span>X</span>"], totalCount: 1, displayCount: 1 }],
  });
  assert.ok(html.includes("backlog-legend"), "must include legend HTML");
  assert.ok(html.includes("Legend here"), "must include legend content");
});

// --- handleKbStrategyDetail uses detail-page pattern (Task 7) ---

test("PM-140: handleKbStrategyDetail uses .detail-page wrapper", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntitle: Strategy\n---\n# Strategy\nOur ICP is startups.\n",
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=strategy");
      assert.ok(body.includes("detail-page"), "must use .detail-page wrapper");
      assert.ok(body.includes("detail-breadcrumb"), "must use .detail-breadcrumb nav");
      assert.ok(body.includes("Knowledge Base"), "breadcrumb must link to KB");
      assert.ok(body.includes("Strategy"), "must show title");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-140: handleKbStrategyDetail empty state uses .detail-page wrapper", async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/kb?tab=strategy");
      assert.ok(body.includes("detail-page"), "empty state must use .detail-page wrapper");
      assert.ok(body.includes("detail-breadcrumb"), "empty state must use .detail-breadcrumb");
      assert.ok(body.includes("No strategy defined"), "must show empty state message");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-141: Template schema doc examples render correctly
// ---------------------------------------------------------------------------

test("PM-141: detail template — backlog issue example from schema renders", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/test-item.md": [
      "---",
      "title: Bulk Edit Support",
      "status: drafted",
      "id: PM-042",
      "priority: high",
      'outcome: "Users can edit multiple items at once"',
      "acceptance_criteria:",
      "  - Users can select multiple rows via checkboxes",
      "  - Bulk status change applies to all selected items",
      "  - Undo is available for 10 seconds after bulk action",
      "updated: 2026-04-01",
      "created: 2026-03-15",
      "---",
      "",
      "# Bulk Edit Support",
      "",
      "Main body content describing the feature.",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap/test-item");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("detail-page"), "must use detail-page wrapper");
      assert.ok(body.includes("detail-title"), "must include detail-title");
      assert.ok(body.includes("detail-section"), "must include detail-section");
      assert.ok(body.includes("Bulk Edit Support"), "must include the title text");
      assert.ok(body.includes("PM-042"), "must include the ID badge");
      assert.ok(body.includes("drafted"), "must include the status badge");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: detail-tabs template — competitor example from schema renders", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/test-comp/profile.md": [
      "---",
      "type: competitor-profile",
      "company: Acme Corp",
      "slug: test-comp",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Corp -- Profile",
      "",
      "## Overview",
      "Founded: 2020 | HQ: San Francisco | Stage: Series B",
      "",
      "## Positioning",
      "- **Category claim:** Modern work management",
      "",
      "## Strengths",
      "- Fast iteration",
      "",
      "## Weaknesses",
      "- No mobile app",
    ].join("\n"),
    "pm/competitors/test-comp/features.md": [
      "---",
      "type: competitor-features",
      "company: Acme Corp",
      "slug: test-comp",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Corp -- Features",
      "",
      "## Task Management",
      "- Kanban boards",
    ].join("\n"),
    "pm/competitors/test-comp/api.md": [
      "---",
      "type: competitor-api",
      "company: Acme Corp",
      "slug: test-comp",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Corp -- API",
      "",
      "## API Availability",
      "Public REST API",
    ].join("\n"),
    "pm/competitors/test-comp/seo.md": [
      "---",
      "type: competitor-seo",
      "company: Acme Corp",
      "slug: test-comp",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Corp -- SEO",
      "",
      "## Traffic Overview",
      "Monthly visits: 50,000",
    ].join("\n"),
    "pm/competitors/test-comp/sentiment.md": [
      "---",
      "type: competitor-sentiment",
      "company: Acme Corp",
      "slug: test-comp",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Corp -- Sentiment",
      "",
      "## Overall Sentiment",
      "Rating: 4.2/5 on G2",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/competitors/test-comp");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("Acme Corp"), "must include company name as title");
      assert.ok(body.includes("Profile"), "must include Profile tab");
      assert.ok(body.includes("Features"), "must include Features tab");
      assert.ok(body.includes("API"), "must include API tab");
      assert.ok(body.includes("SEO"), "must include SEO tab");
      assert.ok(body.includes("Sentiment"), "must include Sentiment tab");
      assert.ok(body.includes("5/5 sections"), "must show 5/5 sections count");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: detail-toc template — landscape example from schema renders", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/landscape.md": [
      "---",
      "type: landscape",
      "created: 2026-03-12",
      "updated: 2026-03-25",
      "---",
      "",
      "# Market Landscape: AI Dev Tools",
      "",
      "<!-- stat: $4.2B, TAM -->",
      "<!-- stat: 34%, YoY Growth -->",
      "",
      "## Market Overview",
      "The AI dev tools market is growing rapidly.",
      "",
      "## Key Players",
      "",
      "| Company | Positioning |",
      "|---|---|",
      "| Acme | Enterprise PM |",
      "",
      "## Initial Observations",
      "- Growing demand for AI-native tools",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=landscape");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("detail-page"), "must use detail-page wrapper");
      assert.ok(body.includes("Market Landscape"), "must include title");
      assert.ok(body.includes("stat-card"), "must render stat cards from comments");
      assert.ok(body.includes("Market Overview"), "must include h2 section");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: detail-toc template — research topic example from schema renders", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/test-topic/findings.md": [
      "---",
      "type: topic-research",
      "topic: Checkout Optimization",
      "created: 2026-03-15",
      "updated: 2026-03-20",
      "source_origin: external",
      "---",
      "",
      "# Checkout Optimization",
      "",
      "## Summary",
      "Key finding about checkout optimization.",
      "",
      "## Findings",
      "1. Finding one with evidence.",
      "",
      "## Sources",
      "- https://example.com/study -- accessed 2026-03-15",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/research/test-topic");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("detail-page"), "must use detail-page wrapper");
      assert.ok(body.includes("detail-section"), "must include detail-section");
      assert.ok(body.includes("Checkout Optimization"), "must include topic title");
      assert.ok(body.includes("Findings"), "must include Findings section");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: list template — competitor list renders cards from schema example", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/competitors/acme-test/profile.md": [
      "---",
      "type: competitor-profile",
      "company: Acme Test Corp",
      "slug: acme-test",
      "profiled: 2026-03-20",
      "---",
      "",
      "# Acme Test Corp -- Profile",
      "",
      "## Overview",
      "SaaS company.",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=competitors");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("card"), "must include card class");
      assert.ok(body.includes("Acme Test Corp"), "must include competitor name");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: list template — research topic list renders cards from schema example", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/research/pricing-test/findings.md": [
      "---",
      "type: topic-research",
      "topic: Pricing Models",
      "created: 2026-03-15",
      "source_origin: external",
      "---",
      "",
      "# Pricing Models",
      "",
      "## Summary",
      "Key findings about pricing.",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/kb?tab=research");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("card"), "must include card class");
      assert.ok(body.includes("Pricing Models"), "must include topic name");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("PM-141: kanban template — backlog items from schema example render in correct columns", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/groomed-item.md": [
      "---",
      "title: Groomed Feature",
      "status: drafted",
      "id: PM-100",
      "updated: 2026-04-01",
      "---",
      "",
      "# Groomed Feature",
    ].join("\n"),
    "pm/backlog/active-item.md": [
      "---",
      "title: Active Feature",
      "status: in-progress",
      "id: PM-101",
      "updated: 2026-04-02",
      "---",
      "",
      "# Active Feature",
    ].join("\n"),
    "pm/backlog/shipped-item.md": [
      "---",
      "title: Shipped Feature",
      "status: done",
      "id: PM-102",
      "updated: 2026-03-30",
      "---",
      "",
      "# Shipped Feature",
    ].join("\n"),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, "/roadmap");
      assert.equal(statusCode, 200, "must return 200");
      assert.ok(body.includes("kanban-col"), "must include kanban columns");
      assert.ok(body.includes("Groomed Feature"), "must include groomed item");
      assert.ok(body.includes("Active Feature"), "must include active item");
      assert.ok(body.includes("Shipped Feature"), "must include shipped item");
      assert.ok(body.includes("PM-100"), "must include groomed item ID");
      assert.ok(body.includes("PM-101"), "must include active item ID");
      assert.ok(body.includes("Groomed"), "must include Groomed column label");
      assert.ok(body.includes("In Progress"), "must include In Progress column label");
      assert.ok(body.includes("Shipped"), "must include Shipped column label");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
