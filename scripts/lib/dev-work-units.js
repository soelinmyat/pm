"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runGit: sharedRunGit } = require("../loop-git");
const { isRfc3339DateTime } = require("./iso-time");
const { inspectStableProjectInput, readProjectInput } = require("./safe-project-output");

const VALID_STATUSES = new Set(["pending", "running", "completed", "blocked", "failed"]);
const WORK_UNIT_FIELDS = new Set([
  "id",
  "title",
  "depends_on",
  "owns",
  "contract",
  "status",
  "result",
  "base_commit",
  "assigned_worktree",
  "assigned_branch",
  "transitions",
  "updated_at",
]);
const RESULT_STATUSES = new Set(["completed", "blocked", "failed"]);
const RESULT_FIELDS = new Set([
  "schema_version",
  "work_unit_id",
  "status",
  "summary",
  "reason",
  "commit",
  "files_changed",
  "evidence",
  "blocker",
  "runtime",
]);
const TRANSITION_FIELDS = new Set(["from", "to", "reason", "commit", "recorded_at"]);
const DESIGN_CONTEXT_FIELDS = new Set([
  "design_requirements",
  "ui_impact",
  "prototype",
  "critical_states",
  "experience_invariants",
  "visual_invariants",
]);
const PROTOTYPE_FIELDS = new Set(["path", "sha256", "manifest"]);
const PROTOTYPE_MANIFEST_FIELDS = new Set(["schema_version", "files", "tree_sha256"]);
const PROTOTYPE_MANIFEST_FILE_FIELDS = new Set(["path", "sha256"]);
const MAX_PROTOTYPE_BYTES = 10 * 1024 * 1024;
const MAX_PROTOTYPE_TREE_BYTES = 32 * 1024 * 1024;
const MAX_PROTOTYPE_FILES = 128;
const MAX_PROTOTYPE_ENTRIES = MAX_PROTOTYPE_FILES * 4;
const MAX_PROTOTYPE_DEPTH = 8;
const HTML_ATTRIBUTE_ASCII_REFERENCES = Object.freeze({
  amp: "&",
  apos: "'",
  ast: "*",
  bsol: "\\",
  colon: ":",
  comma: ",",
  commat: "@",
  dollar: "$",
  equals: "=",
  excl: "!",
  grave: "`",
  gt: ">",
  hat: "^",
  lbrace: "{",
  lbrack: "[",
  lcub: "{",
  lowbar: "_",
  lpar: "(",
  lsqb: "[",
  lt: "<",
  midast: "*",
  newline: "\n",
  num: "#",
  percnt: "%",
  period: ".",
  plus: "+",
  quest: "?",
  quot: '"',
  rbrace: "}",
  rbrack: "]",
  rcub: "}",
  rpar: ")",
  rsqb: "]",
  semi: ";",
  sol: "/",
  tab: "\t",
  verbar: "|",
  verticalline: "|",
});
const RESOURCE_URL = "url";
const RESOURCE_SPACE_SEPARATED_URL_LIST = "space-separated-url-list";
const RESOURCE_IMAGE_CANDIDATE_LIST = "image-candidate-list";
const PROTOTYPE_SVG_DECLARATIVE_MUTATION_ELEMENTS = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "discard",
  "set",
]);
const PROTOTYPE_SVG_PRESENTATION_RESOURCE_ATTRIBUTES = Object.freeze([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);
const PROTOTYPE_RESOURCE_ATTRIBUTES = new Map([
  [
    "a",
    Object.freeze({
      href: RESOURCE_URL,
      "xlink:href": RESOURCE_URL,
      ping: RESOURCE_SPACE_SEPARATED_URL_LIST,
      attributionsrc: RESOURCE_SPACE_SEPARATED_URL_LIST,
    }),
  ],
  ["altglyph", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  [
    "area",
    Object.freeze({
      href: RESOURCE_URL,
      ping: RESOURCE_SPACE_SEPARATED_URL_LIST,
      attributionsrc: RESOURCE_SPACE_SEPARATED_URL_LIST,
    }),
  ],
  ["audio", Object.freeze({ src: RESOURCE_URL, href: RESOURCE_URL })],
  ["body", Object.freeze({ background: RESOURCE_URL })],
  ["button", Object.freeze({ formaction: RESOURCE_URL })],
  ["color-profile", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["cursor", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["embed", Object.freeze({ src: RESOURCE_URL })],
  ["feimage", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["filter", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["form", Object.freeze({ action: RESOURCE_URL })],
  ["frame", Object.freeze({ src: RESOURCE_URL })],
  ["foreignobject", Object.freeze({ href: RESOURCE_URL })],
  ["iframe", Object.freeze({ src: RESOURCE_URL, href: RESOURCE_URL })],
  ["image", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  [
    "img",
    Object.freeze({
      src: RESOURCE_URL,
      srcset: RESOURCE_IMAGE_CANDIDATE_LIST,
      lowsrc: RESOURCE_URL,
      attributionsrc: RESOURCE_SPACE_SEPARATED_URL_LIST,
    }),
  ],
  ["input", Object.freeze({ src: RESOURCE_URL, formaction: RESOURCE_URL })],
  ["link", Object.freeze({ href: RESOURCE_URL, imagesrcset: RESOURCE_IMAGE_CANDIDATE_LIST })],
  ["lineargradient", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["mpath", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["object", Object.freeze({ data: RESOURCE_URL })],
  ["pattern", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["radialgradient", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  [
    "script",
    Object.freeze({
      src: RESOURCE_URL,
      href: RESOURCE_URL,
      "xlink:href": RESOURCE_URL,
      attributionsrc: RESOURCE_SPACE_SEPARATED_URL_LIST,
    }),
  ],
  ["source", Object.freeze({ src: RESOURCE_URL, srcset: RESOURCE_IMAGE_CANDIDATE_LIST })],
  ["table", Object.freeze({ background: RESOURCE_URL })],
  ["tbody", Object.freeze({ background: RESOURCE_URL })],
  ["td", Object.freeze({ background: RESOURCE_URL })],
  ["tfoot", Object.freeze({ background: RESOURCE_URL })],
  ["th", Object.freeze({ background: RESOURCE_URL })],
  ["thead", Object.freeze({ background: RESOURCE_URL })],
  ["textpath", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["tr", Object.freeze({ background: RESOURCE_URL })],
  ["track", Object.freeze({ src: RESOURCE_URL })],
  ["tref", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["use", Object.freeze({ href: RESOURCE_URL, "xlink:href": RESOURCE_URL })],
  ["video", Object.freeze({ src: RESOURCE_URL, poster: RESOURCE_URL, href: RESOURCE_URL })],
]);

function validateWorkUnits(units, options = {}) {
  if (!Array.isArray(units)) throw new TypeError("work units must be an array");
  const byId = new Map();
  const validationOptions = {
    ...options,
    prototypeVerificationCache: options.prototypeVerificationCache || new Map(),
  };

  for (const item of units) {
    if (!isObject(item)) throw new TypeError("each work unit must be an object");
    for (const field of Object.keys(item)) {
      if (!WORK_UNIT_FIELDS.has(field)) {
        throw new Error(`work unit ${item.id || "(unknown)"} has unknown field: ${field}`);
      }
    }
    if (!nonEmpty(item.id)) throw new TypeError("work unit id is required");
    if (byId.has(item.id)) throw new Error(`duplicate work unit id: ${item.id}`);
    if (!nonEmpty(item.title)) throw new TypeError(`work unit ${item.id} title is required`);
    if (!Array.isArray(item.depends_on)) {
      throw new TypeError(`work unit ${item.id} depends_on must be an array`);
    }
    if (!Array.isArray(item.owns) || item.owns.length === 0) {
      throw new TypeError(`work unit ${item.id} owns must be a non-empty array`);
    }
    if (!VALID_STATUSES.has(item.status)) {
      throw new Error(`work unit ${item.id} has invalid status: ${String(item.status)}`);
    }
    if (item.contract !== undefined)
      validateWorkUnitContract(item.contract, item.id, validationOptions);
    if (item.result !== undefined && item.result !== null && !isObject(item.result)) {
      throw new TypeError(`work unit ${item.id} result must be null or an object`);
    }
    for (const field of ["assigned_worktree", "assigned_branch", "base_commit"]) {
      if (item[field] !== undefined && item[field] !== null && !nonEmpty(item[field])) {
        throw new TypeError(`work unit ${item.id} ${field} must be null or a non-empty string`);
      }
    }
    if (item.assigned_worktree !== undefined && item.assigned_worktree !== null) {
      if (!path.isAbsolute(item.assigned_worktree)) {
        throw new TypeError(`work unit ${item.id} assigned_worktree must be absolute`);
      }
    }
    if (item.transitions !== undefined && !Array.isArray(item.transitions)) {
      throw new TypeError(`work unit ${item.id} transitions must be an array`);
    }
    if (item.updated_at !== undefined && item.updated_at !== null && !nonEmpty(item.updated_at)) {
      throw new TypeError(`work unit ${item.id} updated_at must be null or a non-empty string`);
    }
    if (item.updated_at && !isRfc3339DateTime(item.updated_at)) {
      throw new TypeError(`work unit ${item.id} updated_at must be an RFC 3339 date-time`);
    }
    if (options.persisted && ["running", "completed", "blocked", "failed"].includes(item.status)) {
      for (const field of ["base_commit", "assigned_worktree", "assigned_branch"]) {
        if (!nonEmpty(item[field]))
          throw new TypeError(`work unit ${item.id} ${field} is required`);
      }
    }
    if (options.persisted && ["completed", "blocked", "failed"].includes(item.status)) {
      const persistedResult = validateWorkUnitResult(item.result, {
        expectedWorkUnitId: item.id,
      });
      if (persistedResult.status !== item.status) {
        throw new Error(
          `work unit ${item.id} result status ${persistedResult.status} does not match ${item.status}`
        );
      }
    } else if (options.persisted && item.result !== undefined && item.result !== null) {
      throw new Error(`work unit ${item.id} cannot have a result while ${item.status}`);
    }
    for (const [index, transition] of (item.transitions || []).entries()) {
      validateTransition(item.id, transition, index);
    }
    for (const ownership of item.owns) {
      if (!nonEmpty(ownership)) throw new TypeError(`work unit ${item.id} has empty ownership`);
      validateRepoRelativePattern(ownership, `work unit ${item.id} ownership`);
    }
    byId.set(item.id, item);
  }

  for (const item of units) {
    const uniqueDependencies = new Set();
    for (const dependency of item.depends_on) {
      if (!nonEmpty(dependency)) {
        throw new TypeError(`work unit ${item.id} has an empty dependency`);
      }
      if (dependency === item.id) throw new Error(`work unit ${item.id} depends on itself`);
      if (!byId.has(dependency)) {
        throw new Error(`work unit ${item.id} has unknown dependency ${dependency}`);
      }
      if (uniqueDependencies.has(dependency)) {
        throw new Error(`work unit ${item.id} repeats dependency ${dependency}`);
      }
      uniqueDependencies.add(dependency);
    }
  }

  detectCycle(units, byId);
  return units;
}

function validateTransition(unitId, transition, index) {
  if (!isObject(transition)) {
    throw new TypeError(`work unit ${unitId} transition ${index} must be an object`);
  }
  for (const field of Object.keys(transition)) {
    if (!TRANSITION_FIELDS.has(field)) {
      throw new Error(`work unit ${unitId} transition ${index} has unknown field ${field}`);
    }
  }
  for (const field of TRANSITION_FIELDS) {
    if (!Object.hasOwn(transition, field)) {
      throw new Error(`work unit ${unitId} transition ${index} requires ${field}`);
    }
  }
  if (!VALID_STATUSES.has(transition.from) || !VALID_STATUSES.has(transition.to)) {
    throw new Error(`work unit ${unitId} transition ${index} has invalid status`);
  }
  if (!nonEmpty(transition.reason)) {
    throw new TypeError(`work unit ${unitId} transition ${index} reason is required`);
  }
  if (transition.commit !== null && !nonEmpty(transition.commit)) {
    throw new TypeError(`work unit ${unitId} transition ${index} commit must be null or a string`);
  }
  if (!isRfc3339DateTime(transition.recorded_at)) {
    throw new TypeError(`work unit ${unitId} transition ${index} recorded_at must be RFC 3339`);
  }
}

function validateWorkUnitContract(contract, unitId, options = {}) {
  if (!isObject(contract)) throw new TypeError(`work unit ${unitId} contract must be an object`);
  const fields = [
    "acceptance_criteria",
    "approach",
    "verification_commands",
    "test_hooks",
    "design_context",
  ];
  for (const field of Object.keys(contract)) {
    if (!fields.includes(field))
      throw new Error(`work unit ${unitId} contract has unknown field ${field}`);
  }
  for (const field of fields.filter((name) => name !== "design_context")) {
    if (!Object.hasOwn(contract, field)) {
      throw new Error(`work unit ${unitId} contract requires ${field}`);
    }
  }
  for (const field of ["acceptance_criteria", "verification_commands", "test_hooks"]) {
    if (!Array.isArray(contract[field]) || contract[field].some((item) => !nonEmpty(item))) {
      throw new TypeError(`work unit ${unitId} contract ${field} must contain non-empty strings`);
    }
  }
  if (contract.acceptance_criteria.length === 0 || contract.verification_commands.length === 0) {
    throw new TypeError(`work unit ${unitId} contract requires acceptance and verification`);
  }
  if (!nonEmpty(contract.approach)) {
    throw new TypeError(`work unit ${unitId} contract approach is required`);
  }
  if (contract.design_context !== undefined) {
    validateDesignContext(contract.design_context, `work unit ${unitId} contract design_context`, {
      repoRoot: options.repoRoot,
      requireCurrentPrototypeIdentity: options.requireCurrentPrototypeIdentity,
      requireExperienceClassification: options.requireExperienceClassification,
      prototypeVerificationCache: options.prototypeVerificationCache,
    });
  }
}

function validateDesignContext(context, label = "design_context", options = {}) {
  if (!isObject(context)) throw new TypeError(`${label} must be an object`);
  for (const field of Object.keys(context)) {
    if (!DESIGN_CONTEXT_FIELDS.has(field)) {
      throw new Error(`${label} has unknown field ${field}`);
    }
  }
  for (const field of [
    "design_requirements",
    "prototype",
    "critical_states",
    "visual_invariants",
  ]) {
    if (!Object.hasOwn(context, field)) throw new Error(`${label} requires ${field}`);
  }
  for (const field of ["design_requirements", "critical_states"]) {
    const values = context[field];
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`${label}.${field} must be a non-empty array`);
    }
    if (values.some((item) => !nonEmpty(item))) {
      throw new TypeError(`${label}.${field} must contain non-empty strings`);
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`${label}.${field} must not contain duplicates`);
    }
  }
  const classified = Object.hasOwn(context, "ui_impact");
  if (classified !== Object.hasOwn(context, "experience_invariants")) {
    throw new Error(`${label}.ui_impact and ${label}.experience_invariants must appear together`);
  }
  if (options.requireExperienceClassification && !classified) {
    throw new Error(
      `${label} requires explicit ui_impact and experience_invariants for a current handoff`
    );
  }
  validateUniqueStrings(context.visual_invariants, `${label}.visual_invariants`, {
    nonEmpty: !classified || context.ui_impact === true,
  });
  if (classified) {
    if (typeof context.ui_impact !== "boolean") {
      throw new TypeError(`${label}.ui_impact must be a boolean`);
    }
    validateUniqueStrings(context.experience_invariants, `${label}.experience_invariants`, {
      nonEmpty: true,
    });
    if (!context.ui_impact && context.visual_invariants.length > 0) {
      throw new Error(`${label} is nonvisual, so visual_invariants must be empty`);
    }
    if (!context.ui_impact && context.prototype !== null) {
      throw new Error(`${label} is nonvisual, so prototype must be null`);
    }
  }
  const prototype = context.prototype;
  if (prototype === null) return context;
  if (!isObject(prototype)) throw new TypeError(`${label}.prototype must be null or an object`);
  for (const field of Object.keys(prototype)) {
    if (!PROTOTYPE_FIELDS.has(field)) {
      throw new Error(`${label}.prototype has unknown field ${field}`);
    }
  }
  for (const field of ["path", "sha256"]) {
    if (!Object.hasOwn(prototype, field)) throw new Error(`${label}.prototype requires ${field}`);
  }
  if (!nonEmpty(prototype.path)) throw new TypeError(`${label}.prototype.path is required`);
  validateRepoRelativePattern(prototype.path, `${label}.prototype.path`);
  if (
    prototype.path !== normalizePattern(prototype.path) ||
    prototype.path.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(prototype.path) ||
    prototype.path.split("/").some((part) => part === "." || part === "") ||
    hasGlob(prototype.path)
  ) {
    throw new Error(`${label}.prototype.path must identify one normalized repo-relative file`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(prototype.sha256 || "")) {
    throw new Error(`${label}.prototype.sha256 must be a sha256:<64 lowercase hex> binding`);
  }
  const multiFile = path.posix.basename(prototype.path) === "index.html";
  if (prototype.manifest !== undefined) {
    if (!multiFile) {
      throw new Error(`${label}.prototype.manifest is only valid for a multi-file index.html`);
    }
    validatePrototypeManifest(prototype.manifest, `${label}.prototype.manifest`);
  } else if (multiFile && options.requireCurrentPrototypeIdentity) {
    throw new Error(
      `${label}.prototype is a legacy multi-file prototype that hashes only index.html; recertify it in Groom with a tree manifest`
    );
  }
  if (options.repoRoot) {
    verifyPrototypeBinding(prototype, `${label}.prototype`, options.repoRoot, options);
  }
  return context;
}

function validateUniqueStrings(value, label, { nonEmpty: requireValues = true } = {}) {
  if (!Array.isArray(value) || (requireValues && value.length === 0)) {
    throw new TypeError(`${label} must be ${requireValues ? "a non-empty" : "an"} array`);
  }
  if (value.some((item) => !nonEmpty(item))) {
    throw new TypeError(`${label} must contain non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

function buildPrototypeIdentity(prototypePath, repoRoot) {
  if (!nonEmpty(prototypePath)) throw new TypeError("prototype path is required");
  validateRepoRelativePattern(prototypePath, "prototype path");
  const normalized = normalizePattern(prototypePath);
  if (
    prototypePath !== normalized ||
    prototypePath.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(prototypePath) ||
    prototypePath.split("/").some((part) => part === "." || part === "") ||
    hasGlob(prototypePath)
  ) {
    throw new Error("prototype path must identify one normalized repo-relative file");
  }
  if (path.posix.extname(normalized).toLowerCase() !== ".html") {
    throw new Error("prototype entry must be an HTML file");
  }
  const root = resolvePrototypeRoot(repoRoot, "prototype");
  const bytes = readPrototypeFile(root, normalized, "prototype.path");
  const identity = {
    path: normalized,
    sha256: hashBytes(bytes),
  };
  if (path.posix.basename(normalized) === "index.html") {
    identity.manifest = buildPrototypeManifest(root, path.posix.dirname(normalized));
    const indexEntry = identity.manifest.files.find((entry) => entry.path === "index.html");
    if (!indexEntry || indexEntry.sha256 !== identity.sha256) {
      throw new Error("prototype manifest does not bind its index.html entry");
    }
  } else if (path.extname(normalized).toLowerCase() === ".html") {
    validateSelfContainedPrototype(bytes, "prototype.path");
  }
  return identity;
}

function validatePrototypeManifest(manifest, label) {
  if (!isObject(manifest)) throw new TypeError(`${label} must be an object`);
  for (const field of Object.keys(manifest)) {
    if (!PROTOTYPE_MANIFEST_FIELDS.has(field)) {
      throw new Error(`${label} has unknown field ${field}`);
    }
  }
  for (const field of PROTOTYPE_MANIFEST_FIELDS) {
    if (!Object.hasOwn(manifest, field)) throw new Error(`${label} requires ${field}`);
  }
  if (manifest.schema_version !== 1) throw new Error(`${label}.schema_version must equal 1`);
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length < 3 ||
    manifest.files.length > MAX_PROTOTYPE_FILES
  ) {
    throw new Error(`${label}.files must contain 3-${MAX_PROTOTYPE_FILES} bounded files`);
  }
  const observedPaths = [];
  for (const [index, entry] of manifest.files.entries()) {
    const at = `${label}.files[${index}]`;
    if (!isObject(entry)) throw new TypeError(`${at} must be an object`);
    for (const field of Object.keys(entry)) {
      if (!PROTOTYPE_MANIFEST_FILE_FIELDS.has(field)) {
        throw new Error(`${at} has unknown field ${field}`);
      }
    }
    for (const field of PROTOTYPE_MANIFEST_FILE_FIELDS) {
      if (!Object.hasOwn(entry, field)) throw new Error(`${at} requires ${field}`);
    }
    if (
      !nonEmpty(entry.path) ||
      path.posix.isAbsolute(entry.path) ||
      /^[a-z][a-z0-9+.-]*:/i.test(entry.path) ||
      entry.path.includes("\\") ||
      entry.path !== path.posix.normalize(entry.path) ||
      entry.path.split("/").some((part) => part === ".." || part === "." || part === "") ||
      hasGlob(entry.path)
    ) {
      throw new Error(`${at}.path must be a normalized path inside the prototype directory`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(entry.sha256 || "")) {
      throw new Error(`${at}.sha256 must be a sha256:<64 lowercase hex> binding`);
    }
    observedPaths.push(entry.path);
  }
  const sorted = [...observedPaths].sort(comparePaths);
  if (new Set(observedPaths).size !== observedPaths.length) {
    throw new Error(`${label}.files must not repeat paths`);
  }
  if (JSON.stringify(observedPaths) !== JSON.stringify(sorted)) {
    throw new Error(`${label}.files must be sorted by path`);
  }
  for (const required of ["base.css", "index.html", "meta.json"]) {
    if (!observedPaths.includes(required))
      throw new Error(`${label}.files must include ${required}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.tree_sha256 || "")) {
    throw new Error(`${label}.tree_sha256 must be a sha256:<64 lowercase hex> binding`);
  }
  const expectedTreeHash = prototypeTreeHash(manifest.files);
  if (manifest.tree_sha256 !== expectedTreeHash) {
    throw new Error(`${label}.tree_sha256 does not match its ordered file manifest`);
  }
}

function verifyPrototypeBinding(prototype, label, repoRoot, options = {}) {
  const root = resolvePrototypeRoot(repoRoot, label);
  const cacheKey = `${root}\u0000${JSON.stringify(prototype)}`;
  if (options.prototypeVerificationCache?.has(cacheKey)) return;
  const multiFile = path.posix.basename(prototype.path) === "index.html";
  if (multiFile && prototype.manifest) {
    const relativeRoot = path.posix.dirname(prototype.path);
    const rebuilt = buildPrototypeManifest(root, relativeRoot);
    if (JSON.stringify(rebuilt.files) !== JSON.stringify(prototype.manifest.files)) {
      const changed = firstManifestDifference(prototype.manifest.files, rebuilt.files);
      throw new Error(
        `${label}.manifest does not match repository bytes${changed ? ` at ${changed}` : ""}`
      );
    }
    if (rebuilt.tree_sha256 !== prototype.manifest.tree_sha256) {
      throw new Error(`${label}.manifest tree_sha256 does not match repository bytes`);
    }
    const indexEntry = prototype.manifest.files.find((entry) => entry.path === "index.html");
    if (!indexEntry || indexEntry.sha256 !== prototype.sha256) {
      throw new Error(`${label}.sha256 must equal the manifest hash for index.html`);
    }
    options.prototypeVerificationCache?.set(cacheKey, true);
    return;
  }
  const bytes = readPrototypeFile(root, prototype.path, `${label}.path`);
  const observed = hashBytes(bytes);
  if (observed !== prototype.sha256) {
    throw new Error(`${label}.sha256 does not match repository bytes at ${prototype.path}`);
  }
  if (multiFile) {
    if (options.requireCurrentPrototypeIdentity) {
      throw new Error(
        `${label} is a legacy multi-file prototype that hashes only index.html; recertify it in Groom with a tree manifest`
      );
    }
  } else if (
    options.requireCurrentPrototypeIdentity &&
    path.extname(prototype.path).toLowerCase() === ".html"
  ) {
    validateSelfContainedPrototype(bytes, `${label}.path`);
  }
  options.prototypeVerificationCache?.set(cacheKey, true);
}

function resolvePrototypeRoot(repoRoot, label) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(repoRoot));
  } catch (error) {
    throw new Error(`${label} repository root cannot be resolved: ${error.message}`);
  }
  return root;
}

function readPrototypeFile(root, relativePath, label) {
  return readBoundPrototypeFile(root, relativePath, label).bytes;
}

function readBoundPrototypeFile(root, relativePath, label) {
  try {
    return readProjectInput(root, relativePath, MAX_PROTOTYPE_BYTES, {
      requireStablePath: true,
    });
  } catch (error) {
    throw new Error(`${label} cannot be read as a repository file: ${error.message}`);
  }
}

function inspectBoundPrototypeFile(root, relativePath, label) {
  try {
    return inspectStableProjectInput(root, relativePath, MAX_PROTOTYPE_BYTES);
  } catch (error) {
    throw new Error(`${label} cannot be inspected as a repository file: ${error.message}`);
  }
}

function buildPrototypeManifest(repoRoot, relativeDirectory) {
  const directory = path.resolve(repoRoot, relativeDirectory);
  if (!isWithin(repoRoot, directory)) {
    throw new Error("prototype manifest directory must stay inside the repository root");
  }
  const before = collectPrototypeTree(directory);
  const files = [];
  const sourceBytes = new Map();
  const sourceIdentities = new Map();
  let totalBytes = 0;
  for (const relativePath of before) {
    const repoRelative = path.posix.join(relativeDirectory, relativePath);
    const loaded = readBoundPrototypeFile(
      repoRoot,
      repoRelative,
      `prototype manifest ${relativePath}`
    );
    const { bytes } = loaded;
    totalBytes += bytes.length;
    if (totalBytes > MAX_PROTOTYPE_TREE_BYTES) {
      throw new Error("prototype manifest exceeds the 32 MiB tree read limit");
    }
    sourceBytes.set(relativePath, bytes);
    sourceIdentities.set(relativePath, loaded.stablePathIdentity);
    files.push({ path: relativePath, sha256: hashBytes(bytes) });
  }
  const after = collectPrototypeTree(directory);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("prototype tree changed during bounded read");
  }
  const manifest = {
    schema_version: 1,
    files,
    tree_sha256: prototypeTreeHash(files),
  };
  validatePrototypeManifest(manifest, "prototype manifest");
  validateManifestMetadata(repoRoot, relativeDirectory, manifest);
  validateBundledPrototypeDependencies(sourceBytes, manifest);
  let verifiedBytes = 0;
  const verifiedIdentities = new Map();
  for (const [index, relativePath] of before.entries()) {
    const repoRelative = path.posix.join(relativeDirectory, relativePath);
    const loaded = readBoundPrototypeFile(
      repoRoot,
      repoRelative,
      `prototype manifest verification ${relativePath}`
    );
    verifiedBytes += loaded.bytes.length;
    const expected = sourceBytes.get(relativePath);
    if (
      verifiedBytes > MAX_PROTOTYPE_TREE_BYTES ||
      !expected?.equals(loaded.bytes) ||
      files[index].sha256 !== hashBytes(loaded.bytes) ||
      sourceIdentities.get(relativePath) !== loaded.stablePathIdentity
    ) {
      throw new Error(`prototype tree changed during bounded read at ${relativePath}`);
    }
    verifiedIdentities.set(relativePath, loaded.stablePathIdentity);
  }
  const verifiedTree = collectPrototypeTree(directory);
  if (JSON.stringify(before) !== JSON.stringify(verifiedTree)) {
    throw new Error("prototype tree changed during final verification");
  }
  // Re-sample every verified path after all content reads. Matching inode and
  // change-time identities establish one overlapping interval in which the
  // complete bounded tree matched the manifest, without a third content read.
  let inspectedBytes = 0;
  for (const relativePath of verifiedTree) {
    const repoRelative = path.posix.join(relativeDirectory, relativePath);
    const inspected = inspectBoundPrototypeFile(
      repoRoot,
      repoRelative,
      `prototype manifest final verification ${relativePath}`
    );
    inspectedBytes += inspected.size;
    if (
      inspectedBytes > MAX_PROTOTYPE_TREE_BYTES ||
      verifiedIdentities.get(relativePath) !== inspected.stablePathIdentity
    ) {
      throw new Error(`prototype tree changed during final verification at ${relativePath}`);
    }
  }
  const finalTree = collectPrototypeTree(directory);
  if (JSON.stringify(verifiedTree) !== JSON.stringify(finalTree)) {
    throw new Error("prototype tree changed during final verification");
  }
  return manifest;
}

function collectPrototypeTree(directory) {
  const files = [];
  let visitedEntries = 0;
  function visit(current, prefix, depth) {
    if (depth > MAX_PROTOTYPE_DEPTH) {
      throw new Error(`prototype manifest exceeds directory depth ${MAX_PROTOTYPE_DEPTH}`);
    }
    let entries;
    try {
      entries = [];
      const handle = fs.opendirSync(current);
      try {
        let entry;
        while ((entry = handle.readSync()) !== null) {
          visitedEntries += 1;
          if (visitedEntries > MAX_PROTOTYPE_ENTRIES) {
            throw new Error(
              `prototype manifest exceeds ${MAX_PROTOTYPE_ENTRIES} directory entries`
            );
          }
          entries.push(entry);
        }
      } finally {
        handle.closeSync();
      }
      entries.sort((left, right) => comparePaths(left.name, right.name));
    } catch (error) {
      throw new Error(`prototype manifest directory cannot be read: ${error.message}`);
    }
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`prototype manifest cannot contain symbolic link ${relativePath}`);
      }
      if (stat.isDirectory()) visit(absolute, relativePath, depth + 1);
      else if (stat.isFile()) files.push(relativePath);
      else throw new Error(`prototype manifest contains non-regular entry ${relativePath}`);
      if (files.length > MAX_PROTOTYPE_FILES) {
        throw new Error(`prototype manifest exceeds ${MAX_PROTOTYPE_FILES} files`);
      }
    }
  }
  visit(directory, "", 0);
  return files.sort(comparePaths);
}

function validateManifestMetadata(repoRoot, relativeDirectory, manifest) {
  let metadata;
  try {
    metadata = JSON.parse(
      readPrototypeFile(
        repoRoot,
        path.posix.join(relativeDirectory, "meta.json"),
        "prototype manifest meta.json"
      ).toString("utf8")
    );
  } catch (error) {
    throw new Error(`prototype manifest meta.json is invalid: ${error.message}`);
  }
  if (!isObject(metadata) || !Array.isArray(metadata.screens) || metadata.screens.length === 0) {
    throw new Error("prototype manifest meta.json requires a non-empty screens array");
  }
  const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
  for (const [index, screen] of metadata.screens.entries()) {
    const file = screen?.file;
    if (
      !nonEmpty(file) ||
      path.posix.isAbsolute(file) ||
      file.includes("\\") ||
      !file.endsWith(".html") ||
      file === "index.html" ||
      file !== path.posix.normalize(file) ||
      file.split("/").some((part) => part === ".." || part === "." || part === "")
    ) {
      throw new Error(`prototype manifest meta.json screens[${index}].file is invalid`);
    }
    if (!manifestPaths.has(file)) {
      throw new Error(`prototype manifest omits screen file ${file}`);
    }
  }
}

function validateSelfContainedPrototype(bytes, label) {
  const html = bytes.toString("utf8");
  if (html.includes("\uFFFD")) {
    throw new Error(`${label} single-file HTML must be valid UTF-8`);
  }
  const inspected = inspectPrototypeMarkup(html, {
    declarativeShadowRootMessage: `${label} single-file HTML contains an unsupported declarative shadow root (shadowrootmode)`,
    malformedMessage: (name) =>
      `${label} single-file HTML contains malformed${name ? ` <${name}>` : ""} attribute or markup syntax that cannot be inspected safely`,
  });
  const { tags } = inspected;
  for (const tag of tags) {
    if (prototypeAttributeValue(tag.attributes, ["xml:base"]) !== undefined) {
      throw new Error(`${label} single-file HTML contains unsupported xml:base URL rebasing`);
    }
    if (prototypeHasEventHandler(tag.attributes)) {
      throw new Error(
        `${label} single-file HTML contains an inline event handler; use static states or an index.html prototype tree`
      );
    }
    if (tag.name === "base") {
      throw new Error(
        `${label} single-file HTML contains a base URL; remove it or use an index.html prototype tree`
      );
    }
    if (["embed", "frame", "iframe", "object"].includes(tag.name)) {
      throw new Error(
        `${label} single-file HTML contains nested or plugin content; inline the state or use an index.html prototype tree`
      );
    }
    if (
      tag.name === "meta" &&
      hasUnsafeRefreshDirective(prototypeAttributeValue(tag.attributes, ["http-equiv"]))
    ) {
      throw new Error(
        `${label} single-file HTML contains a refresh/navigation directive; remove it or use an index.html prototype tree`
      );
    }
    if (tag.name === "script") {
      const source = prototypeAttributeValue(tag.attributes, ["src"]);
      const type = prototypeAttributeValue(tag.attributes, ["type"])?.trim().toLowerCase();
      if (source !== undefined || type !== "application/json") {
        throw new Error(
          `${label} single-file HTML contains an active or external script; keep only inline application/json metadata or use an index.html prototype tree`
        );
      }
    }
    if (PROTOTYPE_SVG_DECLARATIVE_MUTATION_ELEMENTS.has(tag.name)) {
      throw new Error(
        `${label} single-file HTML contains unsupported declarative SVG attribute mutation <${tag.name}>`
      );
    }
    for (const [attribute, syntax] of prototypeResourceAttributes(tag)) {
      const target = prototypeAttributeValue(tag.attributes, [attribute]);
      const context = prototypeResourceContext(tag.name, attribute);
      if (target === undefined) continue;
      if (syntax === RESOURCE_IMAGE_CANDIDATE_LIST)
        throw new Error(
          `${label} single-file HTML references ${tag.name}[${attribute}] resource ${JSON.stringify(target)}; inline it or use an index.html prototype tree`
        );
      for (const resourceTarget of prototypeResourceAttributeTargets(target, syntax))
        if (!inlineResourceTarget(resourceTarget, context)) {
          throw new Error(
            `${label} single-file HTML references ${tag.name}[${attribute}] resource ${JSON.stringify(resourceTarget)}; inline it or use an index.html prototype tree`
          );
        }
    }
    for (const { attribute, target } of prototypeSvgPresentationResourceTargets(tag)) {
      if (!inlineResourceTarget(target, "css[url]")) {
        throw new Error(
          `${label} single-file HTML references SVG presentation ${tag.name}[${attribute}] resource ${JSON.stringify(target)}; inline it or use an index.html prototype tree`
        );
      }
    }
  }
  const cssText = normalizeCssForDependencyInspection(
    [
      ...inspected.styleBodies,
      ...tags
        .map((tag) => prototypeAttributeValue(tag.attributes, ["style"]))
        .filter((value) => value !== undefined)
        .map(decodeHtmlAttributeReferences),
    ].join("\n")
  );
  for (const target of cssResourceTargets(cssText)) {
    if (!inlineResourceTarget(target, "css[url]")) {
      throw new Error(
        `${label} single-file HTML references CSS resource ${JSON.stringify(target)}; inline it or use an index.html prototype tree`
      );
    }
  }
  if (/@import\b/i.test(cssText)) {
    throw new Error(
      `${label} single-file HTML contains a CSS import; inline it or use an index.html prototype tree`
    );
  }
}

function validateBundledPrototypeDependencies(sourceBytes, manifest) {
  const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
  for (const [relativePath, bytes] of sourceBytes) {
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (extension === ".css") {
      validateBundledCssDependencies(bytes.toString("utf8"), relativePath, manifestPaths);
    } else if (extension === ".html" || extension === ".svg") {
      validateBundledMarkupDependencies(bytes, relativePath, manifestPaths);
    } else if ([".htm", ".xhtml"].includes(extension)) {
      throw new Error(
        `prototype manifest contains unsupported active markup format ${relativePath}; use .html`
      );
    }
  }
}

function validateBundledMarkupDependencies(bytes, relativePath, manifestPaths) {
  const markup = bytes.toString("utf8");
  if (markup.includes("\uFFFD")) {
    throw new Error(`prototype manifest ${relativePath} must be valid UTF-8`);
  }
  const xmlMode = path.posix.extname(relativePath).toLowerCase() === ".svg";
  const inspected = inspectPrototypeMarkup(markup, {
    declarativeShadowRootMessage: `prototype manifest ${relativePath} contains an unsupported declarative shadow root (shadowrootmode)`,
    xmlMode,
    malformedMessage: (name) =>
      `prototype manifest ${relativePath} contains malformed${name ? ` <${name}>` : ""} attribute or markup syntax that cannot be inspected safely`,
    xmlDoctypeMessage: `prototype manifest ${relativePath} contains an unsupported XML document type or entity declaration`,
    xmlStylesheetMessage: `prototype manifest ${relativePath} contains an unsupported XML stylesheet processing instruction`,
  });
  const { tags } = inspected;
  for (const tag of tags) {
    if (prototypeAttributeValue(tag.attributes, ["xml:base"]) !== undefined) {
      throw new Error(
        `prototype manifest ${relativePath} contains unsupported xml:base URL rebasing`
      );
    }
    if (prototypeHasEventHandler(tag.attributes)) {
      throw new Error(
        `prototype manifest ${relativePath} contains an inline event handler with uninspectable dependencies`
      );
    }
    if (prototypeAttributeValue(tag.attributes, ["srcdoc"]) !== undefined) {
      throw new Error(
        `prototype manifest ${relativePath} contains unsupported iframe srcdoc content`
      );
    }
    if (tag.name === "base") {
      throw new Error(`prototype manifest ${relativePath} cannot declare a base URL`);
    }
    if (
      tag.name === "meta" &&
      hasUnsafeRefreshDirective(prototypeAttributeValue(tag.attributes, ["http-equiv"]))
    ) {
      throw new Error(
        `prototype manifest ${relativePath} contains an unsupported refresh/navigation directive`
      );
    }
    if (tag.name === "script") {
      const source = prototypeAttributeValue(tag.attributes, ["src"]);
      const type = prototypeAttributeValue(tag.attributes, ["type"])?.trim().toLowerCase();
      if (source !== undefined || type !== "application/json") {
        throw new Error(
          `prototype manifest ${relativePath} contains unsupported active script content`
        );
      }
    }
    if (PROTOTYPE_SVG_DECLARATIVE_MUTATION_ELEMENTS.has(tag.name)) {
      throw new Error(
        `prototype manifest ${relativePath} contains unsupported declarative SVG attribute mutation <${tag.name}>`
      );
    }
    for (const [attribute, syntax] of prototypeResourceAttributes(tag)) {
      const target = prototypeAttributeValue(tag.attributes, [attribute]);
      if (target === undefined) continue;
      if (syntax === RESOURCE_IMAGE_CANDIDATE_LIST) {
        throw new Error(
          `prototype manifest ${relativePath} contains unsupported active ${attribute} syntax`
        );
      }
      for (const resourceTarget of prototypeResourceAttributeTargets(target, syntax))
        validateBundledResourceTarget(
          resourceTarget,
          relativePath,
          manifestPaths,
          prototypeResourceContext(tag.name, attribute)
        );
    }
    for (const { target } of prototypeSvgPresentationResourceTargets(tag)) {
      validateBundledResourceTarget(target, relativePath, manifestPaths, "css[url]");
    }
  }
  const cssText = [
    ...inspected.styleBodies,
    ...tags
      .map((tag) => prototypeAttributeValue(tag.attributes, ["style"]))
      .filter((value) => value !== undefined)
      .map(decodeHtmlAttributeReferences),
  ].join("\n");
  validateBundledCssDependencies(cssText, relativePath, manifestPaths);
}

function validateBundledCssDependencies(css, relativePath, manifestPaths) {
  const normalized = normalizeCssForDependencyInspection(css);
  if (/@import\b\s*(?:url\(\s*)?["']?\s*data:/i.test(normalized))
    throw new Error(`unsupported data resource in ${relativePath}`);
  for (const target of cssResourceTargets(normalized)) {
    validateBundledResourceTarget(target, relativePath, manifestPaths, "css[url]");
  }
}

function validateBundledResourceTarget(value, sourcePath, manifestPaths, context) {
  const target = String(value).trim();
  if (/(?:&(?:#|[a-z])|[\t\r\n])/i.test(target))
    throw new Error(
      `prototype manifest ${sourcePath} contains unsupported resource encoding ${JSON.stringify(target)}`
    );
  if (target === "" || target.startsWith("#") || target.startsWith("?")) return;
  if (/^data:/i.test(target)) {
    if (inertDataResourceTarget(target, context)) return;
    throw new Error(`prototype manifest ${sourcePath} contains unsupported data resource`);
  }
  let pathname = target.split(/[?#]/, 1)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    throw new Error(
      `prototype manifest ${sourcePath} contains an invalid resource reference ${JSON.stringify(target)}`
    );
  }
  if (
    path.posix.isAbsolute(pathname) ||
    pathname.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(pathname)
  ) {
    throw new Error(
      `prototype manifest ${sourcePath} references remote or absolute resource ${JSON.stringify(target)}`
    );
  }
  if (
    pathname.includes("\\") ||
    pathname.includes("\u0000") ||
    pathname !== path.posix.normalize(pathname)
  ) {
    throw new Error(
      `prototype manifest ${sourcePath} resource reference must be normalized: ${JSON.stringify(target)}`
    );
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), pathname));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error(
      `prototype manifest ${sourcePath} resource reference stays outside the prototype directory: ${JSON.stringify(target)}`
    );
  }
  if (!manifestPaths.has(resolved)) {
    throw new Error(
      `prototype manifest ${sourcePath} resource ${JSON.stringify(target)} is not covered by the prototype manifest`
    );
  }
}

function cssResourceTargets(css) {
  const normalized = normalizeCssForDependencyInspection(css);
  const targets = [];
  for (const match of normalized.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) {
    targets.push(
      match[1]
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim()
    );
  }
  for (const match of normalized.matchAll(/@import\b\s*(["'])(.*?)\1/gi)) {
    targets.push(match[2].trim());
  }
  for (const match of normalized.matchAll(
    /(?:^|[^a-z-])(?:-webkit-)?(?:image-set|image|cross-fade)\s*\(([^{};]*)\)/gi
  )) {
    for (const quoted of match[1].matchAll(/(["'])(.*?)\1/g)) {
      targets.push(quoted[2].trim());
    }
  }
  return targets;
}

function normalizeCssForDependencyInspection(value) {
  const source = String(value).replace(/\\(?:\r\n|[\n\r\f])/g, "");
  let output = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      output += character;
      if (character === "\\" && index + 1 < source.length) {
        output += source[++index];
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    output += character;
  }
  return output
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/\\([^\r\n0-9a-f])/gi, "$1");
}

function inspectPrototypeMarkup(markup, options = {}) {
  const source = String(markup);
  const lower = source.toLowerCase();
  const tags = [];
  const styleBodies = [];
  const xmlMode = options.xmlMode === true;
  let templateDepth = 0;
  let foreignContentSeen = false;
  let index = 0;

  function malformed(name = "") {
    throw new Error(
      options.malformedMessage?.(name) ||
        `prototype contains malformed${name ? ` <${name}>` : ""} markup`
    );
  }

  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) malformed();
      const body = source.slice(index + 4, end);
      // Restrict comments to the common syntax whose extent is identical in HTML and XML.
      // HTML abruptly closes several malformed forms (for example `<!-->` and `--!>`), so
      // treating everything up to the next `-->` as inert would hide live markup.
      if (
        body.startsWith(">") ||
        body.startsWith("->") ||
        body.includes("<!--") ||
        body.includes("--") ||
        body.endsWith("<!-")
      ) {
        malformed();
      }
      index = end + 3;
      continue;
    }

    if (xmlMode && source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index + 9);
      if (end === -1) malformed();
      index = end + 3;
      continue;
    }

    if (xmlMode && source.startsWith("<!", index)) {
      throw new Error(
        options.xmlDoctypeMessage ||
          "prototype contains an unsupported XML document type or entity declaration"
      );
    }

    if (xmlMode && source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end === -1) malformed();
      const target = source
        .slice(index + 2, end)
        .trimStart()
        .split(/[\t\n\f\r ]/, 1)[0];
      if (/^xml-stylesheet$/i.test(target)) {
        throw new Error(
          options.xmlStylesheetMessage ||
            "prototype contains an unsupported XML stylesheet processing instruction"
        );
      }
      index = end + 2;
      continue;
    }

    if (source.startsWith("</", index) && /[A-Za-z]/.test(source[index + 2] || "")) {
      const endTag = readInspectablePrototypeEndTag(source, index);
      if (endTag === null) malformed();
      if (endTag.name === "template" && templateDepth > 0) templateDepth -= 1;
      index = endTag.end;
      continue;
    }

    if (source[index] !== "<" || !/[A-Za-z]/.test(source[index + 1] || "")) {
      index += 1;
      continue;
    }

    const tag = readInspectablePrototypeStartTag(source, index, xmlMode);
    if (tag === null) malformed();
    if (xmlMode && tag.name.includes(":")) {
      throw new Error("prototype contains unsupported namespace-prefixed XML elements");
    }
    if (!xmlMode && ["svg", "math"].includes(tag.name)) foreignContentSeen = true;
    // This intentionally conservative tokenizer does not emulate HTML namespace
    // integration points or error recovery. Once foreign content is encountered,
    // do not assume a template-named element or its descendants are inert.
    if (!xmlMode && tag.name === "template" && foreignContentSeen) {
      throw new Error(
        "prototype contains unsupported template after SVG or MathML foreign content"
      );
    }
    if (tag.attributes.has("shadowrootmode")) {
      throw new Error(
        options.declarativeShadowRootMessage ||
          "prototype contains an unsupported declarative shadow root (shadowrootmode)"
      );
    }
    const inert = templateDepth > 0;
    if (!inert) tags.push(tag);
    index = tag.end;

    if (!xmlMode && tag.name === "template" && !tag.selfClosing) {
      templateDepth += 1;
      continue;
    }

    const rawText = prototypeRawTextKind(tag.name, xmlMode);
    // HTML ignores a self-closing flag on non-void raw-text elements. In XML the solidus
    // actually closes the element, so only XML mode may skip its body here.
    if (rawText === null || (tag.selfClosing && xmlMode)) continue;
    const raw = readInspectablePrototypeRawText(source, lower, tag.name, tag.end);
    if (raw.malformed) malformed(tag.name);
    if (!inert && rawText === "style") styleBodies.push(raw.body);
    index = raw.end;
  }

  return { tags, styleBodies };
}

function readInspectablePrototypeStartTag(source, start, xmlMode) {
  let index = start + 1;
  const nameStart = index;
  while (
    index < source.length &&
    !prototypeAttributeWhitespace(source[index]) &&
    source[index] !== "/" &&
    source[index] !== ">"
  ) {
    index += 1;
  }
  const rawTagName = source.slice(nameStart, index);
  if (!/^[A-Za-z][A-Za-z0-9:._-]*$/.test(rawTagName)) return null;
  const name = rawTagName.toLowerCase();
  const attributes = new Map();

  while (index < source.length) {
    const boundaryStart = index;
    while (prototypeAttributeWhitespace(source[index])) index += 1;
    if (source[index] === ">") {
      return {
        name,
        attributes,
        source: source.slice(start, index + 1),
        start,
        end: index + 1,
        selfClosing: false,
        xmlMode,
      };
    }
    if (source[index] === "/") {
      // In an unquoted value `/` was consumed as part of that value above. At an attribute
      // boundary it is self-closing syntax only when immediately followed by `>`; HTML recovers
      // `/ >` as a parse error and must not be normalized into a different tag.
      if (source[index + 1] !== ">") return null;
      return {
        name,
        attributes,
        source: source.slice(start, index + 2),
        start,
        end: index + 2,
        selfClosing: true,
        xmlMode,
      };
    }
    if (index >= source.length || index === boundaryStart) return null;

    const attributeNameStart = index;
    while (
      index < source.length &&
      !prototypeAttributeWhitespace(source[index]) &&
      source[index] !== "/" &&
      source[index] !== "=" &&
      source[index] !== ">"
    ) {
      index += 1;
    }
    const rawName = source.slice(attributeNameStart, index);
    if (rawName === "" || rawName.includes("\u0000") || /["'<`]/.test(rawName)) return null;

    let equalsIndex = index;
    while (prototypeAttributeWhitespace(source[equalsIndex])) equalsIndex += 1;
    let value = "";
    if (source[equalsIndex] === "=") {
      index = equalsIndex + 1;
      while (prototypeAttributeWhitespace(source[index])) index += 1;
      if (source[index] === '"' || source[index] === "'") {
        const quote = source[index];
        const valueStart = ++index;
        while (index < source.length && source[index] !== quote) index += 1;
        if (index === source.length) return null;
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        if (xmlMode || index >= source.length || source[index] === ">") return null;
        const valueStart = index;
        // A terminal solidus is part of an unquoted value in HTML. Only ASCII whitespace and
        // `>` end that value, matching the browser tokenizer.
        while (
          index < source.length &&
          !prototypeAttributeWhitespace(source[index]) &&
          source[index] !== ">"
        ) {
          index += 1;
        }
        value = source.slice(valueStart, index);
        if (value.includes("\u0000") || /["'<=`]/.test(value)) return null;
      }
    }

    const normalizedName = rawName.toLowerCase();
    if (!attributes.has(normalizedName)) attributes.set(normalizedName, value);
  }

  return null;
}

function readInspectablePrototypeEndTag(source, start) {
  let index = start + 2;
  const nameStart = index;
  while (
    index < source.length &&
    !prototypeAttributeWhitespace(source[index]) &&
    source[index] !== "/" &&
    source[index] !== ">"
  ) {
    index += 1;
  }
  const rawName = source.slice(nameStart, index);
  if (!/^[A-Za-z][A-Za-z0-9:._-]*$/.test(rawName)) return null;
  while (prototypeAttributeWhitespace(source[index])) index += 1;
  // End-tag attributes and self-closing flags are parse errors that browsers recover from.
  // Reject them so a recovered close cannot expose following active markup to the browser only.
  if (source[index] !== ">") return null;
  return { name: rawName.toLowerCase(), end: index + 1 };
}

function readInspectablePrototypeRawText(source, lower, name, bodyStart) {
  const needle = `</${name}`;
  let closeStart = lower.indexOf(needle, bodyStart);
  while (closeStart !== -1) {
    const delimiter = source[closeStart + needle.length];
    if (delimiter === ">" || delimiter === "/" || prototypeAttributeWhitespace(delimiter)) {
      const endTag = readInspectablePrototypeEndTag(source, closeStart);
      if (endTag === null || endTag.name !== name) {
        return { malformed: true, body: "", end: source.length };
      }
      return {
        malformed: false,
        body: source.slice(bodyStart, closeStart),
        end: endTag.end,
      };
    }
    closeStart = lower.indexOf(needle, closeStart + needle.length);
  }
  // EOF closes HTML raw-text elements. Style bytes before EOF remain active CSS and must still
  // participate in dependency inspection.
  return { malformed: false, body: source.slice(bodyStart), end: source.length };
}

function prototypeRawTextKind(name, xmlMode) {
  if (name === "style") return "style";
  if (name === "script") return "script";
  if (xmlMode) return null;
  if (["iframe", "noembed", "noframes", "textarea", "title", "xmp"].includes(name)) {
    return "inert";
  }
  if (name === "plaintext") return "inert";
  return null;
}

function prototypeAttributeWhitespace(value) {
  return value === " " || value === "\t" || value === "\n" || value === "\f" || value === "\r";
}

function prototypeAttributeValue(attributes, names) {
  for (const name of names) {
    const normalized = String(name).toLowerCase();
    if (attributes.has(normalized)) return attributes.get(normalized);
  }
  return undefined;
}

function prototypeHasEventHandler(attributes) {
  return [...attributes.keys()].some((name) => /^on[a-z][a-z0-9:._-]*$/i.test(name));
}

function decodeHtmlAttributeReferences(value) {
  return String(value ?? "")
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_entity, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return "\uFFFD";
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(
      /&(amp|apos|ast|bsol|colon|comma|commat|dollar|equals|excl|grave|gt|hat|lbrace|lbrack|lcub|lowbar|lpar|lsqb|lt|midast|newline|num|percnt|period|plus|quest|quot|rbrace|rbrack|rcub|rpar|rsqb|semi|sol|tab|verbar|verticalline)(?:;|(?![a-z0-9=]))/gi,
      (_entity, name) => HTML_ATTRIBUTE_ASCII_REFERENCES[name.toLowerCase()]
    );
}

function prototypeResourceAttributeTargets(value, syntax) {
  if (syntax === RESOURCE_URL) return [value];
  if (syntax === RESOURCE_SPACE_SEPARATED_URL_LIST) {
    const decoded = decodeHtmlAttributeReferences(value).trim();
    return decoded === "" ? [] : decoded.split(/[\t\n\f\r ]+/);
  }
  throw new Error(`unsupported prototype resource attribute syntax: ${syntax}`);
}

function prototypeResourceAttributes(tag) {
  const configured = PROTOTYPE_RESOURCE_ATTRIBUTES.get(tag.name) || {};
  const entries = Object.entries(configured);
  const seen = new Set(entries.map(([name]) => name));
  for (const name of tag.attributes.keys()) {
    const genericHref = name === "href" || name === "xlink:href";
    const namespacedHref = tag.xmlMode && /:href$/i.test(name);
    if ((genericHref || namespacedHref) && !seen.has(name)) {
      entries.push([name, RESOURCE_URL]);
      seen.add(name);
    }
  }
  return entries;
}

function prototypeSvgPresentationResourceTargets(tag) {
  const targets = [];
  for (const attribute of PROTOTYPE_SVG_PRESENTATION_RESOURCE_ATTRIBUTES) {
    const value = prototypeAttributeValue(tag.attributes, [attribute]);
    if (value === undefined) continue;
    for (const target of cssResourceTargets(decodeHtmlAttributeReferences(value))) {
      targets.push({ attribute, target });
    }
  }
  return targets;
}

function hasUnsafeRefreshDirective(value) {
  const token = decodeHtmlAttributeReferences(value).trim();
  return /^refresh$/i.test(token);
}

function prototypeResourceContext(tagName, attribute) {
  return `${tagName}[${attribute === "xlink:href" ? "href" : attribute}]`;
}

function inlineResourceTarget(value, context) {
  const target = String(value).trim();
  if (target === "" || target.startsWith("#")) return true;
  return /^data:/i.test(target) && inertDataResourceTarget(target, context);
}

function inertDataResourceTarget(value, context) {
  const mime = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(String(value).trim())?.[1].toLowerCase();
  const audio = /^audio\/(?:aac|flac|mp4|mpeg|ogg|wav|webm|x-wav)$/.test(mime || "");
  const video = /^video\/(?:mp4|ogg|webm)$/.test(mime || "");
  const raster = /^image\/(?:avif|bmp|gif|jpeg|png|webp|x-icon)$/.test(mime || "");
  const imageContext =
    /^(?:css\[url\]|img\[(?:src|lowsrc)\]|input\[src\]|video\[poster\]|(?:image|feimage)\[href\]|(?:body|table|thead|tbody|tfoot|tr|td|th)\[background\])$/.test(
      context
    );
  if (imageContext && raster) return true;
  if (context === "css[url]") return /^font\/(?:otf|sfnt|ttf|woff2?)$/.test(mime || "");
  if (context === "source[src]") return audio || video;
  if (context === "audio[src]") return audio;
  if (context === "video[src]") return video;
  return context === "track[src]" && mime === "text/vtt";
}

function prototypeTreeHash(files) {
  return hashBytes(
    Buffer.from(
      JSON.stringify({
        schema_version: 1,
        files: files.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
      })
    )
  );
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function firstManifestDifference(expected, observed) {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry.sha256]));
  const observedByPath = new Map(observed.map((entry) => [entry.path, entry.sha256]));
  const paths = [...new Set([...expectedByPath.keys(), ...observedByPath.keys()])].sort(
    comparePaths
  );
  return paths.find((entry) => expectedByPath.get(entry) !== observedByPath.get(entry)) || null;
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function analyzeWorkUnits(units) {
  validateWorkUnits(units);
  const completed = new Set(
    units.filter((item) => item.status === "completed").map((item) => item.id)
  );
  const running = units.filter((item) => item.status === "running");
  const ready = units.filter(
    (item) =>
      item.status === "pending" && item.depends_on.every((dependency) => completed.has(dependency))
  );
  const waiting = units.filter(
    (item) => item.status === "pending" && !ready.some((readyItem) => readyItem.id === item.id)
  );
  const blocked = units.filter((item) => item.status === "blocked" || item.status === "failed");
  const runnable = [];
  const serialized = [];

  for (const item of ready) {
    const conflicts = [...running, ...runnable]
      .filter((active) => ownershipOverlaps(item.owns, active.owns))
      .map((active) => active.id);
    if (conflicts.length > 0) {
      serialized.push({ id: item.id, conflicts_with: conflicts, reason: "ownership overlap" });
    } else {
      runnable.push(item);
    }
  }

  return { ready, runnable, serialized, waiting, running, blocked };
}

function ownershipOverlaps(left, right) {
  validateOwnershipList(left, "left ownership");
  validateOwnershipList(right, "right ownership");
  return left.some((leftPattern) =>
    right.some((rightPattern) => patternsOverlap(leftPattern, rightPattern))
  );
}

function patternsOverlap(leftValue, rightValue) {
  const left = normalizePattern(leftValue);
  const right = normalizePattern(rightValue);
  if (left === right) return true;

  const leftGlob = hasGlob(left);
  const rightGlob = hasGlob(right);
  if (leftGlob && !rightGlob && globMatches(left, right)) return true;
  if (rightGlob && !leftGlob && globMatches(right, left)) return true;
  if (!leftGlob && !rightGlob) return rootsIntersect(left, right);

  const leftRoot = literalRoot(left);
  const rightRoot = literalRoot(right);
  return rootsIntersect(leftRoot, rightRoot);
}

function narrowAuthority(parent, requested = {}) {
  if (!isObject(parent)) throw new TypeError("parent authority must be an object");
  if (!isObject(requested)) throw new TypeError("requested authority must be an object");
  const parentKeys = Object.keys(parent);

  for (const [action, value] of Object.entries(parent)) {
    if (typeof value !== "boolean")
      throw new TypeError(`parent authority ${action} must be boolean`);
  }
  for (const [action, value] of Object.entries(requested)) {
    if (!Object.prototype.hasOwnProperty.call(parent, action)) {
      throw new Error(`unknown authority action: ${action}`);
    }
    if (typeof value !== "boolean") {
      throw new TypeError(`requested authority ${action} must be boolean`);
    }
    if (value && !parent[action]) throw new Error(`cannot expand authority: ${action}`);
  }

  return Object.fromEntries(parentKeys.map((action) => [action, requested[action] === true]));
}

function validateWorkUnitResult(input, options = {}) {
  const result = parseResult(input);
  for (const field of Object.keys(result)) {
    if (!RESULT_FIELDS.has(field)) throw new Error(`unknown worker result field: ${field}`);
  }
  for (const field of [...RESULT_FIELDS].filter((name) => name !== "reason")) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`worker result requires ${field}`);
    }
  }
  if (result.schema_version !== 1) throw new Error("worker result schema_version must equal 1");
  if (!nonEmpty(result.work_unit_id)) throw new Error("worker result requires work_unit_id");
  if (
    options.expectedWorkUnitId !== undefined &&
    result.work_unit_id !== options.expectedWorkUnitId
  ) {
    throw new Error(
      `work unit id mismatch: expected ${options.expectedWorkUnitId}, received ${result.work_unit_id}`
    );
  }
  if (!RESULT_STATUSES.has(result.status)) {
    throw new Error(`worker result has invalid status: ${String(result.status)}`);
  }
  if (!nonEmpty(result.summary)) throw new Error("worker result requires summary");
  if (result.commit !== null && !nonEmpty(result.commit)) {
    throw new Error("worker result commit must be null or a non-empty string");
  }
  if (!Number.isInteger(result.files_changed) || result.files_changed < 0) {
    throw new Error("worker result files_changed must be a non-negative integer");
  }
  if (!Array.isArray(result.evidence)) throw new Error("worker result evidence must be an array");
  if (result.status === "completed" && result.evidence.length === 0) {
    throw new Error("completed result requires evidence");
  }
  if (result.status === "completed" && !nonEmpty(result.commit)) {
    throw new Error("completed result requires commit");
  }
  for (const evidence of result.evidence) {
    if (!isObject(evidence) || !nonEmpty(evidence.kind)) {
      throw new Error("worker result evidence entries require kind");
    }
  }
  if (
    result.status === "completed" &&
    !result.evidence.some((entry) => Number.isInteger(entry.exit_code) && entry.exit_code === 0)
  ) {
    throw new Error("completed result requires passing evidence");
  }
  if (result.status === "completed" && result.blocker !== null) {
    throw new Error("completed result blocker must be null");
  }
  if (["blocked", "failed"].includes(result.status)) {
    if (!nonEmpty(result.reason)) throw new Error(`${result.status} result requires reason`);
    if (!isObject(result.blocker) || !nonEmpty(result.blocker.reason)) {
      throw new Error(`${result.status} result requires blocker.reason`);
    }
    if (result.reason.trim() !== result.blocker.reason.trim()) {
      throw new Error(`${result.status} result reason must match blocker.reason`);
    }
  }
  if (!isObject(result.runtime) || !nonEmpty(result.runtime.provider)) {
    throw new Error("worker result runtime.provider is required");
  }
  if (result.status === "completed" && options.worktree) {
    validateCompletedCommit(result, options);
  }
  return result;
}

function validateCompletedCommit(result, options) {
  const worktree = options.worktree;
  const ownership = options.expectedOwnership;
  validateOwnershipList(ownership, "expected ownership");

  let head;
  let changedPaths;
  try {
    head = runGit(worktree, ["rev-parse", "HEAD"]);
    const dirty = runGit(worktree, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).pm/**",
    ]);
    if (dirty) throw new Error(`assigned worktree is dirty: ${dirty.split("\n")[0]}`);
    if (options.baseCommit) {
      runGit(worktree, ["merge-base", "--is-ancestor", options.baseCommit, result.commit]);
    }
    const diffArgs = options.baseCommit
      ? ["diff", "--name-only", `${options.baseCommit}..${result.commit}`]
      : ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", result.commit];
    changedPaths = runGit(worktree, diffArgs).split("\n").filter(Boolean);
  } catch (error) {
    throw new Error(`could not verify worker commit in assigned worktree: ${error.message}`);
  }

  if (result.commit !== head) {
    throw new Error(`worker commit is stale or outside assigned worktree HEAD: expected ${head}`);
  }
  const escaped = changedPaths.filter(
    (file) => !ownership.some((pattern) => pathIsOwned(file, pattern))
  );
  if (escaped.length > 0) {
    throw new Error(
      `worker commit changed paths outside assigned ownership: ${escaped.join(", ")}`
    );
  }
  if (result.files_changed !== changedPaths.length) {
    throw new Error(
      `worker result files_changed mismatch: reported ${result.files_changed}, observed ${changedPaths.length}`
    );
  }
}

function pathIsOwned(fileValue, patternValue) {
  const file = normalizePattern(fileValue);
  const pattern = normalizePattern(patternValue);
  if (hasGlob(pattern)) return globMatches(pattern, file);
  return file === pattern || file.startsWith(`${pattern}/`);
}

function runGit(worktree, args) {
  return sharedRunGit(args, worktree);
}

function detectCycle(units, byId) {
  const visited = new Set();
  const visiting = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) throw new Error(`dependency cycle: ${[...trail, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const item of units) visit(item.id, []);
}

function validateOwnershipList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  if (value.some((item) => !nonEmpty(item))) throw new TypeError(`${label} contains an empty path`);
  for (const item of value) validateRepoRelativePattern(item, label);
}

function validateRepoRelativePattern(value, label) {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a repo-relative path pattern`);
  }
}

function normalizePattern(value) {
  return value
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function hasGlob(value) {
  return /[*?[\]{}]/.test(value);
}

function literalRoot(value) {
  const wildcard = value.search(/[*?[\]{}]/);
  const literal = wildcard === -1 ? value : value.slice(0, wildcard);
  return literal.replace(/\/$/, "");
}

function rootsIntersect(left, right) {
  if (!left || !right) return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function globMatches(pattern, value) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  expression += "$";
  return new RegExp(expression).test(value);
}

function parseResult(input) {
  if (isObject(input)) return input;
  if (!nonEmpty(input)) throw new Error("missing worker result");
  try {
    const parsed = JSON.parse(input);
    if (!isObject(parsed)) throw new Error("must be an object");
    return parsed;
  } catch (error) {
    throw new Error(`malformed worker result: ${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  analyzeWorkUnits,
  buildPrototypeIdentity,
  narrowAuthority,
  ownershipOverlaps,
  validateOwnershipList,
  validateDesignContext,
  validateRepoRelativePattern,
  validateWorkUnitResult,
  validateWorkUnits,
};
