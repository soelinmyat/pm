"use strict";

// The Design Director path's mechanical checks. They judge nothing about the
// design; they catch what a review can miss:
//
// - scope: UI files the diff changed outside every declared surface
// - tokens: hardcoded colours and pixel values on the diff's added UI lines
// - neighbours: before and after screenshots of untouched neighbouring screens
//
// Every hit is fixed or given a disposition in the session's checks file. The
// checks enforce only when the session declares surfaces; without them the
// result is reported and never fails, so older sessions behave as before.

const path = require("node:path");
const { GIT_DIFF_TRUST_CONFIG, gitExec } = require("./git-env");
const { readProjectInput } = require("./project-file");
const { decodePngRgba } = require("./media-inspect");
const { pathPatternMatcher, validateRepoRelativePattern } = require("./dev-work-units");

const CHECKS_SCHEMA = "design-director-mechanical";
// Relative to the session folder, .pm/dev-sessions/{slug}/.
const CHECKS_DIR = "design-critique/mechanical";
const CHECKS_PATH = `${CHECKS_DIR}/checks.json`;
const MAX_CHECKS_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_HITS = 200;
const CHECKS = new Set(["scope", "tokens", "neighbours"]);
const CITE_KINDS = new Set(["token", "component", "decision", "screen"]);

// A UI file is markup, a stylesheet, a native layout file, or any file under a
// UI directory. The checks file can add patterns and exclude others.
const DEFAULT_UI_FILES = Object.freeze([
  ...[
    "tsx",
    "jsx",
    "vue",
    "svelte",
    "astro",
    "css",
    "scss",
    "sass",
    "less",
    "styl",
    "pcss",
    "html",
    "htm",
    "erb",
    "haml",
    "slim",
    "hbs",
    "handlebars",
    "mustache",
    "ejs",
    "njk",
    "twig",
    "liquid",
    "pug",
    "xib",
    "storyboard",
  ].map((extension) => `**/*.${extension}`),
  ...["components", "views", "screens", "pages", "layouts", "ui", "widgets", "styles", "theme"]
    .flatMap((name) => [`**/${name}/**`, `**/${name[0].toUpperCase()}${name.slice(1)}/**`])
    .filter((pattern, index, all) => all.indexOf(pattern) === index),
]);

// Never UI, whatever the extension: tests, stories, seed and fixture data,
// docs, PM data, generated output, SVG assets and API routes.
const NOT_UI_FILES = Object.freeze([
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/spec/**",
  "**/e2e/**",
  "**/cypress/**",
  "**/playwright/**",
  "**/*.stories.*",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/seeds/**",
  "**/seed/**",
  "**/factories/**",
  "**/mocks/**",
  "**/__mocks__/**",
  "**/*.md",
  "**/*.mdx",
  "docs/**",
  ".pm/**",
  "pm/**",
  "**/dist/**",
  "**/build/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/*.min.*",
  "**/*.map",
  "**/*.svg",
  "**/pages/api/**",
  "**/app/api/**",
]);

// Where raw values are expected: the files that define the tokens.
const TOKEN_DEFINITION_FILES = Object.freeze([
  "**/tokens/**",
  "**/*tokens*.*",
  "**/theme/**",
  "**/theme.*",
  "**/tailwind.config.*",
]);

// Raw values that need no token: no offset, and a hairline border. Percentages,
// unitless numbers and keywords are not detected at all.
const ALLOWED_RAW_VALUES = Object.freeze(["0px", "1px"]);

// Not after "&" (an HTML entity) or "." (a private class field).
const HEX = /(^|[^&\w.])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))(?![\w-])/g;
const COLOUR_FUNCTION = /\b((?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+.\d][^)]*\))/gi;
const PIXELS = /(^|[^\w.-])(-?\d*\.?\d+px)\b/g;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|<!--|\{\s*\/\*)/;
// A token defined here: a CSS custom property, a Sass or Less variable.
const DEFINITION = /^\s*(?:--[\w-]+|\$[\w-]+|@[\w-]+)\s*:/;
const QUERY = /^\s*@(?:media|container)\b/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function anyMatch(patterns) {
  const matchers = patterns.map(pathPatternMatcher);
  return (file) => matchers.some((matches) => matches(file));
}

const isNotUi = anyMatch(NOT_UI_FILES);
const isDefaultUi = anyMatch(DEFAULT_UI_FILES);
const isTokenDefinition = anyMatch(TOKEN_DEFINITION_FILES);

function isUiFile(file, config = {}) {
  if (anyMatch(config.exclude || [])(file)) return false;
  if (anyMatch(config.include || [])(file)) return true;
  return !isNotUi(file) && isDefaultUi(file);
}

// The first disposition that explains an item, as the kind and reference it
// cites. A used set, when given, records which entries explained something.
function explain(dispositions, check, test, used) {
  const entry = (dispositions || []).find((item) => item.check === check && test(item));
  if (!entry) return null;
  used?.add(entry);
  return { kind: entry.kind, ref: entry.ref };
}

function checkScope({ changedFiles, surfaces, uiFiles = {}, dispositions = [], used }) {
  const uiChanged = changedFiles.filter((file) => isUiFile(file, uiFiles));
  if (!surfaces.length)
    return {
      status: "no-surfaces",
      changed_files: changedFiles.length,
      ui_files: uiChanged.length,
      outside: [],
    };
  const inSurface = anyMatch(surfaces.flatMap((surface) => surface.paths));
  const outside = uiChanged
    .filter((file) => !inSurface(file))
    .map((file) => ({
      file,
      disposition: explain(
        dispositions,
        "scope",
        (entry) => pathPatternMatcher(entry.file)(file),
        used
      ),
    }));
  return {
    status: outside.every((entry) => entry.disposition) ? "pass" : "fail",
    changed_files: changedFiles.length,
    ui_files: uiChanged.length,
    outside,
  };
}

// Added lines from a unified diff of one file, numbered in the new file.
function parseAddedLines(diff) {
  const lines = [];
  let next = null;
  for (const line of String(diff).split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) next = Number(hunk[1]);
    else if (next === null || line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) lines.push({ line: next++, text: line.slice(1) });
    else if (line.startsWith(" ")) next += 1;
  }
  return lines;
}

function rawValues(line) {
  if (COMMENT.test(line) || DEFINITION.test(line)) return [];
  const found = [];
  for (const match of line.matchAll(HEX))
    found.push({ index: match.index + match[1].length, value: match[2].toLowerCase() });
  for (const match of line.matchAll(COLOUR_FUNCTION))
    found.push({ index: match.index, value: match[1].replace(/\s+/g, " ").toLowerCase() });
  if (!QUERY.test(line))
    for (const match of line.matchAll(PIXELS)) {
      const value = match[2].toLowerCase();
      if (!ALLOWED_RAW_VALUES.includes(value))
        found.push({ index: match.index + match[1].length, value });
    }
  return found.sort((left, right) => left.index - right.index);
}

// addedLines maps each changed file to its added lines.
function scanTokens({ addedLines, uiFiles = {}, dispositions = [], enforced = true, used }) {
  const hits = [];
  let scanned = 0;
  for (const [file, lines] of Object.entries(addedLines)) {
    if (!isUiFile(file, uiFiles) || isTokenDefinition(file)) continue;
    scanned += 1;
    for (const { line, text: content } of lines)
      for (const { value } of rawValues(content))
        hits.push({
          file,
          line,
          value,
          text: content.trim().slice(0, 160),
          disposition: explain(
            dispositions,
            "tokens",
            (entry) =>
              pathPatternMatcher(entry.file)(file) &&
              (!text(entry.value) || entry.value.trim().toLowerCase() === value),
            used
          ),
        });
  }
  const open = hits.filter((hit) => !hit.disposition).length;
  return {
    status: open === 0 ? "pass" : enforced ? "fail" : "advisory",
    scanned_files: scanned,
    open,
    hits: hits.slice(0, MAX_HITS),
    truncated: hits.length > MAX_HITS,
  };
}

function imageKind(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  return "other";
}

// Same bytes are identical. Two PNGs are compared by decoded pixels, so a
// recompressed screenshot of the same render is unchanged. Anything else can
// only be compared by bytes.
function compareImages(before, after) {
  if (before.equals(after)) return { result: "identical", method: "bytes" };
  if (imageKind(before) !== "png" || imageKind(after) !== "png")
    return {
      result: "differs",
      method: "bytes",
      reason: "the bytes differ; only PNG screenshots are compared by pixel",
    };
  let left;
  let right;
  try {
    left = decodePngRgba(before);
    right = decodePngRgba(after);
  } catch (error) {
    return { result: "differs", method: "bytes", reason: `the bytes differ; ${error.message}` };
  }
  if (left.width !== right.width || left.height !== right.height)
    return {
      result: "differs",
      method: "pixels",
      reason: `the size changed from ${left.width}x${left.height} to ${right.width}x${right.height}`,
    };
  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) {
    const offset = pixel * 4;
    if (left.rgba.readUInt32BE(offset) === right.rgba.readUInt32BE(offset)) continue;
    changed += 1;
    const x = pixel % left.width;
    const y = Math.floor(pixel / left.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const total = left.width * left.height;
  if (changed === 0) return { result: "identical", method: "pixels" };
  return {
    result: "differs",
    method: "pixels",
    changed_pixels: changed,
    total_pixels: total,
    changed_ratio: Number((changed / total).toFixed(6)),
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

// dir is the project-relative checks directory; screenshot paths are relative to it.
function checkNeighbours({
  root,
  dir,
  neighbours,
  surfaceNames,
  dispositions = [],
  enforced = true,
  used,
}) {
  if (!neighbours.length) return { status: "none", screens: [] };
  const screens = neighbours.map((entry) => {
    const inside = text(entry.surface) && surfaceNames.includes(entry.surface);
    const screen = { screen: entry.screen, surface: entry.surface || null, inside };
    try {
      const read = (relative) =>
        readProjectInput(root, `${dir}/${relative}`, MAX_IMAGE_BYTES).bytes;
      screen.comparison = compareImages(read(entry.before), read(entry.after));
    } catch (error) {
      screen.error = `a screenshot cannot be read: ${error.message}`;
    }
    screen.disposition = explain(
      dispositions,
      "neighbours",
      (item) => item.screen === entry.screen,
      used
    );
    screen.blocking =
      Boolean(screen.error) ||
      (screen.comparison.result === "differs" && !inside && !screen.disposition);
    return screen;
  });
  const blocking = screens.some((screen) => screen.blocking);
  return { status: !blocking ? "pass" : enforced ? "fail" : "advisory", screens };
}

function checkPattern(value, at, issues) {
  if (!text(value)) return issues.push(`${at} must be a non-empty path pattern`);
  try {
    validateRepoRelativePattern(value, at);
  } catch (error) {
    issues.push(error.message);
  }
  return undefined;
}

function insideDirectory(value) {
  return (
    text(value) &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function validateChecks(config) {
  const issues = [];
  if (!isObject(config)) return ["the checks file must be a JSON object"];
  const known = new Set(["schema", "schema_version", "ui_files", "dispositions", "neighbours"]);
  for (const field of Object.keys(config))
    if (!known.has(field)) issues.push(`the checks file has unknown field ${field}`);
  if (config.schema !== CHECKS_SCHEMA) issues.push(`schema must equal ${CHECKS_SCHEMA}`);
  if (config.schema_version !== 1) issues.push("schema_version must equal 1");
  const uiFiles = config.ui_files ?? {};
  if (!isObject(uiFiles)) issues.push("ui_files must be an object");
  else
    for (const field of ["include", "exclude"]) {
      const list = uiFiles[field] ?? [];
      if (!Array.isArray(list)) issues.push(`ui_files.${field} must be an array`);
      else list.forEach((item, index) => checkPattern(item, `ui_files.${field}[${index}]`, issues));
    }
  const dispositions = config.dispositions ?? [];
  if (!Array.isArray(dispositions)) issues.push("dispositions must be an array");
  else
    dispositions.forEach((entry, index) => {
      const at = `dispositions[${index}]`;
      if (!isObject(entry)) return issues.push(`${at} must be an object`);
      if (!CHECKS.has(entry.check))
        issues.push(`${at}.check must be one of ${[...CHECKS].join(", ")}`);
      if (!CITE_KINDS.has(entry.kind))
        issues.push(`${at}.kind must be one of ${[...CITE_KINDS].join(", ")}`);
      if (!text(entry.ref))
        issues.push(`${at}.ref must name the token, component, decision or screen`);
      if (entry.check === "neighbours") {
        if (!text(entry.screen)) issues.push(`${at}.screen must name the neighbour screen`);
      } else checkPattern(entry.file, `${at}.file`, issues);
      return undefined;
    });
  const neighbours = config.neighbours ?? [];
  if (!Array.isArray(neighbours)) issues.push("neighbours must be an array");
  else {
    const names = new Set();
    neighbours.forEach((entry, index) => {
      const at = `neighbours[${index}]`;
      if (!isObject(entry) || !text(entry.screen)) return issues.push(`${at} must name its screen`);
      if (names.has(entry.screen)) issues.push(`${at}.screen ${entry.screen} is listed twice`);
      names.add(entry.screen);
      for (const field of ["before", "after"])
        if (!insideDirectory(entry[field]))
          issues.push(`${at}.${field} must be a path inside ${CHECKS_DIR}`);
      if (entry.surface !== undefined && entry.surface !== null && !text(entry.surface))
        issues.push(`${at}.surface must name a declared surface`);
      return undefined;
    });
  }
  return issues;
}

// An absent checks file means defaults and no dispositions.
function readChecks(root, slug) {
  const relative = `.pm/dev-sessions/${slug}/${CHECKS_PATH}`;
  const empty = { ui_files: {}, dispositions: [], neighbours: [] };
  let bytes;
  try {
    bytes = readProjectInput(root, relative, MAX_CHECKS_BYTES).bytes;
  } catch (error) {
    if (error.code === "ENOENT")
      return { path: relative, present: false, config: empty, issues: [] };
    return { path: relative, present: true, config: empty, issues: [error.message] };
  }
  let config;
  try {
    config = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { path: relative, present: true, config: empty, issues: [error.message] };
  }
  const issues = validateChecks(config);
  if (issues.length) return { path: relative, present: true, config: empty, issues };
  return {
    path: relative,
    present: true,
    config: {
      ui_files: config.ui_files || {},
      dispositions: config.dispositions || [],
      neighbours: config.neighbours || [],
    },
    issues,
  };
}

// The declared surfaces: the task's design context and every work unit's,
// merged by name.
function sessionSurfaces(session) {
  const contexts = [
    session?.task?.design_context,
    ...(Array.isArray(session?.task?.work_units) ? session.task.work_units : []).map(
      (unit) => unit?.contract?.design_context
    ),
  ];
  const byName = new Map();
  for (const context of contexts)
    for (const surface of Array.isArray(context?.surfaces) ? context.surfaces : []) {
      if (!isObject(surface) || !text(surface.name) || !Array.isArray(surface.paths)) continue;
      const name = surface.name.trim();
      const paths = byName.get(name) || [];
      for (const pattern of surface.paths) if (!paths.includes(pattern)) paths.push(pattern);
      byName.set(name, paths);
    }
  return [...byName].map(([name, paths]) => ({ name, paths }));
}

function git(root, args) {
  return gitExec(root, [...GIT_DIFF_TRUST_CONFIG, "--literal-pathspecs", ...args]);
}

function resolveCommit(root, ref) {
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

// The session's base is where its branch left the default branch, from local
// refs only: the delivery remote's tracking ref, then the local branch, then
// the commit the session started at.
function resolveBase(root, session, commit) {
  const source = session?.source || {};
  const remote = source.delivery_remote || "origin";
  for (const ref of [
    `refs/remotes/${remote}/${source.default_branch}`,
    `refs/heads/${source.default_branch}`,
  ]) {
    if (!text(source.default_branch) || !resolveCommit(root, ref)) continue;
    const base = git(root, ["merge-base", ref, commit]).trim();
    if (base && base !== commit) return base;
  }
  const started = text(source.base_commit) ? resolveCommit(root, source.base_commit) : null;
  if (started) return git(root, ["merge-base", started, commit]).trim();
  throw new Error("cannot resolve the session base; pass --base");
}

const DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];

function changedFiles(root, base, commit) {
  return git(root, ["diff", ...DIFF_FLAGS, "--name-only", "-z", base, commit])
    .split("\0")
    .filter(Boolean);
}

// Git writes an unusual path in a diff header as a C-style quoted string.
function unquoteGitPath(value) {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const bytes = [];
  const body = value.slice(1, -1);
  const named = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[index + 1];
    if (/[0-7]/.test(next || "")) {
      bytes.push(parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
    } else {
      bytes.push(named[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// The new-side path of a `+++` header, or null for a deleted file.
function headerPath(line) {
  let value = line.slice(4);
  if (value === "/dev/null") return null;
  // Git ends a header whose path contains a space with a tab.
  if (value.endsWith("\t")) value = value.slice(0, -1);
  value = unquoteGitPath(value);
  return value.startsWith("b/") ? value.slice(2) : value;
}

// Splits one multi-file `-U0` diff into added lines per requested file.
// `unmatched` lists header paths that are not among `files`, so the caller can
// fall back to diffing those files one by one.
function splitAddedLines(diff, files) {
  const wanted = new Set(files);
  const chunks = new Map(files.map((file) => [file, []]));
  const unmatched = [];
  let current = null;
  let previous = "";
  for (const line of String(diff).split("\n")) {
    const header = line.startsWith("+++ ") && previous.startsWith("--- ");
    previous = line;
    if (line.startsWith("diff --git ")) current = null;
    // A header pair is "--- old" then "+++ new"; an added line that happens to
    // start with "++ " is content.
    else if (header) {
      const file = headerPath(line);
      current = null;
      if (file === null) continue;
      if (wanted.has(file)) current = chunks.get(file);
      else unmatched.push(file);
      continue;
    }
    if (current) current.push(line);
  }
  const added = {};
  for (const [file, lines] of chunks) added[file] = parseAddedLines(lines.join("\n"));
  return { added, unmatched };
}

// One diff for every UI file. A path the split cannot place is diffed alone,
// so an unusual file name never loses its added lines.
function addedLinesFor(root, base, commit, files) {
  if (!files.length) return {};
  const diff = git(root, ["diff", ...DIFF_FLAGS, "-U0", base, commit, "--", ...files]);
  const { added, unmatched } = splitAddedLines(diff, files);
  if (unmatched.length)
    for (const file of files)
      if (!added[file].length)
        added[file] = parseAddedLines(
          git(root, ["diff", ...DIFF_FLAGS, "-U0", base, commit, "--", file])
        );
  return added;
}

function runMechanicalChecks({ root, session, commit, base }) {
  const slug = String(session.slug);
  const surfaces = sessionSurfaces(session);
  const enforced = surfaces.length > 0;
  const checks = readChecks(root, slug);
  const { ui_files: uiFiles, dispositions, neighbours } = checks.config;
  const resolvedBase = base || resolveBase(root, session, commit);
  const files = changedFiles(root, resolvedBase, commit);
  const uiChanged = files.filter((file) => isUiFile(file, uiFiles));
  const used = new Set();
  const scope = checkScope({ changedFiles: files, surfaces, uiFiles, dispositions, used });
  const tokens = scanTokens({
    used,
    addedLines: addedLinesFor(root, resolvedBase, commit, uiChanged),
    uiFiles,
    dispositions,
    enforced,
  });
  const surfaceNames = surfaces.map((surface) => surface.name);
  const neighbourResult = checkNeighbours({
    root,
    dir: `.pm/dev-sessions/${slug}/${CHECKS_DIR}`,
    neighbours,
    surfaceNames,
    dispositions,
    enforced,
    used,
  });
  // An unreadable checks file fails only a run that enforces; a session with
  // no declared surfaces reports it and still passes.
  const checkProblems = checks.issues.map((message) => ({ check: "checks", message }));
  const issues = enforced ? checkProblems : [];
  const advisories = enforced ? [] : checkProblems;
  for (const entry of neighbours)
    if (text(entry.surface) && enforced && !surfaceNames.includes(entry.surface))
      issues.push({
        check: "neighbours",
        message: `${entry.screen} names ${entry.surface}, which is not a declared surface`,
      });
  if (scope.status === "fail")
    for (const entry of scope.outside.filter((item) => !item.disposition))
      issues.push({ check: "scope", message: `${entry.file} is outside every declared surface` });
  if (tokens.status === "fail")
    for (const hit of tokens.hits.filter((item) => !item.disposition))
      issues.push({ check: "tokens", message: `${hit.file}:${hit.line} hardcodes ${hit.value}` });
  if (neighbourResult.status === "fail")
    for (const screen of neighbourResult.screens.filter((item) => item.blocking))
      issues.push({
        check: "neighbours",
        message: screen.error
          ? `${screen.screen}: ${screen.error}`
          : `${screen.screen} changed outside the declared surfaces`,
      });
  return {
    schema: "design-director-mechanical-result",
    ok: issues.length === 0,
    enforced,
    commit,
    base: resolvedBase,
    checks_file: checks.present ? checks.path : null,
    surfaces: surfaceNames,
    scope,
    tokens,
    neighbours: neighbourResult,
    issues,
    advisories,
    unused_dispositions: dispositions.filter((entry) => !used.has(entry)),
  };
}

module.exports = {
  ALLOWED_RAW_VALUES,
  CHECKS_DIR,
  CHECKS_PATH,
  DEFAULT_UI_FILES,
  NOT_UI_FILES,
  TOKEN_DEFINITION_FILES,
  checkNeighbours,
  checkScope,
  compareImages,
  isUiFile,
  parseAddedLines,
  readChecks,
  resolveBase,
  runMechanicalChecks,
  scanTokens,
  sessionSurfaces,
  splitAddedLines,
};
