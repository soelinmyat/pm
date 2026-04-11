"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildStatus, renderTextStatus } = require("../scripts/start-status.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-kb-health-"));

  return {
    root,
    write(relPath, content) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return fullPath;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function insightMd(domain, topic, daysAgo) {
  return [
    "---",
    "type: insight",
    `domain: ${domain}`,
    `topic: ${topic}`,
    `last_updated: ${isoDate(daysAgo)}`,
    "status: active",
    "confidence: medium",
    "sources: []",
    "---",
    `# ${topic}`,
    "",
  ].join("\n");
}

function researchMd(topic, daysAgo) {
  return [
    "---",
    "type: evidence",
    "evidence_type: research",
    `created: ${isoDate(daysAgo)}`,
    "sources: []",
    "cited_by: []",
    "---",
    `# ${topic}`,
    "",
  ].join("\n");
}

function setupLayeredProject(project) {
  project.mkdir("pm");
  project.write(".pm/config.json", '{"config_schema":1}');
}

// ---------------------------------------------------------------------------
// Mixed ages across insight domains
// ---------------------------------------------------------------------------

test("kbHealth: mixed ages across insight domains", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    // Product domain: 1 fresh (10d), 1 stale (70d)
    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/log.md", "");
    project.write("pm/insights/product/fresh-item.md", insightMd("product", "Fresh Item", 10));
    project.write("pm/insights/product/stale-item.md", insightMd("product", "Stale Item", 70));

    // Competitors domain: 1 aging (45d)
    project.write("pm/insights/competitors/index.md", "");
    project.write("pm/insights/competitors/log.md", "");
    project.write(
      "pm/insights/competitors/aging-item.md",
      insightMd("competitors", "Aging Item", 45)
    );

    // Business domain: 1 fresh (5d)
    project.write("pm/insights/business/index.md", "");
    project.write("pm/insights/business/log.md", "");
    project.write("pm/insights/business/fresh-biz.md", insightMd("business", "Fresh Biz", 5));

    // Research: 1 stale (90d)
    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/log.md", "");
    project.write("pm/evidence/research/old-study.md", researchMd("Old Study", 90));

    const status = buildStatus(project.root);
    const kbHealth = status.kbHealth;

    // Insights totals
    assert.equal(kbHealth.insights.total, 4);
    assert.equal(kbHealth.insights.fresh, 2);
    assert.equal(kbHealth.insights.aging, 1);
    assert.equal(kbHealth.insights.stale, 1);

    // Research totals
    assert.equal(kbHealth.research.total, 1);
    assert.equal(kbHealth.research.fresh, 0);
    assert.equal(kbHealth.research.aging, 0);
    assert.equal(kbHealth.research.stale, 1);

    // Insight items have domain field
    const productItems = kbHealth.insights.items.filter((i) => i.domain === "product");
    assert.equal(productItems.length, 2);
    const competitorItems = kbHealth.insights.items.filter((i) => i.domain === "competitors");
    assert.equal(competitorItems.length, 1);
    assert.equal(competitorItems[0].level, "aging");
    const businessItems = kbHealth.insights.items.filter((i) => i.domain === "business");
    assert.equal(businessItems.length, 1);
    assert.equal(businessItems[0].level, "fresh");

    // Items have required fields
    for (const item of kbHealth.insights.items) {
      assert.ok(item.path, "item must have path");
      assert.ok(item.domain, "insight item must have domain");
      assert.ok(typeof item.age_days === "number", "item must have age_days");
      assert.ok(["fresh", "aging", "stale"].includes(item.level), "item must have valid level");
    }
    for (const item of kbHealth.research.items) {
      assert.ok(item.path, "item must have path");
      assert.ok(typeof item.age_days === "number", "item must have age_days");
      assert.ok(["fresh", "aging", "stale"].includes(item.level), "item must have valid level");
    }
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// All fresh KB
// ---------------------------------------------------------------------------

test("kbHealth: all fresh KB renders 'KB: All fresh'", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/recent.md", insightMd("product", "Recent", 5));

    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/new-study.md", researchMd("New Study", 3));

    const status = buildStatus(project.root);
    assert.equal(status.kbHealth.insights.fresh, 1);
    assert.equal(status.kbHealth.insights.aging, 0);
    assert.equal(status.kbHealth.insights.stale, 0);
    assert.equal(status.kbHealth.research.fresh, 1);
    assert.equal(status.kbHealth.research.aging, 0);
    assert.equal(status.kbHealth.research.stale, 0);

    const text = renderTextStatus(status);
    assert.match(text, /KB: All fresh/);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// All stale KB
// ---------------------------------------------------------------------------

test("kbHealth: all stale KB", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/old-insight.md", insightMd("product", "Old", 100));
    project.write("pm/insights/product/ancient-insight.md", insightMd("product", "Ancient", 200));

    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/old-research.md", researchMd("Old Research", 80));

    const status = buildStatus(project.root);
    assert.equal(status.kbHealth.insights.stale, 2);
    assert.equal(status.kbHealth.insights.total, 2);
    assert.equal(status.kbHealth.research.stale, 1);
    assert.equal(status.kbHealth.research.total, 1);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Research-only (no insights)
// ---------------------------------------------------------------------------

test("kbHealth: research-only KB — insights returns empty", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    // No insight domains at all, just evidence
    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/study-a.md", researchMd("Study A", 10));
    project.write("pm/evidence/research/study-b.md", researchMd("Study B", 50));

    const status = buildStatus(project.root);
    assert.deepEqual(status.kbHealth.insights, {
      total: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      items: [],
    });
    assert.equal(status.kbHealth.research.total, 2);
    assert.equal(status.kbHealth.research.fresh, 1);
    assert.equal(status.kbHealth.research.aging, 1);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Index/log exclusion
// ---------------------------------------------------------------------------

test("kbHealth: index.md and log.md are excluded from health counts", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    project.write("pm/insights/product/index.md", "---\nlast_updated: 2020-01-01\n---\n# Index\n");
    project.write("pm/insights/product/log.md", "---\nlast_updated: 2020-01-01\n---\n# Log\n");
    project.write("pm/insights/product/real-insight.md", insightMd("product", "Real", 15));

    project.write("pm/evidence/index.md", "---\ncreated: 2020-01-01\n---\n");
    project.write("pm/evidence/research/index.md", "---\ncreated: 2020-01-01\n---\n");
    project.write("pm/evidence/research/log.md", "---\ncreated: 2020-01-01\n---\n");
    project.write("pm/evidence/research/real-research.md", researchMd("Real Research", 20));

    const status = buildStatus(project.root);
    // Only the real content files should be counted
    assert.equal(status.kbHealth.insights.total, 1);
    assert.equal(status.kbHealth.research.total, 1);
    // index.md and log.md have old dates, but they should not appear as stale
    assert.equal(status.kbHealth.insights.stale, 0);
    assert.equal(status.kbHealth.research.stale, 0);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Text rendering format assertion
// ---------------------------------------------------------------------------

test("kbHealth: text rendering shows per-type summary", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    // 2 aging insights
    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/aging-one.md", insightMd("product", "Aging One", 40));
    project.write("pm/insights/product/aging-two.md", insightMd("product", "Aging Two", 50));

    // 3 stale research
    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/stale-a.md", researchMd("Stale A", 70));
    project.write("pm/evidence/research/stale-b.md", researchMd("Stale B", 80));
    project.write("pm/evidence/research/stale-c.md", researchMd("Stale C", 90));

    const status = buildStatus(project.root);
    const text = renderTextStatus(status);

    assert.match(text, /KB: Insights: 2 aging \| Research: 3 stale/);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Backward compat: staleCount = insights.stale + research.stale
// ---------------------------------------------------------------------------

test("kbHealth: backward compat — staleCount equals insights.stale + research.stale", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/stale-insight.md", insightMd("product", "Stale", 70));
    project.write("pm/insights/product/fresh-insight.md", insightMd("product", "Fresh", 5));

    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/stale-research.md", researchMd("Stale Research", 100));

    const status = buildStatus(project.root);
    const expectedStale = status.kbHealth.insights.stale + status.kbHealth.research.stale;
    assert.equal(status.counts.stale, expectedStale);
    assert.equal(status.counts.stale, 2);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Performance: 100+ files in <500ms
// ---------------------------------------------------------------------------

test("kbHealth: performance — 100+ files in <500ms", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    // Create 60 insight files across 3 domains
    for (const domain of ["product", "competitors", "business"]) {
      project.write(`pm/insights/${domain}/index.md`, "");
      for (let i = 0; i < 20; i++) {
        const daysAgo = Math.floor(Math.random() * 90);
        project.write(
          `pm/insights/${domain}/item-${i}.md`,
          insightMd(domain, `Item ${i}`, daysAgo)
        );
      }
    }

    // Create 50 research files
    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/research/index.md", "");
    for (let i = 0; i < 50; i++) {
      const daysAgo = Math.floor(Math.random() * 90);
      project.write(`pm/evidence/research/study-${i}.md`, researchMd(`Study ${i}`, daysAgo));
    }

    const start = Date.now();
    const status = buildStatus(project.root);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 500, `analyzeLayeredKnowledgeBase took ${elapsed}ms, expected <500ms`);
    assert.ok(status.kbHealth.insights.total >= 60);
    assert.ok(status.kbHealth.research.total >= 50);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// renderTextStatus performance: <200ms
// ---------------------------------------------------------------------------

test("kbHealth: renderTextStatus completes in <200ms", () => {
  const status = {
    initialized: true,
    update: { available: false },
    focus: "no attention needed",
    backlog: "5 ideas, 2 planned, 1 in progress, 3 shipped",
    next: "/pm:groom",
    alternatives: [],
    kbHealth: {
      insights: { total: 50, fresh: 40, aging: 8, stale: 2, items: [] },
      research: { total: 30, fresh: 20, aging: 5, stale: 5, items: [] },
    },
  };

  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    renderTextStatus(status);
  }
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 200, `1000 renderTextStatus calls took ${elapsed}ms, expected <200ms`);
});

// ---------------------------------------------------------------------------
// kbHealth not present for uninitialized projects
// ---------------------------------------------------------------------------

test("kbHealth: uninitialized project has no kbHealth field", () => {
  const project = createProject();
  try {
    const status = buildStatus(project.root);
    assert.equal(status.initialized, false);
    assert.equal(status.kbHealth, undefined);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Insight-only KB (no research) — research returns empty
// ---------------------------------------------------------------------------

test("kbHealth: insight-only KB — research returns empty", () => {
  const project = createProject();
  try {
    setupLayeredProject(project);

    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/some-insight.md", insightMd("product", "Some Insight", 10));
    // No evidence directory at all

    const status = buildStatus(project.root);
    assert.equal(status.kbHealth.insights.total, 1);
    assert.deepEqual(status.kbHealth.research, {
      total: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      items: [],
    });
  } finally {
    project.cleanup();
  }
});
