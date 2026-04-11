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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-drill-test-"));
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
// 1. Pre-rendered HTML contains hidden drill-down divs with correct
//    data-drilldown-type attributes
// ---------------------------------------------------------------------------

test("drill-down divs have data-drilldown-type for each card type", async () => {
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
      assert.ok(
        body.includes('data-drilldown-type="insights"'),
        "must have insights drill-down panel"
      );
      assert.ok(
        body.includes('data-drilldown-type="research"'),
        "must have research drill-down panel"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. Drill-down panels are hidden by default (display:none or hidden attr)
// ---------------------------------------------------------------------------

test("drill-down panels are hidden by default", async () => {
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
      // Drill-down panels should have style="display:none" or CSS class that hides them
      const drilldownMatches = body.match(/class="drilldown"[^>]*style="display:\s*none"/g) || [];
      assert.ok(
        drilldownMatches.length >= 2,
        `expected at least 2 hidden drill-down panels, got ${drilldownMatches.length}`
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. Drill-down rows contain correct item data (name, age)
// ---------------------------------------------------------------------------

test("drill-down rows contain item name and age in days", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/topic-a.md": `---\ntitle: Topic A\nupdated: ${daysAgo(45)}\n---\n# Topic A\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/topic-1.md": `---\ntitle: Topic 1\nupdated: ${daysAgo(70)}\n---\n# Topic 1\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Research drill-down should contain "Topic 1" and age "70d"
      const researchPanel = body.match(/data-drilldown-type="research"[\s\S]*?<\/div>\s*<\/div>/);
      assert.ok(researchPanel, "must find research drill-down panel");
      assert.ok(researchPanel[0].includes("Topic 1"), "research drill-down must contain 'Topic 1'");
      assert.ok(researchPanel[0].includes("70d"), "research drill-down must contain age '70d'");

      // Insights drill-down should contain "Topic A" and age "45d"
      const insightsPanel = body.match(/data-drilldown-type="insights"[\s\S]*?<\/div>\s*<\/div>/);
      assert.ok(insightsPanel, "must find insights drill-down panel");
      assert.ok(insightsPanel[0].includes("Topic A"), "insights drill-down must contain 'Topic A'");
      assert.ok(insightsPanel[0].includes("45d"), "insights drill-down must contain age '45d'");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. Insights drill-down shows domain tags, research does not
// ---------------------------------------------------------------------------

test("insights drill-down rows have domain tags, research rows do not", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/insight-a.md": `---\ntitle: Insight A\nupdated: ${daysAgo(40)}\n---\n# Insight A\n`,
    "pm/insights/competitors/index.md": `---\ntype: competitor-index\n---\n# Competitors\n`,
    "pm/insights/competitors/acme/profile.md": `---\ntitle: Acme Corp\nupdated: ${daysAgo(50)}\n---\n# Acme\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/topic-1.md": `---\ntitle: Topic 1\nupdated: ${daysAgo(35)}\n---\n# Topic 1\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights panel should have drilldown-domain spans
      const insightsPanel = body.match(
        /data-drilldown-type="insights"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(insightsPanel, "must find insights drill-down panel");
      assert.ok(
        insightsPanel[0].includes("drilldown-domain"),
        "insights drill-down must have domain tags"
      );
      // Should include "product" and "competitors" domain labels
      assert.ok(
        insightsPanel[0].includes("product"),
        "insights drill-down must tag product domain"
      );
      assert.ok(
        insightsPanel[0].includes("competitors"),
        "insights drill-down must tag competitors domain"
      );

      // Research panel should NOT have drilldown-domain
      const researchPanel = body.match(
        /data-drilldown-type="research"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(researchPanel, "must find research drill-down panel");
      assert.ok(
        !researchPanel[0].includes("drilldown-domain"),
        "research drill-down must NOT have domain tags"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. Items sorted by age descending (stalest first)
// ---------------------------------------------------------------------------

test("drill-down items are sorted by age descending", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    // All three items are non-fresh (aging/stale) so they appear in the drill-down
    "pm/insights/product/oldest.md": `---\ntitle: Oldest Item\nupdated: ${daysAgo(65)}\n---\n# Oldest\n`,
    "pm/insights/product/middle.md": `---\ntitle: Middle Item\nupdated: ${daysAgo(45)}\n---\n# Middle\n`,
    "pm/insights/product/newest.md": `---\ntitle: Newest Item\nupdated: ${daysAgo(35)}\n---\n# Newest\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Extract the insights drill-down panel
      const insightsPanel = body.match(
        /data-drilldown-type="insights"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(insightsPanel, "must find insights drill-down panel");

      // Extract ages in order from drilldown-age spans
      const ageMatches = [...insightsPanel[0].matchAll(/class="drilldown-age">(\d+)d</g)];
      assert.ok(ageMatches.length >= 3, `expected 3 items, got ${ageMatches.length}`);

      const ages = ageMatches.map((m) => parseInt(m[1], 10));
      for (let i = 1; i < ages.length; i++) {
        assert.ok(
          ages[i - 1] >= ages[i],
          `ages must be descending: ${ages[i - 1]} should be >= ${ages[i]}`
        );
      }
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. Inline <script> tag present in KB section output
// ---------------------------------------------------------------------------

test("inline <script> tag present for drill-down toggle", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");
      // The inline script should reference kb-health-card click handling
      assert.ok(
        body.includes("kb-health-card") && body.includes("<script>"),
        "must have inline <script> for drill-down toggle"
      );
      // Script should reference drilldown toggling
      const scriptMatch = body.match(/<script>[\s\S]*?kb-health-card[\s\S]*?<\/script>/);
      assert.ok(scriptMatch, "must have a <script> block referencing kb-health-card");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. All-fresh card drill-down shows "All items are fresh" message
// ---------------------------------------------------------------------------

test("all-fresh card drill-down shows 'All items are fresh'", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/fresh-one.md": `---\ntitle: Fresh One\nupdated: ${daysAgo(5)}\n---\n# Fresh\n`,
    "pm/insights/product/fresh-two.md": `---\ntitle: Fresh Two\nupdated: ${daysAgo(10)}\n---\n# Fresh\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/fresh-topic.md": `---\ntitle: Fresh Topic\nupdated: ${daysAgo(3)}\n---\n# Fresh\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Both cards are all fresh — drill-down should show the message
      const insightsPanel = body.match(
        /data-drilldown-type="insights"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(insightsPanel, "must find insights drill-down panel");
      assert.ok(
        insightsPanel[0].includes("All items are fresh"),
        "all-fresh insights drill-down must show 'All items are fresh'"
      );

      const researchPanel = body.match(
        /data-drilldown-type="research"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(researchPanel, "must find research drill-down panel");
      assert.ok(
        researchPanel[0].includes("All items are fresh"),
        "all-fresh research drill-down must show 'All items are fresh'"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 8. Drill-down header shows "{Type} · {N} {level}" format
// ---------------------------------------------------------------------------

test("drill-down header shows type, count, and level", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/stale-a.md": `---\ntitle: Stale A\nupdated: ${daysAgo(65)}\n---\n# Stale\n`,
    "pm/insights/product/stale-b.md": `---\ntitle: Stale B\nupdated: ${daysAgo(70)}\n---\n# Stale\n`,
    "pm/insights/product/fresh-c.md": `---\ntitle: Fresh C\nupdated: ${daysAgo(5)}\n---\n# Fresh\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/aging-topic.md": `---\ntitle: Aging Topic\nupdated: ${daysAgo(45)}\n---\n# Aging\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights: 2 stale items → header "Insights · 2 stale"
      const insightsHeader = body.match(
        /data-drilldown-type="insights"[\s\S]*?drilldown-header[\s\S]*?<\/div>/
      );
      assert.ok(insightsHeader, "must find insights drill-down header");
      assert.ok(
        /Insights\s.*\s*2 stale/.test(insightsHeader[0]) ||
          (insightsHeader[0].includes("Insights") && insightsHeader[0].includes("2 stale")),
        `insights header should show 'Insights · 2 stale', got: ${insightsHeader[0].slice(0, 200)}`
      );

      // Research: 1 aging item → header "Research · 1 aging"
      const researchHeader = body.match(
        /data-drilldown-type="research"[\s\S]*?drilldown-header[\s\S]*?<\/div>/
      );
      assert.ok(researchHeader, "must find research drill-down header");
      assert.ok(
        researchHeader[0].includes("Research") && researchHeader[0].includes("1 aging"),
        `research header should show 'Research · 1 aging', got: ${researchHeader[0].slice(0, 200)}`
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 9. Drill-down rows have staleness dots
// ---------------------------------------------------------------------------

test("drill-down rows have staleness dots with correct level", async () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": `---\ntype: strategy\nupdated: ${daysAgo(1)}\n---\n# Strategy\n`,
    "pm/insights/product/index.md": `---\ntype: insight-index\n---\n# Product\n`,
    "pm/insights/product/stale-one.md": `---\ntitle: Stale One\nupdated: ${daysAgo(65)}\n---\n# Stale\n`,
    "pm/evidence/research/index.md": `---\ntype: evidence-index\n---\n# Research\n`,
    "pm/evidence/research/aging-one.md": `---\ntitle: Aging One\nupdated: ${daysAgo(45)}\n---\n# Aging\n`,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, "/");

      // Insights panel should have a stale dot
      const insightsPanel = body.match(
        /data-drilldown-type="insights"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(insightsPanel, "must find insights drill-down");
      assert.ok(
        insightsPanel[0].includes("staleness-dot stale"),
        "stale item row should have staleness-dot stale"
      );

      // Research panel should have an aging dot
      const researchPanel = body.match(
        /data-drilldown-type="research"[\s\S]*?(?=data-drilldown-type|<script|$)/
      );
      assert.ok(researchPanel, "must find research drill-down");
      assert.ok(
        researchPanel[0].includes("staleness-dot aging"),
        "aging item row should have staleness-dot aging"
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
