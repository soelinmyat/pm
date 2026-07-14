"use strict";

const { writeTextAtomic } = require("../atomic-file");

function renderSections(sections, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new TypeError("prompt packet requires at least one section");
  }
  const maxSectionBytes = options.maxSectionBytes ?? Number.MAX_SAFE_INTEGER;
  const maxPromptBytes = options.maxPromptBytes ?? Number.MAX_SAFE_INTEGER;
  const label = options.label || "prompt";
  const rendered = sections.map((section) => {
    if (!section || typeof section.title !== "string" || !section.title.trim()) {
      throw new TypeError("prompt section title is required");
    }
    const body = (options.renderValue || renderValue)(section.value);
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > maxSectionBytes) {
      throw new Error(
        `${label} section ${section.key || section.title} is ${bytes} bytes; limit is ${maxSectionBytes}`
      );
    }
    return `## ${section.title.trim()}\n\n${options.demoteHeadings ? demoteHeadings(body) : body}`;
  });
  const prompt = `${rendered.join("\n\n")}${options.finalNewline ? "\n" : ""}`;
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (bytes > maxPromptBytes) {
    throw new Error(`${label} is ${bytes} bytes; limit is ${maxPromptBytes}`);
  }
  return prompt;
}

function renderValue(value) {
  if (Array.isArray(value)) return value.map((item) => `- ${renderScalar(item)}`).join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `- ${key}: ${renderScalar(item)}`)
      .join("\n");
  }
  return String(value);
}

function renderScalar(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function demoteHeadings(value) {
  return String(value).replace(/^#{1,2}(?=\s)/gmu, "###");
}

function publishPrompt(filePath, prompt) {
  writeTextAtomic(filePath, prompt, { directoryMode: 0o700, fileMode: 0o600 });
}

module.exports = { demoteHeadings, publishPrompt, renderSections, renderValue };
