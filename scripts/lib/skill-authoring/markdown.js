"use strict";

function normalizeHeading(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/[^a-z0-9-]+/g, " ")
    .trim();
}

function openingFence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[1][0];
  if (marker === "`" && match[2].includes("`")) return null;
  return { marker, length: match[1].length };
}

function closesFence(line, fence) {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function operativeMarkdown(markdown) {
  const output = [];
  let fence = null;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (fence === null) {
      const opening = openingFence(line);
      if (opening) {
        fence = opening;
        output.push("");
      } else {
        output.push(line);
      }
      continue;
    }
    if (closesFence(line, fence)) fence = null;
    output.push("");
  }
  return output.join("\n");
}

function sections(markdown) {
  const result = new Map();
  const lines = operativeMarkdown(markdown).split(/\r?\n/);
  let current = null;
  let buffer = [];
  function flush() {
    if (current !== null) result.set(current, buffer.join("\n").trim());
  }
  for (const line of lines) {
    const match = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (match) {
      flush();
      current = normalizeHeading(match[1]);
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return result;
}

function sectionByPrefix(map, prefix) {
  const normalized = normalizeHeading(prefix);
  for (const [heading, body] of map) {
    if (heading === normalized || heading.startsWith(`${normalized} `)) return body;
  }
  return null;
}

function substantive(body, minimum = 12) {
  const plain = String(body || "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/[`*_#>|()\u005b\u005d-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length < minimum) return false;
  return !/^(do (it|the thing)|done|tbd|todo|fill this in|n\/a)[.!]?$/i.test(plain);
}

function tableDataRows(body) {
  return String(body || "")
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line))
    .filter((line) => !/^\s*\|?\s*:?-{3}/.test(line))
    .slice(1);
}

module.exports = {
  normalizeHeading,
  operativeMarkdown,
  sectionByPrefix,
  sections,
  substantive,
  tableDataRows,
};
