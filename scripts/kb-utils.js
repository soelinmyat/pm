#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");

function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function loadMarkdown(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  return {
    content,
    frontmatter: parsed.hasFrontmatter ? parsed.data : {},
    body: parsed.body || "",
    hasFrontmatter: parsed.hasFrontmatter,
  };
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(text) {
  return normalizeWhitespace(
    String(text || "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#+\s+/gm, "")
  );
}

function getSection(body, heading) {
  const lines = String(body || "").split(/\r?\n/);
  let active = false;
  const collected = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (active) {
        break;
      }
      active = headingMatch[1].trim() === heading;
      continue;
    }

    if (active) {
      collected.push(line);
    }
  }

  return collected.join("\n").trim();
}

function firstSentence(text) {
  const plain = stripMarkdown(text);
  if (!plain) {
    return "";
  }

  const match = plain.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = match ? match[1] : plain;
  const trimmed = normalizeWhitespace(sentence);
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function ensureRelativePath(rawPath, prefix) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error(`${prefix} path is required`);
  }

  const normalized = rawPath.replace(/\\/g, "/").replace(/^pm\//, "");
  if (!normalized.startsWith(prefix)) {
    throw new Error(`path must stay under ${prefix}, got "${rawPath}"`);
  }
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`path must be a safe relative KB path, got "${rawPath}"`);
  }
  return normalized;
}

function ensureEvidencePath(rawPath) {
  return ensureRelativePath(rawPath, "evidence/");
}

function ensureInsightPath(rawPath) {
  return ensureRelativePath(rawPath, "insights/");
}

function serializeArrayField(key, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return `${key}: []\n`;
  }

  let output = `${key}:\n`;
  for (const value of values) {
    if (typeof value === "string") {
      output += `  - ${quoteYaml(value)}\n`;
      continue;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        throw new Error(`unsupported empty object entry in ${key}`);
      }
      const [firstKey, firstValue] = entries[0];
      output += `  - ${firstKey}: ${quoteYaml(firstValue)}\n`;
      for (const [nestedKey, nestedValue] of entries.slice(1)) {
        output += `    ${nestedKey}: ${quoteYaml(nestedValue)}\n`;
      }
      continue;
    }
    throw new Error(`unsupported ${key} entry: ${JSON.stringify(value)}`);
  }
  return output;
}

function serializeFrontmatter(frontmatter, preferredKeys = []) {
  let output = "---\n";
  const written = new Set();

  function writeField(key, value) {
    if (value === undefined) {
      return;
    }
    written.add(key);
    if (Array.isArray(value)) {
      output += serializeArrayField(key, value);
      return;
    }
    output += `${key}: ${quoteYaml(value)}\n`;
  }

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      writeField(key, frontmatter[key]);
    }
  }

  for (const key of Object.keys(frontmatter).sort()) {
    if (written.has(key)) {
      continue;
    }
    writeField(key, frontmatter[key]);
  }

  output += "---\n";
  return output;
}

function writeMarkdown(filePath, frontmatter, body, preferredKeys) {
  const content = `${serializeFrontmatter(frontmatter, preferredKeys)}\n${body}`;
  writeAtomic(filePath, content);
}

module.exports = {
  ensureEvidencePath,
  ensureInsightPath,
  ensureRelativePath,
  firstSentence,
  getSection,
  loadMarkdown,
  normalizeWhitespace,
  quoteYaml,
  readStdin,
  serializeArrayField,
  serializeFrontmatter,
  stripMarkdown,
  todayIso,
  writeAtomic,
  writeMarkdown,
};
