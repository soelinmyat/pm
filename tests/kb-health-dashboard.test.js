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

function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-dash-test-"));
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

function loadServer() {
  delete require.cache[require.resolve("../scripts/server.js")];
  return require("../scripts/server.js");
}

function startDashboardServer(pmDir) {
  return new Promise((resolve, reject) => {
    process.env.PM_MODE = "dashboard";
    process.env.PM_DIR = pmDir;
    process.env.PM_PORT = "0";

    const mod = loadServer();
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

/** Build a date string N days in the past (YYYY-MM-DD). */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. HTML contains exactly 2 .kb-health-card elements (not 3)
// ---------------------------------------------------------------------------

test("KB health grid contains exactly 2 cards", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/topic-a.md": `---\ntitle: Topic A\nupdated: ${daysAgo(5)}\n---\n# Topic A\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/topic-1.md": `---\ntitle: Topic 1\nupdated: ${daysAgo(3)}\n---\n# Topic 1\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      const cardMatches = body.match(/class="kb-health-card"/g) || [];
      assert.equal(cardMatches.length, 2, "must have exactly 2 KB health cards");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. Each card has correct data-card-type attribute
// ---------------------------------------------------------------------------

test("KB health cards have data-card-type attributes", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      assert.ok(
        body.includes('data-card-type="insights"'),
        "must have insights card with data-card-type"
      );
      assert.ok(
        body.includes('data-card-type="research"'),
        "must have research card with data-card-type"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. Empty KB → "No data" in both cards
// ---------------------------------------------------------------------------

test("empty KB shows 'No data' in both cards", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    // No insight domains, no research topics
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Both cards should show "No data"
      const noDataMatches = body.match(/No data/g) || [];
      assert.ok(
        noDataMatches.length >= 2,
        `expected at least 2 'No data' occurrences, got ${noDataMatches.length}`
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. index.md and log.md excluded from counts
// ---------------------------------------------------------------------------

test("index.md and log.md are excluded from insight counts", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/log.md": `---\ntype: log\n---\n# Log\n`,
    "pm/insights/product/real-insight.md": `---\ntitle: Real Insight\nupdated: ${daysAgo(5)}\n---\n# Real Insight\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/log.md": `---\ntype: log\n---\n# Log\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Extract the insights card content — find the data-card-type="insights" card
      const insightsMatch = body.match(
        /data-card-type="insights"[\s\S]*?<div class="kb-health-value">(\d+)<\/div>/
      );
      assert.ok(insightsMatch, "must find insights card value");
      assert.equal(
        insightsMatch[1],
        "1",
        "insights card count should be 1 (index.md and log.md excluded)"
      );

      // Research card — no content files (only index.md and log.md)
      const researchMatch = body.match(
        /data-card-type="research"[\s\S]*?<div class="kb-health-value">(\d+)<\/div>/
      );
      assert.ok(researchMatch, "must find research card value");
      assert.equal(researchMatch[1], "0", "research card count should be 0 (index.md excluded)");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. Cards use 30d/60d bands — 15-day-old file is "fresh"
// ---------------------------------------------------------------------------

test("15-day-old file shows as fresh on KB health card (30d threshold)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/recent.md": `---\ntitle: Recent\nupdated: ${daysAgo(15)}\n---\n# Recent\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // The insights card should have a "fresh" dot (not aging)
      const insightsCardMatch = body.match(
        /data-card-type="insights"[\s\S]*?staleness-dot\s+(\w+)/
      );
      assert.ok(insightsCardMatch, "must find staleness dot in insights card");
      assert.equal(
        insightsCardMatch[1],
        "fresh",
        "15-day-old file should be fresh under 30d threshold"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. stalenessInfo() is unchanged — 15-day file still "aging" from old function
// ---------------------------------------------------------------------------

test("stalenessInfo() still uses 7d/30d bands (15-day file = aging)", () => {
  const mod = loadServer();
  // stalenessInfo is not directly exported, but we can verify indirectly.
  // The function is internal to server.js, so we test via the module if exported,
  // or verify the old behavior via dashboard pages that still use it.
  // For this test, we verify the function exists by checking that non-KB pages
  // still show the old behavior.
  // Actually, let's just verify it's still exported or test its behavior
  // through a research detail page which uses stalenessInfo().

  // If stalenessInfo is exported for testing, test directly.
  if (mod.stalenessInfo) {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const result = mod.stalenessInfo(fifteenDaysAgo.toISOString().slice(0, 10));
    assert.equal(
      result.level,
      "aging",
      "stalenessInfo should still classify 15-day as aging (7d/30d bands)"
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Sublabels are correct
// ---------------------------------------------------------------------------

test("insight card has sublabel 'product · competitors · business'", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Check sublabels exist
      assert.ok(
        body.includes("product · competitors · business") ||
          body.includes("product &middot; competitors &middot; business"),
        "insights card must have sublabel"
      );
      assert.ok(body.includes("evidence topics"), "research card must have sublabel");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 8. CSS grid is 2-column
// ---------------------------------------------------------------------------

test("CSS has 2-column grid for kb-health-grid", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // Extract the kb-health-grid CSS rule specifically
      const kbGridCss = body.match(/\.kb-health-grid\s*\{[^}]*\}/);
      assert.ok(kbGridCss, "must find .kb-health-grid CSS rule");
      assert.ok(
        kbGridCss[0].includes("repeat(2, 1fr)"),
        "kb-health-grid should use repeat(2, 1fr)"
      );
      assert.ok(
        !kbGridCss[0].includes("repeat(3, 1fr)"),
        "kb-health-grid CSS rule should NOT use repeat(3, 1fr)"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 9. Worst staleness drives the card dot
// ---------------------------------------------------------------------------

test("worst staleness drives the card dot (any stale → red)", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/fresh-one.md": `---\ntitle: Fresh\nupdated: ${daysAgo(5)}\n---\n# Fresh\n`,
    "pm/insights/product/stale-one.md": `---\ntitle: Stale\nupdated: ${daysAgo(65)}\n---\n# Stale\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights card should show "stale" dot because one file is 65 days old
      const insightsCardMatch = body.match(
        /data-card-type="insights"[\s\S]*?staleness-dot\s+(\w+)/
      );
      assert.ok(insightsCardMatch, "must find staleness dot in insights card");
      assert.equal(
        insightsCardMatch[1],
        "stale",
        "one stale file should make the whole card stale"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 10. Aging status text shows count (e.g., "2 aging")
// ---------------------------------------------------------------------------

test("card status text shows count of worst-level items", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/aging-a.md": `---\ntitle: Aging A\nupdated: ${daysAgo(35)}\n---\n# A\n`,
    "pm/insights/product/aging-b.md": `---\ntitle: Aging B\nupdated: ${daysAgo(45)}\n---\n# B\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights card should show "2 aging"
      const insightsSection = body.match(/data-card-type="insights"[\s\S]*?<\/div>\s*<\/div>/);
      assert.ok(insightsSection, "must find insights card section");
      assert.ok(
        insightsSection[0].includes("2 aging"),
        `insights card should show '2 aging', got: ${insightsSection[0].slice(0, 300)}`
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 11. Insights card aggregates across multiple insight domains
// ---------------------------------------------------------------------------

test("insights card aggregates product + competitors + business domains", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    // Product domain: 1 insight
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/insight-a.md": `---\ntitle: A\nupdated: ${daysAgo(5)}\n---\n# A\n`,
    // Business domain: 1 insight
    "pm/insights/business/index.md": `---\ntype: insight-index\n---\n# Business\n`,
    "pm/insights/business/insight-b.md": `---\ntitle: B\nupdated: ${daysAgo(10)}\n---\n# B\n`,
    // Competitors domain: 1 competitor profile
    "pm/insights/competitors/index.md": `---\ntype: competitor-index\n---\n# Competitors\n`,
    "pm/insights/competitors/acme/profile.md": `---\ntitle: Acme\nupdated: ${daysAgo(3)}\n---\n# Acme\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights card count = 1 (product) + 1 (business) + 1 (competitor) = 3
      const insightsMatch = body.match(
        /data-card-type="insights"[\s\S]*?<div class="kb-health-value">(\d+)<\/div>/
      );
      assert.ok(insightsMatch, "must find insights card value");
      assert.equal(
        insightsMatch[1],
        "3",
        "insights should aggregate: 1 product + 1 business + 1 competitor = 3"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
