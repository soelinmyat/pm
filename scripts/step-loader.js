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
    appliesTo: Array.isArray(data.applies_to) ? data.applies_to : null,
    phase: typeof data.phase === "string" && data.phase.trim() ? data.phase.trim() : null,
    requires: Array.isArray(data.requires) ? data.requires : [],
    gates: Array.isArray(data.gates) ? data.gates : [],
    requiredCapabilities: Array.isArray(data.required_capabilities)
      ? data.required_capabilities
      : [],
    requiredEvidence: Array.isArray(data.required_evidence) ? data.required_evidence : [],
    allowedModes: Array.isArray(data.allowed_modes) ? data.allowed_modes : [],
    requiresCommit: data.requires_commit === true || data.requires_commit === "true",
    resultSchema:
      typeof data.result_schema === "string" && data.result_schema.trim()
        ? data.result_schema.trim()
        : null,
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
 * Resolution order: user personas (.pm/personas/) then default (pluginRoot/agents/).
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
  const defaultPersonaDir = path.join(pluginRoot, "agents");
  const userPersonaDir = path.join(projectRoot, ".pm", "personas");

  // Collect step files from both sources
  const defaultFiles = collectStepFiles(defaultStepDir);
  const userFiles = collectStepFiles(userStepDir);

  // Match user overrides by stable phase when a bundled filename was renamed.
  // Exact filenames still win; phase aliases preserve older documented overrides.
  const overrideTargets = new Map();
  const consumedUserFiles = new Set();
  for (const [userFilename, userPath] of userFiles) {
    if (defaultFiles.has(userFilename)) {
      overrideTargets.set(userFilename, userFilename);
      consumedUserFiles.add(userFilename);
      continue;
    }
    const userStep = parseStepFile(userPath, userFilename);
    if (!userStep?.phase) continue;
    const phaseMatches = [...defaultFiles].filter(([defaultFilename, defaultPath]) => {
      const defaultStep = parseStepFile(defaultPath, defaultFilename);
      return defaultStep?.phase === userStep.phase;
    });
    if (phaseMatches.length === 1) {
      overrideTargets.set(phaseMatches[0][0], userFilename);
      consumedUserFiles.add(userFilename);
    }
  }
  const allFilenames = new Set([
    ...defaultFiles.keys(),
    ...[...userFiles.keys()].filter((filename) => !consumedUserFiles.has(filename)),
  ]);

  if (allFilenames.size === 0) {
    return [];
  }

  // Read config for enabled/disabled toggles
  const config = readConfig(pmDir);
  const stepConfig = config.workflows?.[command]?.steps || {};

  const steps = [];

  for (const filename of allFilenames) {
    const userFilename =
      overrideTargets.get(filename) || (userFiles.has(filename) ? filename : null);
    const isUserOverride = Boolean(userFilename);
    const filePath = isUserOverride ? userFiles.get(userFilename) : defaultFiles.get(filename);

    const parsed = parseStepFile(filePath, userFilename || filename);
    if (!parsed) {
      console.warn(`[step-loader] Could not read step file: ${filename}`);
      continue;
    }
    const baseline =
      isUserOverride && defaultFiles.has(filename)
        ? parseStepFile(defaultFiles.get(filename), filename)
        : null;

    // Resolve @persona references in body
    const resolvedBody = resolvePersonaRefs(parsed.body, userPersonaDir, defaultPersonaDir);

    // Check enabled/disabled from config
    const stem = (userFilename || filename).replace(/\.md$/, "");
    const stepCfg = stepConfig[stem];
    const enabled = stepCfg?.enabled !== false;

    steps.push({
      stem,
      name: parsed.name,
      order: parsed.order,
      description: parsed.description,
      appliesTo: parsed.appliesTo,
      phase: parsed.phase || baseline?.phase || null,
      requires: parsed.requires.length > 0 ? parsed.requires : baseline?.requires || [],
      gates: unionMetadata(baseline?.gates, parsed.gates),
      requiredCapabilities: unionMetadata(
        baseline?.requiredCapabilities,
        parsed.requiredCapabilities
      ),
      requiredEvidence: unionMetadata(baseline?.requiredEvidence, parsed.requiredEvidence),
      allowedModes: constrainModes(baseline?.allowedModes, parsed.allowedModes),
      requiresCommit: parsed.requiresCommit || baseline?.requiresCommit || false,
      resultSchema: parsed.resultSchema || baseline?.resultSchema || null,
      filePath,
      body: resolvedBody,
      enabled,
      source: isUserOverride ? "user" : "default",
    });
  }

  // Sort by order
  steps.sort((a, b) => a.order - b.order);

  return steps;
}

function unionMetadata(baseline = [], override = []) {
  return [...new Set([...(baseline || []), ...(override || [])])];
}

function constrainModes(baseline = [], override = []) {
  if (!baseline?.length) return [...override];
  if (!override?.length) return [...baseline];
  return override.filter((mode) => baseline.includes(mode));
}

/**
 * Concatenate enabled steps into a single prompt string.
 * When a tier is provided, only steps whose `appliesTo` includes that tier
 * (or steps with no `appliesTo` constraint) are included.
 *
 * @param {Array<{name, order, description, body, enabled, appliesTo}>} steps
 * @param {{ tier?: string }} [options]
 * @returns {string}
 */
function buildPrompt(steps, options) {
  const tier = options?.tier || null;
  const filtered = steps.filter((s) => {
    if (!s.enabled) return false;
    if (tier && s.appliesTo) return s.appliesTo.includes(tier);
    return true;
  });
  if (filtered.length === 0) return "";

  return filtered.map((s) => `## Step ${s.order}: ${s.name}\n\n${s.body.trim()}`).join("\n\n");
}

/**
 * Select exactly one enabled workflow step without changing legacy prompt
 * assembly. A string selector matches phase, stem, or name; an object may use
 * phase, stem, order, or name and combines the supplied constraints.
 *
 * @returns {object|null}
 */
function selectWorkflowStep(steps, selector) {
  if (!Array.isArray(steps)) throw new TypeError("steps must be an array");
  if (selector === undefined || selector === null || selector === "") {
    throw new TypeError("a phase selector is required");
  }

  let matches;
  if (typeof selector === "string") {
    matches = steps.filter(
      (step) =>
        step.enabled !== false &&
        (step.phase === selector || step.stem === selector || step.name === selector)
    );
  } else if (typeof selector === "number") {
    matches = steps.filter((step) => step.enabled !== false && step.order === selector);
  } else if (typeof selector === "object" && !Array.isArray(selector)) {
    const constraints = ["phase", "stem", "order", "name"].filter(
      (key) => selector[key] !== undefined
    );
    if (constraints.length === 0) throw new TypeError("a phase selector is required");
    matches = steps.filter(
      (step) => step.enabled !== false && constraints.every((key) => step[key] === selector[key])
    );
  } else {
    throw new TypeError("invalid phase selector");
  }

  if (matches.length > 1) throw new Error("phase selector matched multiple workflow steps");
  return matches[0] || null;
}

/** Build the legacy markdown rendering for one selected workflow phase. */
function buildPhasePrompt(steps, selector, options) {
  const step = selectWorkflowStep(steps, selector);
  if (!step) return "";
  return buildPrompt([step], options);
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
  const defaultPersonaDir = path.join(pluginRoot, "agents");
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

module.exports = {
  loadWorkflow,
  buildPrompt,
  selectWorkflowStep,
  buildPhasePrompt,
  loadPersonas,
};
