#!/usr/bin/env node
"use strict";

// capture-backlog — the shared atomic Task/Bug backlog boundary.
// Create:
//   node scripts/capture-backlog.js --pm-dir pm --kind task|bug --title "..."
// Enrich:
//   node scripts/capture-backlog.js --action enrich --pm-dir pm --kind bug
//     --slug item --expected-sha256 sha256:... [--priority high] [--body-file path]

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { serializeFrontmatter, todayIso } = require("./kb-utils.js");
const { acquireOwnedLock } = require("./lib/owned-lock.js");
const { readProjectInput, writeProjectTextAtomic } = require("./lib/project-file.js");

const VALID_KINDS = new Set(["task", "bug"]);
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const MAX_TITLE_CHARS = 200;
const MAX_OUTCOME_CHARS = 500;
const MAX_LABELS = 16;
const MAX_LABEL_CHARS = 64;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BACKLOG_FILES = 10_000;
const MAX_BACKLOG_FILE_BYTES = 1024 * 1024;
const MAX_BACKLOG_ID = 999_999;
const MAX_REQUEST_BYTES = 128 * 1024;
const CREATE_API_FIELDS = new Set([
  "kind",
  "title",
  "outcome",
  "priority",
  "labels",
  "body",
  "slug",
  "id",
]);
const ENRICH_API_FIELDS = new Set([
  "kind",
  "expectedSha256",
  "outcome",
  "priority",
  "labels",
  "body",
]);
const COMMON_CLI_OPTIONS = new Set([
  "action",
  "pm-dir",
  "kind",
  "outcome",
  "priority",
  "labels",
  "body",
  "body-file",
  "slug",
  "request-file",
]);
const CREATE_CLI_OPTIONS = new Set([...COMMON_CLI_OPTIONS, "title", "id"]);
const ENRICH_CLI_OPTIONS = new Set([...COMMON_CLI_OPTIONS, "expected-sha256"]);
const PREFERRED_KEYS = [
  "type",
  "id",
  "title",
  "outcome",
  "kind",
  "status",
  "priority",
  "labels",
  "created",
  "updated",
];

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function defaultLabelsForKind(kind) {
  return kind === "bug" ? ["bug"] : ["chore"];
}

function defaultPriorityForKind(kind) {
  return kind === "bug" ? "high" : "medium";
}

function captureBacklogItem(pmDir, opts) {
  const input = validateCreateInput(opts);
  return createBacklogRecordAtomic(pmDir, {
    slug: input.slug,
    id: input.id,
    render(id) {
      const today = todayIso();
      return renderBacklogDocument(
        {
          type: "backlog",
          id,
          title: input.title,
          outcome: input.outcome,
          kind: input.kind,
          status: "proposed",
          priority: input.priority,
          labels: input.labels,
          created: today,
          updated: today,
        },
        input.body
      );
    },
    validate(parsed) {
      validateExistingDocument(parsed, input.kind);
    },
  });
}

function createBacklogRecordAtomic(pmDir, options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("createBacklogRecordAtomic: options are required");
  }
  rejectUnknownFields(
    options,
    new Set(["slug", "id", "render", "validate"]),
    "createBacklogRecordAtomic"
  );
  const slug = validateSlug(options.slug);
  const explicitId = options.id === undefined ? undefined : validateId(options.id);
  if (typeof options.render !== "function" || typeof options.validate !== "function") {
    throw new Error("createBacklogRecordAtomic: render and validate callbacks are required");
  }
  const root = resolvePmRoot(pmDir);
  const release = captureLock(root);
  try {
    attestBacklogDirectory(root);
    const snapshot = readBacklogSnapshot(root);
    const relativePath = `backlog/${slug}.md`;
    if (snapshot.byName.has(`${slug}.md`)) {
      const collision = new Error(
        `captureBacklogItem: refusing to overwrite ${path.join(root, relativePath)}`
      );
      collision.code = "BACKLOG_SLUG_COLLISION";
      throw collision;
    }
    const nextId = formatNextId(snapshot.maxId);
    if (explicitId && explicitId !== nextId) {
      throw new Error(`captureBacklogItem: id must equal next allocated id ${nextId}`);
    }
    const id = explicitId || nextId;
    if (snapshot.ids.has(id)) throw new Error(`captureBacklogItem: id ${id} already exists`);
    const content = options.render(id);
    if (typeof content !== "string") {
      throw new Error("createBacklogRecordAtomic: render must return a string");
    }
    const published = publishAndValidate(root, relativePath, content, {
      id,
      replace: false,
      validate: options.validate,
    });
    return receipt("created", published, slug);
  } finally {
    release();
  }
}

function enrichBacklogItem(pmDir, slug, opts) {
  const input = validateEnrichInput(slug, opts);
  const root = resolvePmRoot(pmDir);
  const release = captureLock(root);
  try {
    if (!attestBacklogDirectory(root, { create: false })) {
      throw new Error("enrichBacklogItem: backlog directory does not exist");
    }
    const relativePath = `backlog/${input.slug}.md`;
    const existing = readProjectInput(root, relativePath, MAX_BACKLOG_FILE_BYTES);
    const observedSha256 = sha256(existing.bytes);
    if (observedSha256 !== input.expectedSha256) {
      throw new Error("enrichBacklogItem: backlog item changed since capture");
    }
    const parsed = parseFrontmatter(existing.bytes.toString("utf8"));
    validateExistingDocument(parsed, input.kind);
    const frontmatter = {
      ...parsed.data,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      updated: todayIso(),
    };
    const body = input.body === undefined ? parsed.body || "" : input.body;
    const content = renderBacklogDocument(frontmatter, body);
    const published = publishAndValidate(root, relativePath, content, {
      id: parsed.data.id,
      replace: true,
      validate(nextParsed) {
        validateExistingDocument(nextParsed, input.kind);
      },
      finalAttestation: {
        path: relativePath,
        sha256: observedSha256,
        maxBytes: MAX_BACKLOG_FILE_BYTES,
      },
    });
    return receipt("enriched", published, input.slug);
  } finally {
    release();
  }
}

function validateCreateInput(opts) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error("captureBacklogItem: options are required");
  }
  rejectUnknownFields(opts, CREATE_API_FIELDS, "captureBacklogItem");
  const kind = validateKind(opts.kind, "captureBacklogItem");
  const title = boundedText(opts.title, "title", MAX_TITLE_CHARS, { required: true });
  const slug = validateSlug(opts.slug === undefined ? slugify(title) : opts.slug);
  const outcome = boundedText(
    opts.outcome === undefined ? title : opts.outcome,
    "outcome",
    MAX_OUTCOME_CHARS,
    {
      required: true,
    }
  );
  const priority = validatePriority(opts.priority ?? defaultPriorityForKind(kind));
  const labels = validateLabels(opts.labels ?? defaultLabelsForKind(kind));
  const id = opts.id === undefined ? undefined : validateId(opts.id);
  const body = validateBody(opts.body ?? "", kind);
  return { kind, title, slug, outcome, priority, labels, id, body };
}

function validateEnrichInput(slug, opts) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error("enrichBacklogItem: options are required");
  }
  rejectUnknownFields(opts, ENRICH_API_FIELDS, "enrichBacklogItem");
  const kind = validateKind(opts.kind, "enrichBacklogItem");
  const expectedSha256 = String(opts.expectedSha256 || "");
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("enrichBacklogItem: expectedSha256 is required");
  }
  if (!["outcome", "priority", "labels", "body"].some((field) => opts[field] !== undefined)) {
    throw new Error("enrichBacklogItem: at least one change is required");
  }
  return {
    kind,
    slug: validateSlug(slug),
    expectedSha256,
    outcome:
      opts.outcome === undefined
        ? undefined
        : boundedText(opts.outcome, "outcome", MAX_OUTCOME_CHARS, { required: true }),
    priority: opts.priority === undefined ? undefined : validatePriority(opts.priority),
    labels: opts.labels === undefined ? undefined : validateLabels(opts.labels),
    body: opts.body === undefined ? undefined : validateBody(opts.body, kind),
  };
}

function validateKind(value, owner) {
  if (typeof value !== "string" || !VALID_KINDS.has(value)) {
    throw new Error(`${owner}: kind must be task or bug`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, owner) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${owner}: unknown option ${field}`);
  }
}

function validatePriority(value) {
  if (typeof value !== "string" || !VALID_PRIORITIES.has(value)) {
    throw new Error("priority must be critical, high, medium, or low");
  }
  return value;
}

function validateId(value) {
  parseBacklogId(value, "id");
  return value;
}

function parseBacklogId(value, field = "backlog id") {
  if (typeof value !== "string" || !/^PM-\d{3,}$/.test(value)) {
    throw new Error(`${field} must match PM-NNN`);
  }
  const numeric = Number(value.slice(3));
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > MAX_BACKLOG_ID) {
    throw new Error(`${field} must be between PM-001 and PM-${MAX_BACKLOG_ID}`);
  }
  return numeric;
}

function validateSlug(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 60 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error("slug must be a non-empty lowercase kebab-case value of at most 60 characters");
  }
  return value;
}

function validateLabels(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LABELS) {
    throw new Error(`labels must contain 1-${MAX_LABELS} entries`);
  }
  const labels = value.map((label) =>
    boundedText(label, "label", MAX_LABEL_CHARS, { required: true })
  );
  if (new Set(labels).size !== labels.length) throw new Error("labels must be unique");
  return labels;
}

function validateBody(value, kind) {
  if (typeof value !== "string") throw new Error("body must be a string");
  if (value.includes("\0")) throw new Error("body must not contain NUL bytes");
  if (Buffer.byteLength(value) > MAX_BODY_BYTES) {
    throw new Error(`body exceeds ${MAX_BODY_BYTES}-byte budget`);
  }
  return kind === "bug" ? normalizeBugBody(value) : value;
}

function normalizeBugBody(value) {
  const source = value.trim();
  const sections = ["Observed", "Expected", "Reproduction"];
  const content = new Map(sections.map((section) => [section, []]));
  let active = null;
  let fence = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (active) content.get(active).push(line);
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (marker) {
      if (active) content.get(active).push(line);
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (sections.includes(heading[1])) active = heading[1];
      else if (active) content.get(active).push(line);
      continue;
    }
    if (active) content.get(active).push(line);
  }
  const output = [];
  for (const [index, section] of sections.entries()) {
    const text = content.get(section).join("\n").trim() || "_Pending — add before /pm:dev._";
    output.push(`## ${section}\n\n${text}`);
    if (index < sections.length - 1) output.push("");
  }
  return `${output.join("\n")}\n`;
}

function boundedText(value, field, maxChars, options = {}) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (options.required && !normalized) throw new Error(`${field} is required`);
  if (normalized.length > maxChars) throw new Error(`${field} exceeds ${maxChars} characters`);
  if (/\0|[\r\n]/.test(normalized)) throw new Error(`${field} must be one line without NUL bytes`);
  return normalized;
}

function resolvePmRoot(pmDir) {
  if (typeof pmDir !== "string" || !pmDir.trim()) throw new Error("pmDir is required");
  const absolute = path.resolve(pmDir);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("pmDir must be a real directory");
  }
  const real = fs.realpathSync(absolute);
  return real;
}

function attestBacklogDirectory(root, options = {}) {
  const backlog = path.join(root, "backlog");
  let stat;
  try {
    stat = fs.lstatSync(backlog);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (options.create === false) return false;
    try {
      fs.mkdirSync(backlog, { mode: 0o755 });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    stat = fs.lstatSync(backlog);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("backlog must be a real directory");
  }
  return true;
}

function captureLock(root) {
  return acquireOwnedLock(path.join(root, ".capture-backlog.lock"), {
    attempts: 400,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: "timed out waiting for backlog capture lock",
    directoryMode: 0o755,
    fileMode: 0o600,
  });
}

function readBacklogSnapshot(root) {
  if (!attestBacklogDirectory(root, { create: false })) {
    return { byName: new Set(), ids: new Set(), maxId: 0 };
  }
  const names = fs.readdirSync(path.join(root, "backlog"));
  if (names.length > MAX_BACKLOG_FILES) {
    throw new Error(`backlog exceeds ${MAX_BACKLOG_FILES}-file budget`);
  }
  const byName = new Set();
  const ids = new Set();
  let maxId = 0;
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    byName.add(name);
    const input = readProjectInput(root, `backlog/${name}`, MAX_BACKLOG_FILE_BYTES);
    const parsed = parseFrontmatter(input.bytes.toString("utf8"));
    const id = parsed.data.id;
    if (id === undefined || id === null) continue;
    const numeric = parseBacklogId(id, `backlog id in ${name}`);
    if (ids.has(id)) throw new Error(`backlog contains duplicate id ${id}`);
    ids.add(id);
    maxId = Math.max(maxId, numeric);
  }
  return { byName, ids, maxId };
}

function nextBacklogId(pmDir) {
  const root = resolvePmRoot(pmDir);
  return formatNextId(readBacklogSnapshot(root).maxId);
}

function formatNextId(maxId) {
  if (!Number.isSafeInteger(maxId) || maxId < 0 || maxId >= MAX_BACKLOG_ID) {
    throw new Error(`backlog id space exhausted at PM-${MAX_BACKLOG_ID}`);
  }
  return `PM-${String(maxId + 1).padStart(3, "0")}`;
}

function renderBacklogDocument(frontmatter, body) {
  const content = `${serializeFrontmatter(frontmatter, PREFERRED_KEYS)}\n${body}`;
  if (Buffer.byteLength(content) > MAX_BACKLOG_FILE_BYTES) {
    throw new Error(`backlog document exceeds ${MAX_BACKLOG_FILE_BYTES}-byte budget`);
  }
  return content;
}

function validateExistingDocument(parsed, expectedKind) {
  if (!parsed.hasFrontmatter || parsed.data.type !== "backlog") {
    throw new Error("enrichBacklogItem: target is not a backlog document");
  }
  if (parsed.data.kind !== expectedKind) {
    throw new Error(`enrichBacklogItem: expected kind ${expectedKind}, found ${parsed.data.kind}`);
  }
  if (parsed.data.status !== "proposed") throw new Error("backlog status must be proposed");
  validateId(parsed.data.id);
  boundedText(parsed.data.title, "title", MAX_TITLE_CHARS, { required: true });
  boundedText(parsed.data.outcome, "outcome", MAX_OUTCOME_CHARS, { required: true });
  validatePriority(parsed.data.priority);
  validateLabels(parsed.data.labels);
  validateDate(parsed.data.created, "created");
  validateDate(parsed.data.updated, "updated");
  validateBody(parsed.body || "", expectedKind);
}

function validateDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a real calendar date`);
  }
}

function validatePublished(root, relativePath, expected) {
  const input = readProjectInput(root, relativePath, MAX_BACKLOG_FILE_BYTES);
  if (sha256(input.bytes) !== expected.sha256) throw new Error("published backlog bytes changed");
  const parsed = parseFrontmatter(input.bytes.toString("utf8"));
  expected.validate(parsed);
  if (parsed.data.id !== expected.id) throw new Error("published backlog id changed");
  return { filePath: input.path, id: expected.id, sha256: sha256(input.bytes) };
}

function publishAndValidate(root, relativePath, content, options) {
  let committed = false;
  try {
    writeProjectTextAtomic(root, relativePath, content, {
      replace: options.replace,
      fileMode: 0o644,
      directoryMode: 0o755,
      maxBytes: MAX_BACKLOG_FILE_BYTES,
      ...(options.finalAttestation ? { finalAttestation: options.finalAttestation } : {}),
    });
    committed = true;
    return validatePublished(root, relativePath, {
      id: options.id,
      validate: options.validate,
      sha256: sha256(Buffer.from(content)),
    });
  } catch (error) {
    if (committed || error.committed === true) {
      const failure = new Error(
        `backlog write committed but validation failed; do not retry: ${error.message}`
      );
      failure.committed = true;
      throw failure;
    }
    throw error;
  }
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function receipt(action, published, slug) {
  return {
    action,
    filePath: published.filePath,
    id: published.id,
    slug,
    content_sha256: published.sha256,
  };
}

function readBodyFile(filePath) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("body-file must be a regular file");
  if (stat.size > MAX_BODY_BYTES)
    throw new Error(`body-file exceeds ${MAX_BODY_BYTES}-byte budget`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error("body-file changed during validation");
    }
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function readRequestFile(filePath) {
  const raw = readBoundedRegularFile(filePath, MAX_REQUEST_BYTES, "request-file");
  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    throw new Error(`request-file must contain valid JSON: ${error.message}`);
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("request-file must contain one JSON object");
  }
  return request;
}

function readBoundedRegularFile(filePath, maxBytes, label) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes}-byte budget`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error(`${label} changed during validation`);
    }
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (![...CREATE_CLI_OPTIONS, ...ENRICH_CLI_OPTIONS].includes(key)) {
      throw new Error(`unknown option --${key}`);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (Object.hasOwn(opts, key)) throw new Error(`--${key} may be provided only once`);
    opts[key] = next;
    i += 1;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["request-file"] !== undefined) {
    for (const key of Object.keys(args)) {
      if (!new Set(["pm-dir", "request-file"]).has(key)) {
        throw new Error(`option --${key} cannot be combined with --request-file`);
      }
    }
    const request = readRequestFile(args["request-file"]);
    const action = request.action || "create";
    const input = omitField(request, "action");
    const result =
      action === "create"
        ? captureBacklogItem(args["pm-dir"] || "pm", input)
        : action === "enrich"
          ? enrichBacklogItem(args["pm-dir"] || "pm", input.slug, omitField(input, "slug"))
          : (() => {
              throw new Error("request action must be create or enrich");
            })();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const action = args.action || "create";
  const allowed =
    action === "create" ? CREATE_CLI_OPTIONS : action === "enrich" ? ENRICH_CLI_OPTIONS : null;
  if (!allowed) throw new Error("action must be create or enrich");
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error(`option --${key} is not valid for ${action}`);
  }
  if (args.body !== undefined && args["body-file"] !== undefined) {
    throw new Error("--body and --body-file cannot be combined");
  }
  const pmDir = args["pm-dir"] || "pm";
  const labels =
    args.labels === undefined ? undefined : args.labels.split(",").map((item) => item.trim());
  const body = args["body-file"] ? readBodyFile(args["body-file"]) : args.body;
  let result;
  if (action === "create") {
    result = captureBacklogItem(pmDir, {
      kind: args.kind,
      title: args.title,
      outcome: args.outcome,
      priority: args.priority,
      labels,
      body,
      slug: args.slug,
      id: args.id,
    });
  } else {
    result = enrichBacklogItem(pmDir, args.slug, {
      kind: args.kind,
      expectedSha256: args["expected-sha256"],
      outcome: args.outcome,
      priority: args.priority,
      labels,
      body,
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function omitField(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`capture-backlog: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  captureBacklogItem,
  createBacklogRecordAtomic,
  enrichBacklogItem,
  nextBacklogId,
  slugify,
};
