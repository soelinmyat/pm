"use strict";

function parseFrontmatter(content) {
  const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterPattern);
  if (!match) {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  const rawYaml = match[1];
  const body = match[2] || "";
  const data = {};

  const lines = rawYaml.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index++;
      continue;
    }

    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (!keyMatch) {
      index++;
      continue;
    }

    const key = keyMatch[1];
    const inlineValue = keyMatch[2].trim();

    if (inlineValue !== "") {
      if (inlineValue === "[]") {
        data[key] = [];
      } else if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
        // Inline YAML array: [item1, item2, item3]
        const inner = inlineValue.slice(1, -1).trim();
        data[key] = inner
          ? inner.split(",").map((item) => item.trim().replace(/^["'](.*)["']$/, "$1"))
          : [];
      } else {
        data[key] = inlineValue.replace(/^["'](.*)["']$/, "$1");
      }
      index++;
      continue;
    }

    const items = [];
    index++;
    while (index < lines.length) {
      const next = lines[index];
      const objectItemMatch = next.match(/^[ \t]+-\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
      const scalarItemMatch = next.match(/^[ \t]+-\s+(.+)$/);
      const continuationMatch = next.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);

      if (objectItemMatch) {
        const item = {};
        item[objectItemMatch[1]] = objectItemMatch[2].trim().replace(/^["'](.*)["']$/, "$1");
        index++;
        while (index < lines.length) {
          const continuation = lines[index];
          const nestedMatch = continuation.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
          if (nestedMatch && !continuation.match(/^[ \t]+-\s/)) {
            item[nestedMatch[1]] = nestedMatch[2].trim().replace(/^["'](.*)["']$/, "$1");
            index++;
          } else {
            break;
          }
        }
        items.push(item);
      } else if (scalarItemMatch) {
        items.push(scalarItemMatch[1].trim().replace(/^["'](.*)["']$/, "$1"));
        index++;
      } else if (
        continuationMatch &&
        items.length > 0 &&
        typeof items[items.length - 1] === "object"
      ) {
        items[items.length - 1][continuationMatch[1]] = continuationMatch[2]
          .trim()
          .replace(/^["'](.*)["']$/, "$1");
        index++;
      } else {
        break;
      }
    }

    if (items.length > 0) {
      data[key] = items;
    }
  }

  return { data, body, hasFrontmatter: true };
}

function inspectKbPath(value) {
  if (typeof value !== "string") {
    return { ok: false, reason: "not-string", value: "" };
  }

  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return { ok: false, reason: "empty", value: "" };
  }

  if (trimmed.startsWith("/")) {
    return { ok: false, reason: "absolute", value: trimmed };
  }

  if (trimmed.startsWith("pm/")) {
    return { ok: true, value: trimmed.slice(3), legacyPrefix: true };
  }

  return { ok: true, value: trimmed, legacyPrefix: false };
}

function normalizeKbPath(value) {
  const inspected = inspectKbPath(value);
  return inspected.ok ? inspected.value : null;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

module.exports = {
  inspectKbPath,
  isIsoDate,
  normalizeKbPath,
  parseFrontmatter,
};
