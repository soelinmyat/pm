#!/usr/bin/env node
// pm validate-file — validates a single pm/ artifact's frontmatter
// Usage: node validate-file.js --file <path> [--pm-dir <pm-directory>]
// Returns JSON: { ok: true|false, skipped: true|false, errors: [...] }

"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const {
  validateBacklogItem,
  validateStrategy,
  validateInsightFile,
  validateEvidenceFile,
  validateNotesFile,
  validateThinkingFile,
  relativeToPm,
} = require("./validate.js");

function detectArtifactType(filePath, pmDir) {
  const relative = path.relative(pmDir, filePath).split(path.sep).join("/");

  if (relative.startsWith("backlog/") && relative.endsWith(".md")) {
    return "backlog";
  }
  if (relative === "strategy.md") {
    return "strategy";
  }
  if (relative.startsWith("thinking/") && relative.endsWith(".md")) {
    return "thinking";
  }
  if (relative.startsWith("insights/") && relative.endsWith(".md")) {
    const base = path.basename(filePath);
    if (base === "index.md" || base === "log.md") return "skip";
    return "insight";
  }
  if (relative.startsWith("evidence/") && relative.endsWith(".md")) {
    const base = path.basename(filePath);
    if (base === "index.md" || base === "log.md") return "skip";
    return "evidence";
  }

  return "unknown";
}

function findPmDir(filePath) {
  let dir = path.dirname(filePath);
  // Walk up looking for a directory named "pm" that contains this file
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "pm") {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function validateSingleFile(filePath, pmDir) {
  if (!pmDir) {
    pmDir = findPmDir(filePath);
  }

  if (!pmDir) {
    return { ok: true, skipped: true, errors: [] };
  }

  // Check the file is inside pmDir
  const relative = path.relative(pmDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: true, skipped: true, errors: [] };
  }

  if (!filePath.endsWith(".md")) {
    return { ok: true, skipped: true, errors: [] };
  }

  const artifactType = detectArtifactType(filePath, pmDir);
  if (artifactType === "unknown" || artifactType === "skip") {
    return { ok: true, skipped: true, errors: [] };
  }

  const relativeFile = relativeToPm(pmDir, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) {
    return {
      ok: false,
      skipped: false,
      errors: [{ file: relativeFile, field: "-", msg: "no YAML frontmatter found" }],
    };
  }

  const errors = [];
  const kbState = { insights: new Map(), evidence: new Map() };

  switch (artifactType) {
    case "backlog":
      validateBacklogItem(filePath, parsed.data, errors);
      break;
    case "strategy":
      validateStrategy(filePath, parsed.data, errors);
      break;
    case "thinking":
      validateThinkingFile(pmDir, filePath, parsed.data, errors);
      break;
    case "insight":
      validateInsightFile(pmDir, filePath, parsed.data, errors, kbState);
      break;
    case "evidence":
      if (parsed.data.type === "notes") {
        validateNotesFile(pmDir, filePath, parsed.data, errors);
      } else {
        validateEvidenceFile(pmDir, filePath, parsed.data, errors, kbState);
      }
      break;
  }

  return {
    ok: errors.length === 0,
    skipped: false,
    errors: errors.map((e) => ({ file: e.file, field: e.field, message: e.msg })),
  };
}

function main() {
  const args = process.argv.slice(2);
  let filePath = null;
  let pmDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      filePath = args[i + 1];
      i++;
    } else if (args[i] === "--pm-dir" && args[i + 1]) {
      pmDir = args[i + 1];
      i++;
    }
  }

  if (!filePath) {
    console.log(
      JSON.stringify({ ok: false, skipped: false, errors: [{ message: "no --file provided" }] })
    );
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.log(JSON.stringify({ ok: true, skipped: true, errors: [] }));
    process.exit(0);
  }

  const result = validateSingleFile(filePath, pmDir);
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { validateSingleFile };

if (require.main === module) {
  main();
}
