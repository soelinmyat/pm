"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { applyRoutes } = require("../scripts/insight-routing.js");

const VALIDATE_SCRIPT = path.join(__dirname, "..", "scripts", "validate.js");
const ROUTING_SCRIPT = path.join(__dirname, "..", "scripts", "insight-routing.js");

function createPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "insight-routing-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return {
    pmDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function runValidate(pmDir) {
  try {
    return JSON.parse(
      execFileSync("node", [VALIDATE_SCRIPT, "--dir", pmDir], { encoding: "utf8" })
    );
  } catch (error) {
    return JSON.parse(error.stdout);
  }
}

function makeInsight(overrides = {}) {
  const defaults = {
    type: "insight",
    domain: "product",
    topic: "Test Topic",
    last_updated: "2026-04-10",
    status: "draft",
    confidence: "low",
    sources: [],
  };
  const data = { ...defaults, ...overrides };
  let output = "---\n";
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        output += `${key}: []\n`;
      } else {
        output += `${key}:\n`;
        for (const item of value) {
          output += `  - "${item}"\n`;
        }
      }
    } else {
      output += `${key}: ${JSON.stringify(String(value))}\n`;
    }
  }
  output += "---\n\n";
  output += `# ${data.topic}\n\nSeeded content.\n`;
  return output;
}

function makeEvidence(overrides = {}) {
  const defaults = {
    type: "evidence",
    evidence_type: "research",
    topic: "Test Evidence",
    source_origin: "internal",
    created: "2026-04-10",
    updated: "2026-04-10",
    sources: [],
    cited_by: [],
  };
  const data = { ...defaults, ...overrides };
  let output = "---\n";
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        output += `${key}: []\n`;
      } else {
        output += `${key}:\n`;
        for (const item of value) {
          if (item && typeof item === "object") {
            const entries = Object.entries(item);
            output += `  - ${entries[0][0]}: ${JSON.stringify(String(entries[0][1]))}\n`;
            for (const [nestedKey, nestedValue] of entries.slice(1)) {
              output += `    ${nestedKey}: ${JSON.stringify(String(nestedValue))}\n`;
            }
          } else {
            output += `  - "${item}"\n`;
          }
        }
      }
    } else {
      output += `${key}: ${JSON.stringify(String(value))}\n`;
    }
  }
  output += "---\n\n";
  output += `# ${data.topic}\n\nEvidence body.\n`;
  return output;
}

function makeIndex(title, rows = []) {
  const body = rows.join("\n");
  return `${title}\n\n| Topic/Source | Description | Updated | Status |\n|---|---|---|---|\n${body}${body ? "\n" : ""}`;
}

test("applyRoutes links an existing insight and regenerates the hot index", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "evidence/research/source.md",
      makeEvidence({
        topic: "Source Evidence",
        source_origin: "external",
        sources: [{ url: "https://example.com", accessed: "2026-04-10" }],
      })
    );
    writeFile(
      pmDir,
      "evidence/research/index.md",
      makeIndex("# Index", ["| [source.md](source.md) | Source evidence | 2026-04-10 | external |"])
    );
    writeFile(pmDir, "evidence/research/log.md", "2026-04-10 create evidence/research/source.md\n");
    writeFile(pmDir, "evidence/log.md", "");

    writeFile(
      pmDir,
      "insights/product/target.md",
      makeInsight({
        topic: "Target Topic",
        domain: "product",
        status: "draft",
        confidence: "low",
        sources: [],
      })
    );
    writeFile(
      pmDir,
      "insights/product/index.md",
      makeIndex("# Product Insights", [
        "| [target.md](target.md) | Old description | 2026-04-10 | draft |",
      ])
    );
    writeFile(pmDir, "insights/product/log.md", "2026-04-10 create insights/product/target.md\n");

    const result = applyRoutes(pmDir, {
      routes: [
        {
          mode: "existing",
          evidencePath: "evidence/research/source.md",
          insightPath: "insights/product/target.md",
          description: "Updated routed synthesis",
        },
      ],
    });

    assert.equal(result.routes[0].action, "updated");
    assert.equal(result.rewrites[0].action, "rewritten");

    const insightContent = fs.readFileSync(path.join(pmDir, "insights/product/target.md"), "utf8");
    assert.match(insightContent, /status: "active"/);
    assert.match(insightContent, /sources:\n {2}- "evidence\/research\/source\.md"/);
    assert.match(insightContent, /## Synthesis/);
    assert.match(insightContent, /## Key Findings/);
    assert.doesNotMatch(insightContent, /Seeded content\./);

    const evidenceContent = fs.readFileSync(
      path.join(pmDir, "evidence/research/source.md"),
      "utf8"
    );
    assert.match(evidenceContent, /cited_by:\n {2}- "insights\/product\/target\.md"/);

    const insightLog = fs.readFileSync(path.join(pmDir, "insights/product/log.md"), "utf8");
    assert.match(
      insightLog,
      /cite insights\/product\/target\.md -> evidence\/research\/source\.md/
    );

    const evidenceLog = fs.readFileSync(path.join(pmDir, "evidence/log.md"), "utf8");
    assert.match(
      evidenceLog,
      /cite insights\/product\/target\.md -> evidence\/research\/source\.md/
    );

    const hotIndex = fs.readFileSync(path.join(pmDir, "insights/.hot.md"), "utf8");
    assert.match(hotIndex, /Target Topic/);

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("applyRoutes creates a new insight topic when requested", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(pmDir, "evidence/research/new-evidence.md", makeEvidence({ topic: "New Evidence" }));
    writeFile(
      pmDir,
      "evidence/research/index.md",
      makeIndex("# Index", [
        "| [new-evidence.md](new-evidence.md) | New evidence | 2026-04-10 | internal |",
      ])
    );
    writeFile(
      pmDir,
      "evidence/research/log.md",
      "2026-04-10 create evidence/research/new-evidence.md\n"
    );
    writeFile(pmDir, "evidence/log.md", "");

    const result = applyRoutes(pmDir, {
      routes: [
        {
          mode: "new",
          evidencePath: "evidence/research/new-evidence.md",
          insightPath: "insights/business/new-signal.md",
          domain: "business",
          topic: "New Signal",
          description: "Fresh signal from internal decisions",
        },
      ],
    });

    assert.equal(result.routes[0].action, "created");
    assert.equal(result.rewrites.length, 0);

    const insightPath = path.join(pmDir, "insights/business/new-signal.md");
    const insightContent = fs.readFileSync(insightPath, "utf8");
    assert.match(insightContent, /topic: "New Signal"/);
    assert.match(insightContent, /sources:\n {2}- "evidence\/research\/new-evidence\.md"/);

    const indexContent = fs.readFileSync(path.join(pmDir, "insights/business/index.md"), "utf8");
    assert.match(indexContent, /\[new-signal\.md\]\(new-signal\.md\)/);
    assert.match(indexContent, /Fresh signal from internal decisions/);

    const logContent = fs.readFileSync(path.join(pmDir, "insights/business/log.md"), "utf8");
    assert.match(logContent, /create insights\/business\/new-signal\.md/);

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("insight-routing CLI skips duplicate links without appending duplicates", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "evidence/research/linked.md",
      makeEvidence({ topic: "Linked Evidence", cited_by: ["insights/product/already-linked.md"] })
    );
    writeFile(
      pmDir,
      "evidence/research/index.md",
      makeIndex("# Index", ["| [linked.md](linked.md) | Linked evidence | 2026-04-10 | internal |"])
    );
    writeFile(pmDir, "evidence/research/log.md", "2026-04-10 create evidence/research/linked.md\n");
    writeFile(pmDir, "evidence/log.md", "");
    writeFile(
      pmDir,
      "insights/product/already-linked.md",
      makeInsight({
        topic: "Already Linked",
        domain: "product",
        status: "active",
        confidence: "medium",
        sources: ["evidence/research/linked.md"],
      })
    );
    writeFile(
      pmDir,
      "insights/product/index.md",
      makeIndex("# Product Insights", [
        "| [already-linked.md](already-linked.md) | Existing | 2026-04-10 | active |",
      ])
    );
    writeFile(
      pmDir,
      "insights/product/log.md",
      "2026-04-10 create insights/product/already-linked.md\n"
    );

    const stdout = execFileSync("node", [ROUTING_SCRIPT, "--pm-dir", pmDir], {
      input: JSON.stringify({
        routes: [
          {
            mode: "existing",
            evidencePath: "evidence/research/linked.md",
            insightPath: "insights/product/already-linked.md",
            description: "Existing",
          },
        ],
      }),
      encoding: "utf8",
    });

    const result = JSON.parse(stdout);
    assert.equal(result.routes[0].action, "skipped");

    const evidenceContent = fs.readFileSync(
      path.join(pmDir, "evidence/research/linked.md"),
      "utf8"
    );
    assert.equal((evidenceContent.match(/insights\/product\/already-linked\.md/g) || []).length, 1);

    const insightContent = fs.readFileSync(
      path.join(pmDir, "insights/product/already-linked.md"),
      "utf8"
    );
    assert.equal((insightContent.match(/evidence\/research\/linked\.md/g) || []).length, 1);

    const insightLog = fs.readFileSync(path.join(pmDir, "insights/product/log.md"), "utf8");
    assert.equal((insightLog.match(/cite insights\/product\/already-linked\.md/g) || []).length, 0);

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("applyRoutes reports an error when a new route points at an existing insight path", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(pmDir, "evidence/research/new-evidence.md", makeEvidence({ topic: "New Evidence" }));
    writeFile(
      pmDir,
      "insights/business/new-signal.md",
      makeInsight({
        domain: "business",
        topic: "Existing Signal",
        status: "active",
        confidence: "medium",
      })
    );

    const result = applyRoutes(
      pmDir,
      {
        routes: [
          {
            mode: "new",
            evidencePath: "evidence/research/new-evidence.md",
            insightPath: "insights/business/new-signal.md",
            domain: "business",
            topic: "New Signal",
            description: "Fresh signal from internal decisions",
          },
        ],
      },
      { skipHotIndex: true }
    );

    assert.equal(result.routes[0].action, "error");
    assert.match(result.routes[0].reason, /already exists/);
  } finally {
    cleanup();
  }
});

test("applyRoutes reports per-route failures without aborting earlier successful writes", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(pmDir, "evidence/research/source.md", makeEvidence({ topic: "Source Evidence" }));
    writeFile(
      pmDir,
      "evidence/research/index.md",
      makeIndex("# Index", ["| [source.md](source.md) | Source evidence | 2026-04-10 | internal |"])
    );
    writeFile(pmDir, "evidence/research/log.md", "2026-04-10 create evidence/research/source.md\n");
    writeFile(pmDir, "evidence/log.md", "");

    writeFile(
      pmDir,
      "insights/product/target.md",
      makeInsight({
        topic: "Target Topic",
        domain: "product",
        status: "draft",
        confidence: "low",
        sources: [],
      })
    );
    writeFile(
      pmDir,
      "insights/product/index.md",
      makeIndex("# Product Insights", [
        "| [target.md](target.md) | Old description | 2026-04-10 | draft |",
      ])
    );
    writeFile(pmDir, "insights/product/log.md", "2026-04-10 create insights/product/target.md\n");

    const result = applyRoutes(
      pmDir,
      {
        routes: [
          {
            mode: "existing",
            evidencePath: "evidence/research/source.md",
            insightPath: "insights/product/target.md",
            description: "Updated routed synthesis",
          },
          {
            mode: "existing",
            evidencePath: "evidence/research/missing.md",
            insightPath: "insights/product/target.md",
            description: "Broken route",
          },
        ],
      },
      { skipHotIndex: true }
    );

    assert.equal(result.routes[0].action, "updated");
    assert.equal(result.routes[1].action, "error");
    assert.match(result.routes[1].reason, /missing evidence file/);

    const insightContent = fs.readFileSync(path.join(pmDir, "insights/product/target.md"), "utf8");
    assert.match(insightContent, /sources:\n {2}- "evidence\/research\/source\.md"/);

    const evidenceContent = fs.readFileSync(
      path.join(pmDir, "evidence/research/source.md"),
      "utf8"
    );
    assert.match(evidenceContent, /cited_by:\n {2}- "insights\/product\/target\.md"/);
  } finally {
    cleanup();
  }
});
