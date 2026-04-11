"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse a step markdown file. Returns { name, order, description, body }
 * or null if the file cannot be read.
 */
function parseStepFile(filePath, filename) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const { data, body, hasFrontmatter } = parseFrontmatter(content);
  const stem = filename.replace(/\.md$/, "");

  // Extract order from filename prefix (e.g. "01-plan" -> 1) or frontmatter
  let order = 0;
  if (data.order !== undefined) {
    order = Number(data.order);
  } else {
    const match = stem.match(/^(\d+)/);
    if (match) order = Number(match[1]);
  }

  return {
    name: hasFrontmatter && data.name ? data.name : stem,
    order,
    description: data.description || "",
    body: body,
  };
}

/**
 * Collect step filenames from a directory. Returns a Map of filename -> filePath.
 */
function collectStepFiles(dir) {
  const map = new Map();
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        map.set(entry, path.join(dir, entry));
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }
  return map;
}

/**
 * Load a persona's body content by name.
 * Resolution order: user personas (.pm/personas/) then default (pluginRoot/personas/).
 * Returns the body string or null if not found.
 */
function resolvePersonaBody(personaName, userPersonaDir, defaultPersonaDir) {
  const filename = personaName + ".md";

  // Try user override first
  const userPath = path.join(userPersonaDir, filename);
  try {
    const content = fs.readFileSync(userPath, "utf8");
    const { body } = parseFrontmatter(content);
    return body;
  } catch {
    // Not found — try default
  }

  // Try default
  const defaultPath = path.join(defaultPersonaDir, filename);
  try {
    const content = fs.readFileSync(defaultPath, "utf8");
    const { body } = parseFrontmatter(content);
    return body;
  } catch {
    return null;
  }
}

/**
 * Replace @persona-name references in text with persona body content.
 * References inside fenced code blocks (``` ... ```) are left untouched.
 * Unresolved references emit a warning and are left as-is.
 */
function resolvePersonaRefs(text, userPersonaDir, defaultPersonaDir) {
  // Split by code blocks to avoid replacing inside them
  const parts = text.split(/(```[\s\S]*?```)/);

  for (let i = 0; i < parts.length; i++) {
    // Odd indices are code blocks — skip them
    if (i % 2 === 1) continue;

    parts[i] = parts[i].replace(/@([a-z][a-z0-9-]*)/g, (match, name) => {
      const body = resolvePersonaBody(name, userPersonaDir, defaultPersonaDir);
      if (body === null) {
        console.warn(`[step-loader] Unresolved persona reference: @${name}`);
        return match;
      }
      return body.trim();
    });
  }

  return parts.join("");
}

/**
 * Read .pm/config.json and return the parsed object, or {} if missing/invalid.
 */
function readConfig(pmDir) {
  const configPath = path.join(path.dirname(pmDir), ".pm", "config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a workflow's steps for a given command.
 *
 * @param {string} command - The skill command name (e.g. "dev")
 * @param {string} pmDir - Path to the pm/ knowledge base directory
 * @param {string} pluginRoot - Path to the plugin root directory
 * @returns {Array<{name, order, description, body, enabled, source}>}
 */
function loadWorkflow(command, pmDir, pluginRoot) {
  const projectRoot = path.dirname(pmDir);
  const defaultStepDir = path.join(pluginRoot, "skills", command, "steps");
  const userStepDir = path.join(projectRoot, ".pm", "workflows", command);
  const defaultPersonaDir = path.join(pluginRoot, "personas");
  const userPersonaDir = path.join(projectRoot, ".pm", "personas");

  // Collect step files from both sources
  const defaultFiles = collectStepFiles(defaultStepDir);
  const userFiles = collectStepFiles(userStepDir);

  // Merge: user overrides default for same filename
  const allFilenames = new Set([...defaultFiles.keys(), ...userFiles.keys()]);

  if (allFilenames.size === 0) {
    return [];
  }

  // Read config for enabled/disabled toggles
  const config = readConfig(pmDir);
  const stepConfig = config.workflows?.[command]?.steps || {};

  const steps = [];

  for (const filename of allFilenames) {
    const isUserOverride = userFiles.has(filename);
    const filePath = isUserOverride ? userFiles.get(filename) : defaultFiles.get(filename);

    const parsed = parseStepFile(filePath, filename);
    if (!parsed) {
      console.warn(`[step-loader] Could not read step file: ${filename}`);
      continue;
    }

    // Resolve @persona references in body
    const resolvedBody = resolvePersonaRefs(parsed.body, userPersonaDir, defaultPersonaDir);

    // Check enabled/disabled from config
    const stem = filename.replace(/\.md$/, "");
    const stepCfg = stepConfig[stem];
    const enabled = stepCfg?.enabled !== false;

    steps.push({
      name: parsed.name,
      order: parsed.order,
      description: parsed.description,
      body: resolvedBody,
      enabled,
      source: isUserOverride ? "user" : "default",
    });
  }

  // Sort by order
  steps.sort((a, b) => a.order - b.order);

  return steps;
}

/**
 * Concatenate enabled steps into a single prompt string.
 *
 * @param {Array<{name, order, description, body, enabled}>} steps
 * @returns {string}
 */
function buildPrompt(steps) {
  const enabled = steps.filter((s) => s.enabled);
  if (enabled.length === 0) return "";

  return enabled.map((s) => `## Step ${s.order}: ${s.name}\n\n${s.body.trim()}`).join("\n\n");
}

/**
 * Load all available personas.
 *
 * @param {string} pmDir - Path to the pm/ knowledge base directory
 * @param {string} pluginRoot - Path to the plugin root directory
 * @returns {Array<{name, description, source, customized}>}
 */
function loadPersonas(pmDir, pluginRoot) {
  const projectRoot = path.dirname(pmDir);
  const defaultPersonaDir = path.join(pluginRoot, "personas");
  const userPersonaDir = path.join(projectRoot, ".pm", "personas");

  const defaultFiles = collectStepFiles(defaultPersonaDir);
  const userFiles = collectStepFiles(userPersonaDir);

  const allFilenames = new Set([...defaultFiles.keys(), ...userFiles.keys()]);
  const personas = [];

  for (const filename of allFilenames) {
    const isUser = userFiles.has(filename);
    const filePath = isUser ? userFiles.get(filename) : defaultFiles.get(filename);

    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const { data } = parseFrontmatter(content);
    const stem = filename.replace(/\.md$/, "");

    personas.push({
      name: data.name || stem,
      description: data.description || "",
      source: isUser ? "user" : "default",
      customized: isUser,
    });
  }

  // Sort by name for consistent ordering
  personas.sort((a, b) => a.name.localeCompare(b.name));

  return personas;
}

module.exports = { loadWorkflow, buildPrompt, loadPersonas };
