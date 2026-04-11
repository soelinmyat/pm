#!/usr/bin/env node
// pm hot-index — generates and queries pm/insights/.hot.md
// Usage:
//   Generate: node scripts/hot-index.js --dir <pm-dir> --generate
//   Filter:   node scripts/hot-index.js --dir <pm-dir> [--domain <d>] [--confidence <c>] [--min-sources <n>] [--since <YYYY-MM-DD>]

"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");

// ========== CLI parsing ==========

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    dir: null,
    domain: null,
    confidence: null,
    minSources: null,
    since: null,
    generate: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dir":
        opts.dir = args[++i];
        break;
      case "--domain":
        opts.domain = args[++i];
        break;
      case "--confidence":
        opts.confidence = args[++i];
        break;
      case "--min-sources":
        opts.minSources = parseInt(args[++i], 10);
        break;
      case "--since":
        opts.since = args[++i];
        break;
      case "--generate":
        opts.generate = true;
        break;
    }
  }

  return opts;
}

// ========== File walking ==========

function walkInsightFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkInsightFiles(entryPath, files);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      entry.name !== "index.md" &&
      entry.name !== "log.md"
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

// ========== Scanning ==========

function scanInsights(insightsDir) {
  const files = walkInsightFiles(insightsDir);
  const entries = [];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      process.stderr.write(`warning: cannot read ${filePath}: ${err.message}\n`);
      continue;
    }

    let parsed;
    try {
      parsed = parseFrontmatter(content);
    } catch (err) {
      process.stderr.write(`warning: parse error in ${filePath}: ${err.message}\n`);
      continue;
    }

    if (!parsed.hasFrontmatter) {
      process.stderr.write(`warning: no frontmatter in ${filePath}, skipping\n`);
      continue;
    }

    const data = parsed.data;

    if (data.type !== "insight") {
      continue;
    }

    const relativePath = path.relative(insightsDir, filePath);
    const parts = relativePath.split(path.sep);
    const domain = parts.length > 1 ? parts[0] : data.domain || "unknown";
    const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;

    entries.push({
      domain,
      topic: data.topic || path.basename(filePath, ".md"),
      confidence: data.confidence || "low",
      sourceCount,
      lastUpdated: data.last_updated || "",
      filePath: relativePath.split(path.sep).join("/"),
    });
  }

  return entries;
}

// ========== Sorting ==========

function sortEntries(entries) {
  return entries.sort((a, b) => {
    // domain alpha
    const domainCmp = a.domain.localeCompare(b.domain);
    if (domainCmp !== 0) return domainCmp;
    // source count desc
    if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
    // topic alpha
    return a.topic.localeCompare(b.topic);
  });
}

// ========== Generate ==========

function generateHotIndex(insightsDir) {
  const entries = scanInsights(insightsDir);
  sortEntries(entries);

  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push("---");
  lines.push(`generated: ${today}`);
  lines.push(`count: ${entries.length}`);
  lines.push("---");
  lines.push("");
  lines.push("# Hot Index");
  lines.push("");
  lines.push("| Domain | Topic | Confidence | Sources | Updated |");
  lines.push("|---|---|---|---|---|");

  for (const entry of entries) {
    lines.push(
      `| ${entry.domain} | ${entry.topic} | ${entry.confidence} | ${entry.sourceCount} | ${entry.lastUpdated} |`
    );
  }

  lines.push("");

  const content = lines.join("\n");
  const hotPath = path.join(insightsDir, ".hot.md");
  const tmpPath = path.join(insightsDir, ".hot.md.tmp");

  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, hotPath);

  return { count: entries.length };
}

// ========== Filter ==========

function parseHotTable(content) {
  const tableLines = content
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));

  if (tableLines.length < 2) {
    return [];
  }

  // Skip header + divider
  return tableLines.slice(2).map((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    return {
      domain: cells[0] || "",
      topic: cells[1] || "",
      confidence: cells[2] || "",
      sourceCount: parseInt(cells[3], 10) || 0,
      lastUpdated: cells[4] || "",
    };
  });
}

function filterEntries(rows, opts) {
  return rows.filter((row) => {
    if (opts.domain && row.domain !== opts.domain) return false;
    if (opts.confidence && row.confidence !== opts.confidence) return false;
    if (
      opts.minSources !== null &&
      opts.minSources !== undefined &&
      row.sourceCount < opts.minSources
    )
      return false;
    if (opts.since && row.lastUpdated < opts.since) return false;
    return true;
  });
}

function formatTable(rows) {
  const lines = [];
  lines.push("| Domain | Topic | Confidence | Sources | Updated |");
  lines.push("|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.domain} | ${row.topic} | ${row.confidence} | ${row.sourceCount} | ${row.lastUpdated} |`
    );
  }
  return lines.join("\n");
}

// ========== Main ==========

function main() {
  const opts = parseArgs(process.argv);

  if (!opts.dir) {
    process.stderr.write("error: --dir is required\n");
    process.exit(1);
  }

  const insightsDir = path.join(opts.dir, "insights");

  if (opts.generate) {
    if (!fs.existsSync(insightsDir)) {
      fs.mkdirSync(insightsDir, { recursive: true });
    }
    const result = generateHotIndex(insightsDir);
    process.stdout.write(`Generated .hot.md with ${result.count} entries\n`);
    process.exit(0);
  }

  // Filter mode: read existing .hot.md
  const hotPath = path.join(insightsDir, ".hot.md");
  if (!fs.existsSync(hotPath)) {
    process.stderr.write(`error: ${hotPath} not found. Run with --generate first.\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(hotPath, "utf8");
  const rows = parseHotTable(content);
  const filtered = filterEntries(rows, opts);
  process.stdout.write(formatTable(filtered) + "\n");
  process.exit(0);
}

main();
