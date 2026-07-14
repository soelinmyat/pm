#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { isRfc3339DateTime } = require("./lib/iso-time");
const { parseCliArgs } = require("./loop-args");

const MAX_HTML_BYTES = 1_572_864;
const LIFECYCLES = new Set([
  "draft",
  "reviewed",
  "approved",
  "planned",
  "in-progress",
  "done",
  "superseded",
]);
const KINDS = new Set(["proposal", "rfc", "report"]);
const META_FIELDS = new Set([
  "schema_version",
  "id",
  "kind",
  "slug",
  "lifecycle",
  "title",
  "generated_at",
  "generator",
  "source",
  "evidence",
]);

function inspectHtmlArtifact(bytes, options = {}) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const sha256 = digest(bytes);
  if (bytes.length > MAX_HTML_BYTES) {
    return result(false, sha256, bytes.length, null, [
      issue("$", `HTML exceeds the ${MAX_HTML_BYTES}-byte size budget`),
    ]);
  }
  const html = bytes.toString("utf8");
  const structuralHtml = structuralMarkup(html);
  const tags = startTags(structuralHtml);
  const issues = [];
  let metadata = null;
  try {
    metadata = parseArtifactMetadata(html);
    validateMetadata(metadata, options.expectedKind, issues);
  } catch (error) {
    issues.push(issue("#pm-artifact", error.message));
  }

  requirePattern(
    structuralHtml,
    /<!doctype\s+html\s*>/i,
    "document requires an HTML doctype",
    issues
  );
  if (!tags.some((tag) => tag.name === "html" && nonEmpty(attributeValue(tag.attrs, ["lang"])))) {
    issues.push(issue("html", "document language is required"));
  }
  if (
    !tags.some(
      (tag) =>
        tag.name === "meta" && attributeValue(tag.attrs, ["charset"])?.toLowerCase() === "utf-8"
    )
  ) {
    issues.push(issue("meta", "UTF-8 charset metadata is required"));
  }
  if (
    !tags.some(
      (tag) =>
        tag.name === "meta" &&
        attributeValue(tag.attrs, ["name"])?.toLowerCase() === "viewport" &&
        /width=device-width/i.test(attributeValue(tag.attrs, ["content"]) || "")
    )
  ) {
    issues.push(issue("meta", "responsive viewport metadata is required"));
  }
  requireTagCount(tags, "title", 1, "document requires exactly one title", issues);
  requireTagCount(tags, "h1", 1, "document requires exactly one h1", issues);
  requireTagCount(tags, "main", 1, "document requires exactly one main landmark", issues);
  if (!hasSkipLink(tags)) {
    issues.push(issue("a.skip-link", "keyboard-visible skip link is required"));
  }
  if (
    tags
      .filter((tag) => tag.name === "nav")
      .some((tag) => attributeValue(tag.attrs, ["aria-label", "aria-labelledby"]) === undefined)
  ) {
    issues.push(issue("nav", "every navigation landmark requires a labeled navigation name"));
  }
  requirePattern(
    html,
    /@media\s*\([^)]*max-width\s*:/i,
    "narrow-screen responsive rules are required",
    issues
  );
  requirePattern(
    html,
    /prefers-reduced-motion\s*:\s*reduce/i,
    "reduced-motion rules are required",
    issues
  );
  requirePattern(html, /@media\s+print\b/i, "print rules are required", issues);
  requirePattern(html, /:focus-visible\b/i, "general focus-visible rules are required", issues);

  validateScripts(html, issues);
  validateOfflineAssets(tags, html, issues);
  if (/\son[a-z]+\s*=/i.test(structuralHtml))
    issues.push(issue("html", "inline event handler is forbidden"));
  validateIdsAndAnchors(tags, issues);
  if (
    tags.some((tag) =>
      (attributeValue(tag.attrs, ["class"]) || "").split(/\s+/).includes("mermaid")
    )
  ) {
    issues.push(
      issue(".mermaid", "unrendered Mermaid source is forbidden; use inline SVG or accessible text")
    );
  }
  validateLifecycle(html, structuralHtml, metadata, issues);
  validateImages(tags, issues);
  if (!options.template && /sha256:0{64}/i.test(html)) {
    issues.push(issue("html", "placeholder SHA-256 is forbidden outside template mode"));
  }

  return result(issues.length === 0, sha256, bytes.length, metadata, issues);
}

function parseArtifactMetadata(html) {
  const matches = [
    ...String(html).matchAll(
      /<script\b(?=[^>]*\bid=["']pm-artifact["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];
  if (matches.length !== 1)
    throw new Error("document must contain exactly one #pm-artifact JSON block");
  try {
    const parsed = JSON.parse(matches[0][1]);
    if (!isObject(parsed)) throw new Error("metadata must be an object");
    return parsed;
  } catch (error) {
    throw new Error(`invalid #pm-artifact JSON: ${error.message}`);
  }
}

function validateMetadata(meta, expectedKind, issues) {
  for (const key of Object.keys(meta)) {
    if (!META_FIELDS.has(key)) issues.push(issue(`#pm-artifact.${key}`, "unknown field"));
  }
  for (const field of META_FIELDS) {
    if (!Object.hasOwn(meta, field)) issues.push(issue(`#pm-artifact.${field}`, "required"));
  }
  if (meta.schema_version !== 1) issues.push(issue("#pm-artifact.schema_version", "must equal 1"));
  if (!KINDS.has(meta.kind)) issues.push(issue("#pm-artifact.kind", "invalid"));
  if (expectedKind && meta.kind !== expectedKind) {
    issues.push(issue("#pm-artifact.kind", `kind must equal ${expectedKind}`));
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug || "")) {
    issues.push(issue("#pm-artifact.slug", "must be a kebab-case slug"));
  }
  if (meta.id !== `${meta.kind}:${meta.slug}`) {
    issues.push(issue("#pm-artifact.id", "must equal kind:slug"));
  }
  if (!LIFECYCLES.has(meta.lifecycle)) issues.push(issue("#pm-artifact.lifecycle", "invalid"));
  if (!nonEmpty(meta.title) || meta.title.length > 200)
    issues.push(issue("#pm-artifact.title", "invalid"));
  if (!isRfc3339(meta.generated_at))
    issues.push(issue("#pm-artifact.generated_at", "must be RFC 3339"));
  validateClosedStrings(meta.generator, ["name", "version"], "#pm-artifact.generator", issues);
  if (!isObject(meta.source)) issues.push(issue("#pm-artifact.source", "must be an object"));
  else {
    const keys = Object.keys(meta.source);
    if (keys.some((key) => !["path", "sha256"].includes(key)) || keys.length !== 2) {
      issues.push(issue("#pm-artifact.source", "requires only path and sha256"));
    }
    if (!nonEmpty(meta.source.path)) issues.push(issue("#pm-artifact.source.path", "required"));
    if (meta.source.sha256 !== null && !isSha(meta.source.sha256)) {
      issues.push(issue("#pm-artifact.source.sha256", "must be null or SHA-256"));
    }
  }
  if (!Array.isArray(meta.evidence) || meta.evidence.length > 100) {
    issues.push(issue("#pm-artifact.evidence", "must be a bounded array"));
  } else {
    meta.evidence.forEach((entry, index) => {
      const exactFields =
        isObject(entry) &&
        Object.keys(entry).length === 2 &&
        Object.hasOwn(entry, "path") &&
        Object.hasOwn(entry, "sha256");
      if (!exactFields || !nonEmpty(entry.path) || !isSha(entry.sha256)) {
        issues.push(issue(`#pm-artifact.evidence[${index}]`, "requires path and SHA-256"));
      }
    });
  }
}

function validateScripts(html, issues) {
  const pairPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const pairs = [...html.matchAll(pairPattern)];
  const outsideScriptBodies = html.replace(pairPattern, "");
  if (/<\/?script\b/i.test(outsideScriptBodies)) {
    issues.push(issue("script", "every script element must be a well-formed closed PM JSON block"));
  }
  for (const match of pairs) {
    const attrs = match[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type !== "application/json" || !["pm-artifact", "rfc-lifecycle"].includes(id)) {
      issues.push(issue("script", "active script is forbidden; only PM JSON metadata is allowed"));
    }
  }
}

function validateOfflineAssets(tags, rawHtml, issues) {
  if (tags.some((tag) => ["iframe", "frame", "object", "embed", "base"].includes(tag.name))) {
    issues.push(
      issue("html", "offline artifact cannot load external scripts, styles, frames, or assets")
    );
  }
  if (
    tags.some(
      (tag) =>
        tag.name === "meta" &&
        attributeValue(tag.attrs, ["http-equiv"])?.toLowerCase() === "refresh"
    )
  ) {
    issues.push(issue("meta", "meta refresh is forbidden"));
  }
  for (const tag of tags.filter((entry) => entry.name === "a")) {
    const href = attributeValue(tag.attrs, ["href"]);
    if (href && /^\s*(?:javascript:|data:text\/html)/i.test(href)) {
      issues.push(issue("href", "active or document-producing link scheme is forbidden"));
    }
  }
  if (
    tags.some(
      (tag) =>
        ["form", "button", "input", "select", "textarea"].includes(tag.name) ||
        attributeValue(tag.attrs, ["formaction"]) !== undefined
    )
  ) {
    issues.push(issue("form", "interactive form controls are forbidden in inert artifacts"));
  }
  for (const element of tags.filter((tag) =>
    ["script", "link", "img", "audio", "video", "source"].includes(tag.name)
  )) {
    const tag = element.name;
    const attrs = element.attrs;
    const src = attributeValue(attrs, ["src"]);
    const href = attributeValue(attrs, ["href"]);
    const poster = attributeValue(attrs, ["poster"]);
    const srcset = attributeValue(attrs, ["srcset"]);
    if ((tag === "script" && src !== undefined) || (tag === "link" && href !== undefined)) {
      issues.push(issue(tag, "offline artifact cannot load external scripts or linked assets"));
    }
    if (src !== undefined && !/^data:/i.test(src)) {
      issues.push(issue(tag, "media source must be an inline data URI"));
    }
    if (srcset !== undefined) issues.push(issue(tag, "responsive media source sets are forbidden"));
    if (poster !== undefined && !/^data:/i.test(poster)) {
      issues.push(issue(tag, "video poster must be an inline data URI"));
    }
  }
  const cssText = [
    ...rawElementBodies(rawHtml, "style"),
    ...tags
      .map((tag) => attributeValue(tag.attrs, ["style"]))
      .filter((value) => value !== undefined),
  ].join("\n");
  for (const match of cssText.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) {
    const target = match[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!/^(?:data:|#)/i.test(target)) {
      issues.push(issue("css", "CSS URL must be an inline data URI or fragment reference"));
    }
  }
  if (/@import\s+/i.test(cssText)) issues.push(issue("css", "CSS imports are forbidden"));
  for (const element of tags.filter((tag) => ["image", "feimage", "use"].includes(tag.name))) {
    const tag = element.name;
    const target = attributeValue(element.attrs, ["href", "xlink:href"])?.trim();
    if (!target) continue;
    const allowed = tag === "use" ? /^#[A-Za-z][\w:.-]*$/.test(target) : /^data:/i.test(target);
    if (!allowed) {
      issues.push(issue(`svg ${tag}`, "SVG resource reference must be fully inline"));
    }
  }
}

function validateIdsAndAnchors(tags, issues) {
  const ids = tags
    .map((tag) => attributeValue(tag.attrs, ["id"]))
    .filter((value) => value !== undefined);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) issues.push(issue(`#${id}`, `duplicate id ${id}`));
    seen.add(id);
  }
  for (const tag of tags) {
    const href = attributeValue(tag.attrs, ["href"]);
    if (href === undefined || !href.startsWith("#")) continue;
    let target = href.slice(1);
    if (!target) {
      issues.push(issue("href=#", "empty internal anchor is forbidden"));
      continue;
    }
    try {
      target = decodeURIComponent(target);
    } catch {
      issues.push(issue("href", `invalid anchor encoding #${target}`));
      continue;
    }
    if (!seen.has(target)) issues.push(issue(`href=#${target}`, `missing anchor target ${target}`));
  }
}

function validateLifecycle(html, structuralHtml, metadata, issues) {
  if (!metadata || !LIFECYCLES.has(metadata.lifecycle)) return;
  const visible = structuralHtml.replace(/<[^>]+>/g, " ");
  if (!new RegExp(`\\b${escapeRegex(metadata.lifecycle)}\\b`, "i").test(visible)) {
    issues.push(issue("html", "lifecycle must be visible as text, not color-only metadata"));
  }
  const rfcLifecycle = html.match(
    /<script\b(?=[^>]*\bid=["']rfc-lifecycle["'])[^>]*>([\s\S]*?)<\/script>/i
  );
  if (rfcLifecycle) {
    try {
      const status = JSON.parse(rfcLifecycle[1]).status;
      if (status !== metadata.lifecycle) {
        issues.push(issue("#rfc-lifecycle", "workflow lifecycle contradicts PM artifact metadata"));
      }
    } catch {
      issues.push(issue("#rfc-lifecycle", "invalid lifecycle JSON"));
    }
    const visibleMarkers = [
      ...structuralHtml.matchAll(
        /<([a-z][a-z0-9-]*)\b(?=[^>]*\bdata-pm-lifecycle(?:=["'][^"']*["'])?)[^>]*>\s*([^<]+?)\s*<\/\1>/gi
      ),
    ];
    if (visibleMarkers.length !== 1) {
      issues.push(
        issue("[data-pm-lifecycle]", "RFC requires exactly one visible lifecycle marker")
      );
    } else if (visibleMarkers[0][2].trim().toLowerCase() !== metadata.lifecycle) {
      issues.push(
        issue("[data-pm-lifecycle]", "visible lifecycle contradicts PM artifact metadata")
      );
    }
  }
}

function validateImages(tags, issues) {
  for (const tag of tags.filter((entry) => entry.name === "img")) {
    if (attributeValue(tag.attrs, ["alt"]) === undefined)
      issues.push(issue("img", "image alt text is required"));
  }
  for (const tag of tags.filter((entry) => entry.name === "svg")) {
    const role = attributeValue(tag.attrs, ["role"])?.toLowerCase();
    const named = attributeValue(tag.attrs, ["aria-label", "aria-labelledby"]);
    if (named === undefined && role !== "presentation") {
      issues.push(issue("svg", "inline SVG requires an accessible name or presentation role"));
    }
  }
}

function structuralMarkup(html) {
  const source = String(html);
  const lower = source.toLowerCase();
  const rawTags = new Set(["script", "style", "template", "title"]);
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (lower.startsWith("<!--", index)) {
      const end = lower.indexOf("-->", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    const tag = readStartTagAt(source, index);
    if (tag && rawTags.has(tag.name)) {
      const { start: closeStart, end: closeEnd } = findClosingTag(source, tag.name, tag.end);
      output += tag.source;
      if (closeStart >= 0 && closeEnd >= 0) output += source.slice(closeStart, closeEnd);
      index = closeEnd < 0 ? source.length : closeEnd;
      continue;
    }
    if (tag) {
      output += tag.source;
      index = tag.end;
      continue;
    }
    output += source[index];
    index += 1;
  }
  return output;
}

function startTags(html) {
  const tags = [];
  let index = 0;
  while (index < html.length) {
    const tag = readStartTagAt(html, index);
    if (tag) {
      tags.push(tag);
      index = tag.end;
    } else {
      const endTag = readEndTagAt(html, index);
      index = endTag ? endTag.end : index + 1;
    }
  }
  return tags;
}

function readStartTagAt(html, index) {
  if (html[index] !== "<" || !/[A-Za-z]/.test(html[index + 1] || "")) return null;
  let cursor = index + 1;
  while (/[A-Za-z0-9:-]/.test(html[cursor] || "")) cursor += 1;
  const name = html.slice(index + 1, cursor).toLowerCase();
  if (!name || !/[\s/>]/.test(html[cursor] || "")) return null;
  let quote = null;
  for (let end = cursor; end < html.length; end += 1) {
    const character = html[end];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return {
        name,
        attrs: html.slice(cursor, end).replace(/\/\s*$/, ""),
        source: html.slice(index, end + 1),
        start: index,
        end: end + 1,
      };
    }
  }
  return null;
}

function rawElementBodies(html, targetName) {
  const source = String(html);
  const lower = source.toLowerCase();
  const rawTags = new Set(["script", "style", "template", "title"]);
  const bodies = [];
  let index = 0;
  while (index < source.length) {
    if (lower.startsWith("<!--", index)) {
      const end = lower.indexOf("-->", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    const tag = readStartTagAt(source, index);
    if (!tag) {
      index += 1;
      continue;
    }
    if (!rawTags.has(tag.name)) {
      index = tag.end;
      continue;
    }
    const { start: closeStart, end: closeEnd } = findClosingTag(source, tag.name, tag.end);
    if (tag.name === targetName && closeStart >= 0) bodies.push(source.slice(tag.end, closeStart));
    index = closeEnd < 0 ? source.length : closeEnd;
  }
  return bodies;
}

function findClosingTag(html, name, fromIndex) {
  const lower = html.toLowerCase();
  const needle = `</${name}`;
  let start = lower.indexOf(needle, fromIndex);
  while (start >= 0) {
    const tag = readEndTagAt(html, start);
    if (tag?.name === name) return { start, end: tag.end };
    start = lower.indexOf(needle, start + needle.length);
  }
  return { start: -1, end: -1 };
}

function readEndTagAt(html, index) {
  if (!html.startsWith("</", index) || !/[A-Za-z]/.test(html[index + 2] || "")) return null;
  let cursor = index + 2;
  while (/[A-Za-z0-9:-]/.test(html[cursor] || "")) cursor += 1;
  const name = html.slice(index + 2, cursor).toLowerCase();
  if (!name || !/[\s>]/.test(html[cursor] || "")) return null;
  let quote = null;
  for (let end = cursor; end < html.length; end += 1) {
    const character = html[end];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { name, start: index, end: end + 1 };
    }
  }
  return null;
}

function attributeValue(attrs, names) {
  for (const name of names) {
    const escaped = escapeRegex(name);
    const match = String(attrs).match(
      new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i")
    );
    if (match) return match[1] ?? match[2] ?? match[3] ?? "";
  }
  return undefined;
}

function hasSkipLink(tags) {
  return tags
    .filter((tag) => tag.name === "a")
    .some((tag) => {
      const classes = attributeValue(tag.attrs, ["class"])?.split(/\s+/) || [];
      const href = attributeValue(tag.attrs, ["href"]);
      return classes.includes("skip-link") && href?.startsWith("#") && href.length > 1;
    });
}

function requireTagCount(tags, name, count, message, issues) {
  if (tags.filter((tag) => tag.name === name).length !== count) issues.push(issue("html", message));
}

function buildManifest(htmlPath, inspected) {
  return {
    schema_version: 1,
    artifact: {
      path: path.resolve(htmlPath),
      id: inspected.metadata.id,
      kind: inspected.metadata.kind,
      slug: inspected.metadata.slug,
      lifecycle: inspected.metadata.lifecycle,
      sha256: inspected.sha256,
      bytes: inspected.bytes,
    },
    checks: {
      structural: true,
      metadata: true,
      offline: true,
      scripts_inert: true,
      accessibility_primitives: true,
      anchors: true,
      responsive: true,
      print: true,
      budget: true,
    },
    checked_at: new Date().toISOString(),
  };
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv, {
      "--html": { type: "string" },
      "--kind": { type: "string" },
      "--manifest": { type: "string" },
      "--template": { type: "boolean" },
      "--json": { type: "boolean" },
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const options = parsed.args;
  if (!options.html) {
    process.stderr.write("--html is required\n");
    return 2;
  }
  let bytes;
  const htmlPath = path.resolve(options.html);
  try {
    bytes = fs.readFileSync(htmlPath);
  } catch (error) {
    process.stderr.write(`cannot read HTML: ${error.message}\n`);
    return 2;
  }
  const inspected = inspectHtmlArtifact(bytes, {
    expectedKind: options.kind,
    template: options.template === true,
  });
  if (inspected.ok && options.manifest) {
    writeJsonAtomic(path.resolve(options.manifest), buildManifest(htmlPath, inspected), {
      directoryMode: 0o700,
      fileMode: 0o600,
    });
  }
  const payload = options.json
    ? `${JSON.stringify(inspected, null, 2)}\n`
    : `${inspected.ok ? "Artifact check passed" : inspected.issues.map((entry) => `- ${entry.path}: ${entry.message}`).join("\n")}\n`;
  (inspected.ok ? process.stdout : process.stderr).write(payload);
  return inspected.ok ? 0 : 1;
}

function result(ok, sha256, bytes, metadata, issues) {
  return { ok, sha256, bytes, metadata, issues };
}
function issue(pathValue, message) {
  return { path: pathValue, message };
}
function requirePattern(html, pattern, message, issues) {
  if (!pattern.test(html)) issues.push(issue("html", message));
}
function validateClosedStrings(value, fields, objectPath, issues) {
  if (!isObject(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    issues.push(issue(objectPath, `requires only ${fields.join(" and ")}`));
    return;
  }
  for (const field of fields)
    if (!nonEmpty(value[field])) issues.push(issue(`${objectPath}.${field}`, "required"));
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isSha(value) {
  return /^sha256:[0-9a-f]{64}$/.test(value || "");
}
function isRfc3339(value) {
  return isRfc3339DateTime(value);
}
function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module) process.exitCode = main();

module.exports = {
  MAX_HTML_BYTES,
  buildManifest,
  inspectHtmlArtifact,
  parseArtifactMetadata,
  structuralMarkup,
  validateMetadata,
};
