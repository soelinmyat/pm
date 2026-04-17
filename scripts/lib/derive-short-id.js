"use strict";

const path = require("path");

const KIND_PREFIX = Object.freeze({
  groom: "g",
  rfc: "r",
  dev: "d",
  think: "t",
  proposal: "p",
  shipped: "s",
});

function normalizeLinearId(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
}

function baseSlug(kind, filePath) {
  const base = path.basename(filePath, ".md");
  if (kind === "dev") return base.replace(/^(epic|bugfix)-/, "");
  return base;
}

function deriveShortId(kind, frontmatter, filePath) {
  if (!Object.prototype.hasOwnProperty.call(KIND_PREFIX, kind)) {
    throw new Error(`deriveShortId: unknown kind "${kind}"`);
  }

  const fm = frontmatter || {};
  const linearId = normalizeLinearId(fm.linear_id);
  if (linearId) return linearId;

  const prefix = KIND_PREFIX[kind];
  const slug = (typeof fm.slug === "string" && fm.slug.trim()) || baseSlug(kind, filePath || "");
  return `${prefix}/${slug}`;
}

function disambiguateShortIds(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = row.shortId;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > 1) row.shortId = `${key}-${count}`;
  }
  return rows;
}

module.exports = { deriveShortId, disambiguateShortIds, KIND_PREFIX };
