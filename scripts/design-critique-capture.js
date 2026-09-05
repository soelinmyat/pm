#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { normalizeRawAudit } = require("./design-critique-audit-normalize");
const { PRODUCT_UI_VISUAL_THRESHOLDS, inspectPngVisualBytes } = require("./lib/media-inspect");
const { readProjectInput } = require("./lib/project-file");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const CAPTURE_PROBE = path.join(__dirname, "design-critique-capture-probe.js");
const MAX_ROUTE_BYTES = 1024 * 1024;
const MAX_RAW_AUDIT_BYTES = 1024 * 1024;
const MAX_NETWORK_BYTES = 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_ASSERTION_BYTES = 64 * 1024;
const {
  minVisiblePixelRatio: MIN_VISIBLE_PIXEL_RATIO,
  minMeaningfulPixelRatio: MIN_MEANINGFUL_PIXEL_RATIO,
  minMeaningfulTileRatio: MIN_MEANINGFUL_TILE_RATIO,
  minLuminanceRange: MIN_LUMINANCE_RANGE,
} = PRODUCT_UI_VISUAL_THRESHOLDS;
const CAPTURE_ASSURANCE = "workflow-attested-non-cryptographic";
const BROWSER_ARGS_PROFILE = "pm-product-ui-capture-v2";
const ACQUISITION_METHOD = "native-cdp-dom-ax-plus-two-pixel-stability-samples-and-network-barrier";
const STATES = new Set([
  "primary",
  "empty",
  "error",
  "boundary",
  "loading",
  "success",
  "focus",
  "disabled",
  "keyboard",
  "modal",
  "responsive",
  "print",
]);
const VIEWPORT_BOUNDS = Object.freeze({
  desktop: { minWidth: 1024, maxWidth: null, minHeight: 600 },
  tablet: { minWidth: 601, maxWidth: 1023, minHeight: 600 },
  narrow: { minWidth: 320, maxWidth: 600, minHeight: 480 },
});

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  const missing = fields.find((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (unknown) throw new Error(`${label}.${unknown} is an unknown field`);
  if (missing) throw new Error(`${label}.${missing} is required`);
}

function slug(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error(`${label} must be kebab-case`);
}

function sha(value, label) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
    throw new Error(`${label} must be a SHA-1 or SHA-256 object ID`);
}

function sha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be lowercase SHA-256`);
}

function boundedText(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} must contain 1 through ${max} characters`);
}

function validateRelative(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    value.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`${label} must be project-relative without traversal`);
  return value.split(/[\\/]+/).join("/");
}

function validateRoute(route) {
  exactObject(
    route,
    ["schema_version", "run_id", "created_at", "mode", "source", "subjects", "coverage"],
    "route"
  );
  if (route.schema_version !== 2)
    throw new Error("trusted capture requires route schema_version 2");
  boundedText(route.run_id, 200, "route.run_id");
  if (Number.isNaN(Date.parse(route.created_at)))
    throw new Error("route.created_at must be RFC 3339");
  if (route.mode !== "product-ui") throw new Error("trusted capture requires product-ui mode");
  exactObject(
    route.source,
    ["commit", "base_ref", "base_commit", "remote_push_url_sha256", "diff_sha256"].filter(
      (field) => field !== "remote_push_url_sha256" || field in route.source
    ),
    "route.source"
  );
  sha(route.source.commit, "route.source.commit");
  boundedText(route.source.base_ref, 500, "route.source.base_ref");
  sha(route.source.base_commit, "route.source.base_commit");
  sha256(route.source.diff_sha256, "route.source.diff_sha256");
  if (route.source.remote_push_url_sha256 !== undefined)
    sha256(route.source.remote_push_url_sha256, "route.source.remote_push_url_sha256");
  if (!Array.isArray(route.subjects) || route.subjects.length < 1 || route.subjects.length > 100)
    throw new Error("route.subjects must contain 1 through 100 subjects");
  const subjectIds = new Set();
  for (const [index, subject] of route.subjects.entries()) {
    exactObject(subject, ["id", "title", "surface", "platform"], `route.subjects[${index}]`);
    slug(subject.id, `route.subjects[${index}].id`);
    if (subjectIds.has(subject.id)) throw new Error("route subject IDs must be unique");
    subjectIds.add(subject.id);
    boundedText(subject.title, 1000, `route.subjects[${index}].title`);
    boundedText(subject.surface, 2000, `route.subjects[${index}].surface`);
    if (!new Set(["web", "mobile"]).has(subject.platform))
      throw new Error(`route.subjects[${index}].platform must be web or mobile`);
    if (subject.platform === "web") validateSurfacePattern(subject.surface);
  }
  if (!Array.isArray(route.coverage) || route.coverage.length < 1 || route.coverage.length > 1000)
    throw new Error("route.coverage must contain 1 through 1000 rows");
  const coverageIds = new Set();
  for (const [index, coverage] of route.coverage.entries()) {
    exactObject(
      coverage,
      ["id", "subject_id", "state", "viewport", "required", "reason"],
      `route.coverage[${index}]`
    );
    slug(coverage.id, `route.coverage[${index}].id`);
    if (coverageIds.has(coverage.id)) throw new Error("route coverage IDs must be unique");
    coverageIds.add(coverage.id);
    if (!subjectIds.has(coverage.subject_id))
      throw new Error(`route.coverage[${index}].subject_id must reference a subject`);
    if (!STATES.has(coverage.state)) throw new Error(`route.coverage[${index}].state is invalid`);
    if (!new Set(["desktop", "tablet", "narrow", "device", "print"]).has(coverage.viewport))
      throw new Error(`route.coverage[${index}].viewport is invalid`);
    if (typeof coverage.required !== "boolean")
      throw new Error(`route.coverage[${index}].required must be boolean`);
    boundedText(coverage.reason, 2000, `route.coverage[${index}].reason`);
  }
  return route;
}

function canonicalUrl(raw, label) {
  boundedText(raw, 4096, label);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error(`${label} must use http or https`);
  if (parsed.username || parsed.password) throw new Error(`${label} cannot contain credentials`);
  return parsed.href;
}

function redactedUrlIdentity(raw, label) {
  const canonical = canonicalUrl(raw, label);
  const parsed = new URL(canonical);
  return {
    canonical,
    public: {
      origin: parsed.origin,
      pathname: parsed.pathname,
      has_query: parsed.search.length > 0,
      has_fragment: parsed.hash.length > 0,
      full_url_sha256: digest(Buffer.from(canonical)),
    },
  };
}

function validateSurfacePattern(surface) {
  boundedText(surface, 2000, "subject surface");
  if (surface === "/") return surface;
  if (
    !surface.startsWith("/") ||
    surface.endsWith("/") ||
    surface.includes("?") ||
    surface.includes("#") ||
    surface.includes("\\") ||
    surface.includes("//")
  )
    throw new Error("web subject surface must be an origin-free absolute path pattern");
  for (const segment of surface.slice(1).split("/")) {
    if (/^:[a-z][a-z0-9_-]{0,63}$/.test(segment)) continue;
    if (segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/.test(segment))
      throw new Error("web subject surface segments must be safe literals or :named parameters");
  }
  return surface;
}

function urlMatchesSurface(rawUrl, surface) {
  const canonical = canonicalUrl(rawUrl, "capture URL");
  validateSurfacePattern(surface);
  let pathnameSegments;
  try {
    pathnameSegments = new URL(canonical).pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("capture URL path must use valid percent encoding");
  }
  const pathname = pathnameSegments.join("/");
  if (
    pathname !== "/" &&
    pathnameSegments.some(
      (segment, index) =>
        index > 0 &&
        (segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\") ||
          !/^[A-Za-z0-9._~-]+$/.test(segment))
    )
  )
    throw new Error("capture URL path segments must use the safe route alphabet");
  const pattern =
    surface === "/"
      ? /^\/$/
      : new RegExp(
          `^/${surface
            .slice(1)
            .split("/")
            .map((segment) =>
              segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            )
            .join("/")}$`
        );
  return pattern.test(pathname);
}

function canonicalOrigin(raw, label) {
  boundedText(raw, 4096, label);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute origin`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol))
    throw new Error(`${label} must use http, https, ws, or wss`);
  if (parsed.username || parsed.password) throw new Error(`${label} cannot contain credentials`);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error(`${label} must be an origin without path, query, or fragment`);
  return parsed.origin;
}

function validateViewport(name, width, height) {
  const bounds = VIEWPORT_BOUNDS[name];
  if (!bounds) throw new Error("trusted web capture supports desktop, tablet, or narrow viewports");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
    throw new Error("viewport width and height must be safe integers");
  if (width < bounds.minWidth || (bounds.maxWidth !== null && width > bounds.maxWidth))
    throw new Error(`${name} viewport width ${width} is outside its accepted range`);
  if (height < bounds.minHeight)
    throw new Error(`${name} viewport height ${height} must be at least ${bounds.minHeight}`);
  return { width, height };
}

function captureVisualMetrics(inspected) {
  return {
    meaningful_pixel_ratio: inspected.meaningfulPixelRatio,
    meaningful_tile_ratio: inspected.meaningfulTileRatio,
    color_bucket_count: inspected.colorBucketCount,
    luminance_range: inspected.luminanceRange,
    perceptual_grid: inspected.perceptualGrid,
  };
}

function validateMeaningfulVisual(inspected) {
  if (
    inspected.meaningfulPixelRatio === null ||
    inspected.meaningfulPixelRatio < MIN_MEANINGFUL_PIXEL_RATIO
  )
    throw new Error(
      `product UI screenshot meaningful pixels must cover at least ${MIN_MEANINGFUL_PIXEL_RATIO * 100}%`
    );
  if (
    inspected.meaningfulTileRatio === null ||
    inspected.meaningfulTileRatio < MIN_MEANINGFUL_TILE_RATIO
  )
    throw new Error(
      `product UI screenshot meaningful content must occupy at least ${MIN_MEANINGFUL_TILE_RATIO * 100}% of spatial tiles`
    );
  if (!Number.isSafeInteger(inspected.colorBucketCount) || inspected.colorBucketCount < 2)
    throw new Error("product UI screenshot must contain at least two meaningful color buckets");
  if (
    !Number.isSafeInteger(inspected.luminanceRange) ||
    inspected.luminanceRange < MIN_LUMINANCE_RANGE
  )
    throw new Error(
      `product UI screenshot luminance range must be at least ${MIN_LUMINANCE_RANGE}`
    );
  if (typeof inspected.perceptualGrid !== "string" || inspected.perceptualGrid.length !== 256)
    throw new Error("product UI screenshot lacks a canonical perceptual grid");
  return captureVisualMetrics(inspected);
}

function validateStateAssertion(assertion, expected = null) {
  exactObject(
    assertion,
    ["schema_version", "subject_id", "coverage_id", "state", "state_marker", "all"],
    "state assertion"
  );
  if (assertion.schema_version !== 2)
    throw new Error("state assertion schema_version must equal 2");
  slug(assertion.subject_id, "state assertion.subject_id");
  slug(assertion.coverage_id, "state assertion.coverage_id");
  if (!STATES.has(assertion.state)) throw new Error("state assertion.state is invalid");
  if (
    expected &&
    (assertion.subject_id !== expected.subject_id ||
      assertion.coverage_id !== expected.coverage_id ||
      assertion.state !== expected.state)
  )
    throw new Error("state assertion identity must match the routed subject, coverage, and state");
  exactObject(
    assertion.state_marker,
    ["locator", "attribute", "value"],
    "state assertion.state_marker"
  );
  exactObject(
    assertion.state_marker.locator,
    ["by", "value"],
    "state assertion.state_marker.locator"
  );
  if (!new Set(["id", "test-id"]).has(assertion.state_marker.locator.by))
    throw new Error("state assertion.state_marker.locator.by must be id or test-id");
  boundedText(
    assertion.state_marker.locator.value,
    500,
    "state assertion.state_marker.locator.value"
  );
  if (
    assertion.state_marker.attribute !== "data-pm-state" ||
    assertion.state_marker.value !== assertion.state
  )
    throw new Error(
      "state assertion.state_marker must require data-pm-state equal to the routed state"
    );
  if (!Array.isArray(assertion.all) || assertion.all.length < 1 || assertion.all.length > 20)
    throw new Error("state assertion.all must contain 1 through 20 guard clauses");
  for (const [index, clause] of assertion.all.entries()) {
    exactObject(clause, ["locator", "expect"], `state assertion.all[${index}]`);
    exactObject(clause.locator, ["by", "value"], `state assertion.all[${index}].locator`);
    if (!new Set(["id", "test-id", "role-name"]).has(clause.locator.by))
      throw new Error(`state assertion.all[${index}].locator.by is invalid`);
    boundedText(clause.locator.value, 500, `state assertion.all[${index}].locator.value`);
    if (clause.locator.by === "role-name") {
      const separator = clause.locator.value.indexOf(":");
      if (separator < 1 || separator === clause.locator.value.length - 1)
        throw new Error(`state assertion.all[${index}].locator.value must be role:accessible-name`);
    }
    const kind = clause.expect?.kind;
    const expectedFields =
      kind === "attribute-equals"
        ? ["kind", "name", "value"]
        : kind === "accessible-name-equals"
          ? ["kind", "value"]
          : ["kind"];
    exactObject(clause.expect, expectedFields, `state assertion.all[${index}].expect`);
    if (
      !new Set([
        "exists",
        "absent",
        "visible",
        "attribute-equals",
        "accessible-name-equals",
        "focused",
      ]).has(kind)
    )
      throw new Error(`state assertion.all[${index}].expect.kind is invalid`);
    if (kind === "attribute-equals") {
      if (!/^(?:aria-[a-z0-9-]+|data-[a-z0-9-]+|class|disabled|value)$/.test(clause.expect.name))
        throw new Error(`state assertion.all[${index}].expect.name is not an allowed attribute`);
      if (typeof clause.expect.value !== "string" || clause.expect.value.length > 1000)
        throw new Error(`state assertion.all[${index}].expect.value is invalid`);
    }
    if (
      kind === "accessible-name-equals" &&
      (typeof clause.expect.value !== "string" ||
        !clause.expect.value.trim() ||
        clause.expect.value.length > 1000)
    )
      throw new Error(`state assertion.all[${index}].expect.value is invalid`);
  }
  validateSemanticStateGuard(assertion);
  return assertion;
}

function validateSemanticStateGuard(assertion) {
  const roleFor = (clause) =>
    clause.locator.by === "role-name"
      ? clause.locator.value.slice(0, clause.locator.value.indexOf(":")).trim().toLowerCase()
      : "";
  const visibleRole = (clause, roles) =>
    clause.expect.kind === "visible" && roles.has(roleFor(clause));
  const attributeEquals = (clause, name, value) =>
    clause.expect.kind === "attribute-equals" &&
    clause.expect.name === name &&
    clause.expect.value === value;
  const guards = assertion.all;
  const sameLocator = (left, right) =>
    left.locator.by === right.locator.by && left.locator.value === right.locator.value;
  const visiblyGuarded = (guard) =>
    guards.some((clause) => clause.expect.kind === "visible" && sameLocator(clause, guard));
  let satisfied = true;
  let requirement = "";
  if (new Set(["focus", "keyboard"]).has(assertion.state)) {
    satisfied = guards.some((clause) => clause.expect.kind === "focused" && visiblyGuarded(clause));
    requirement = "focused and visible guards for the same node";
  } else if (assertion.state === "disabled") {
    satisfied = guards.some(
      (clause) =>
        (attributeEquals(clause, "aria-disabled", "true") ||
          attributeEquals(clause, "disabled", "") ||
          attributeEquals(clause, "disabled", "disabled")) &&
        visiblyGuarded(clause)
    );
    requirement = "a visible disabled or aria-disabled node";
  } else if (assertion.state === "modal") {
    satisfied = guards.some((clause) => visibleRole(clause, new Set(["dialog", "alertdialog"])));
    requirement = "a visible dialog or alertdialog guard";
  } else if (assertion.state === "error") {
    satisfied = guards.some((clause) => visibleRole(clause, new Set(["alert"])));
    requirement = "a visible alert guard";
  } else if (assertion.state === "loading") {
    satisfied = guards.some(
      (clause) =>
        visibleRole(clause, new Set(["progressbar", "status"])) ||
        (attributeEquals(clause, "aria-busy", "true") && visiblyGuarded(clause))
    );
    requirement = "a visible progressbar/status or visible aria-busy node";
  }
  if (!satisfied) throw new Error(`state assertion for ${assertion.state} requires ${requirement}`);
}

function prepareCapturePlan(route, routePath, options) {
  validateRoute(route);
  slug(options.subjectId, "subject ID");
  slug(options.coverageId, "coverage ID");
  slug(options.captureId, "capture ID");
  const subject = route.subjects.find((item) => item.id === options.subjectId);
  if (!subject) throw new Error(`route does not contain subject ${options.subjectId}`);
  if (subject.platform !== "web") throw new Error("trusted browser capture requires a web subject");
  const coverage = route.coverage.find((item) => item.id === options.coverageId);
  if (!coverage) throw new Error(`route does not contain coverage ${options.coverageId}`);
  if (coverage.subject_id !== subject.id) throw new Error("coverage belongs to another subject");
  if (coverage.required !== true) throw new Error("cannot capture a non-required coverage row");
  const viewport = validateViewport(coverage.viewport, options.width, options.height);
  validateStateAssertion(options.assertion, {
    subject_id: subject.id,
    coverage_id: coverage.id,
    state: coverage.state,
  });
  sha256(options.assertionSha256, "state assertion SHA-256");
  const requested = redactedUrlIdentity(options.url, "capture URL");
  const expected = redactedUrlIdentity(options.expectedUrl || options.url, "expected final URL");
  const requestedUrl = requested.canonical;
  const expectedUrl = expected.canonical;
  if (requested.public.origin !== expected.public.origin)
    throw new Error("expected final URL origin must match the requested page origin");
  if (!urlMatchesSurface(requestedUrl, subject.surface))
    throw new Error("capture URL path does not match the routed subject surface");
  if (!urlMatchesSurface(expectedUrl, subject.surface))
    throw new Error("expected final URL path does not match the routed subject surface");
  const allowedOrigins = [
    new URL(requestedUrl).origin,
    ...(options.allowedOrigins || []).map((value, index) =>
      canonicalOrigin(value, `allowed origin ${index + 1}`)
    ),
  ];
  const uniqueAllowedOrigins = [...new Set(allowedOrigins)].sort();
  const relativeRoute = validateRelative(routePath, "route path");
  if (!/^\.pm\/dev-sessions\/[^/]+\/design-critique\/route\.json$/.test(relativeRoute))
    throw new Error("route must be the canonical Design Critique route path");
  const outputDir = validateRelative(options.outputDir, "output directory");
  const routeDirectory = path.posix.dirname(relativeRoute);
  const assertionPath = validateRelative(options.assertionPath, "state assertion path");
  if (assertionPath !== `${routeDirectory}/state-assertions/${coverage.id}.json`)
    throw new Error("state assertion must use the canonical path for its coverage row");
  const outputPattern = new RegExp(
    `^${routeDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/round-([12])/${options.captureId}$`
  );
  const roundMatch = outputDir.match(outputPattern);
  if (!roundMatch)
    throw new Error(
      "output directory must be round-1/<capture-id> or round-2/<capture-id> below the route"
    );
  const round = Number(roundMatch[1]);
  if (!options.captureId.endsWith(`-r${round}`))
    throw new Error(`capture ID must end in -r${round}`);
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
  const settleMs = options.settleMs ?? 250;
  if (
    !Number.isSafeInteger(readinessTimeoutMs) ||
    readinessTimeoutMs < 1_000 ||
    readinessTimeoutMs > 30_000
  )
    throw new Error("readiness timeout must be 1000 through 30000 milliseconds");
  if (!Number.isSafeInteger(settleMs) || settleMs < 100 || settleMs > 2_000)
    throw new Error("settle time must be 100 through 2000 milliseconds");
  return {
    route,
    subject,
    coverage,
    captureId: options.captureId,
    viewport,
    requestedUrl,
    expectedUrl,
    requestedUrlIdentity: requested.public,
    expectedUrlIdentity: expected.public,
    assertion: options.assertion,
    assertionPath,
    assertionSha256: options.assertionSha256,
    allowedOrigins: uniqueAllowedOrigins,
    outputDir,
    round,
    readinessTimeoutMs,
    settleMs,
  };
}

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding === null ? null : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
  });
}

function sourceIdentity(root) {
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
  sha(head, "current HEAD");
  sha(tree, "current tree");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no"], {
    encoding: null,
  });
  if (status.length !== 0)
    throw new Error("tracked source must be clean before trusted product UI capture");
  return { head, tree, tracked_status_sha256: digest(status), clean: true };
}

function assertRouteDiff(root, route) {
  const diff = git(
    root,
    ["diff", "--binary", `${route.source.base_commit}...${route.source.commit}`],
    { encoding: null }
  );
  if (digest(diff) !== route.source.diff_sha256)
    throw new Error("route diff SHA-256 does not match Git source bytes");
}

function readFileIdentity(filePath) {
  const realpath = fs.realpathSync(filePath);
  let descriptor;
  try {
    descriptor = fs.openSync(realpath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("browser executable must be a regular file");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let offset = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      if (after[field] !== before[field])
        throw new Error("browser executable changed while hashing");
    return {
      internal: {
        dev: String(after.dev),
        ino: String(after.ino),
        mtime_ns: String(after.mtimeNs),
        ctime_ns: String(after.ctimeNs),
      },
      public: {
        path: realpath,
        bytes: Number(after.size),
        sha256: hash.digest("hex"),
      },
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function browserVersion(browserPath) {
  const result = spawnSync(browserPath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error) throw new Error(`cannot identify browser: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`cannot identify browser: ${(result.stderr || result.stdout || "").trim()}`);
  const value = (result.stdout || result.stderr || "").trim().replace(/\s+/g, " ");
  if (!value || value.length > 500 || !/(chrome|chromium|edge)/i.test(value))
    throw new Error("browser emitted an invalid Chromium-family version identity");
  return value;
}

function browserIdentity(browserPath) {
  const identity = readFileIdentity(browserPath);
  return {
    internal: identity.internal,
    public: { ...identity.public, version: browserVersion(identity.public.path) },
  };
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveBrowser(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) return explicit;
    throw new Error(`configured Chromium browser does not exist: ${explicit}`);
  }
  const candidates = [
    process.env.PM_ARTIFACT_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!found)
    throw new Error("no Chromium browser found; pass --browser or set PM_ARTIFACT_BROWSER");
  return found;
}

function readPinnedCapture(filePath, expected) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("staged capture is not a regular file");
    if (before.size > BigInt(MAX_CAPTURE_BYTES))
      throw new Error(`staged capture exceeds ${MAX_CAPTURE_BYTES}-byte budget`);
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("staged capture ended before its attested size");
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const actual = {
      dev: String(after.dev),
      ino: String(after.ino),
      size: String(after.size),
      mtime_ns: String(after.mtimeNs),
      ctime_ns: String(after.ctimeNs),
      sha256: digest(bytes),
    };
    if (!sameIdentity(actual, expected))
      throw new Error("staged capture does not match producer attestation");
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function terminateBrowserProcessGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return;
  try {
    if (process.platform === "win32") process.kill(pid, "SIGKILL");
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Normal helper cleanup already terminated the browser.
  }
}

function runCaptureProbe(configuration, runtime = {}) {
  let result;
  const probePath = runtime.probePath || CAPTURE_PROBE;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const filePath of [configuration.outputPath, configuration.verificationPath])
      fs.rmSync(filePath, { force: true });
    const controlToken = crypto.randomBytes(24).toString("hex");
    result = spawnSync(
      process.execPath,
      ["--experimental-websocket", "--max-old-space-size=768", probePath],
      {
        input: JSON.stringify({ ...configuration, controlToken }),
        encoding: "utf8",
        timeout: runtime.timeoutMs || 60_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      }
    );
    let control = null;
    try {
      control = JSON.parse(String(result.output?.[3] || "").trim());
    } catch {
      // A helper that failed before launch has no browser resources to reclaim.
    }
    if (
      control?.type === "browser-control" &&
      control.token === controlToken &&
      typeof control.profileDir === "string" &&
      path.dirname(path.resolve(control.profileDir)) === path.resolve(os.tmpdir()) &&
      path.basename(control.profileDir).startsWith("pm-design-capture-cdp-")
    ) {
      (runtime.terminateBrowser || terminateBrowserProcessGroup)(control.pid);
      (
        runtime.removeProfile ||
        ((directory) => fs.rmSync(directory, { recursive: true, force: true }))
      )(control.profileDir);
    }
    if (!result.error && result.status === 0) return JSON.parse(result.stdout);
    const detail = `${result.stderr || ""}${result.stdout || ""}`;
    const retryable = [
      "Chromium did not expose a debugging endpoint",
      "Chromium did not expose a page target",
    ].some((message) => detail.includes(message));
    if (!retryable || attempt === 3) break;
  }
  for (const filePath of [configuration.outputPath, configuration.verificationPath])
    fs.rmSync(filePath, { force: true });
  if (result?.error) throw new Error(`trusted capture failed: ${result.error.message}`);
  throw new Error(
    `trusted capture exited ${result?.status}: ${(
      result?.stderr ||
      result?.stdout ||
      "unknown error"
    )
      .trim()
      .slice(0, 500)}`
  );
}

function validateAttestation(value, label) {
  exactObject(value, ["dev", "ino", "size", "mtime_ns", "ctime_ns", "sha256"], label);
  for (const field of ["dev", "ino", "size", "mtime_ns", "ctime_ns"])
    if (typeof value[field] !== "string" || !/^\d+$/.test(value[field]))
      throw new Error(`${label}.${field} is invalid`);
  sha256(value.sha256, `${label}.sha256`);
}

function validateUrlIdentity(value, label) {
  exactObject(value, ["origin", "pathname", "has_query", "has_fragment", "full_url_sha256"], label);
  boundedText(value.origin, 4096, `${label}.origin`);
  boundedText(value.pathname, 4096, `${label}.pathname`);
  let publicUrl;
  try {
    publicUrl = new URL(value.pathname, value.origin);
  } catch {
    throw new Error(`${label} does not contain a valid public URL identity`);
  }
  if (
    !["http:", "https:"].includes(publicUrl.protocol) ||
    publicUrl.origin !== value.origin ||
    publicUrl.pathname !== value.pathname ||
    publicUrl.search ||
    publicUrl.hash
  )
    throw new Error(`${label} does not contain a canonical public URL identity`);
  for (const field of ["has_query", "has_fragment"])
    if (typeof value[field] !== "boolean") throw new Error(`${label}.${field} must be boolean`);
  sha256(value.full_url_sha256, `${label}.full_url_sha256`);
  return value;
}

function sameUrlIdentity(left, right) {
  return ["origin", "pathname", "has_query", "has_fragment", "full_url_sha256"].every(
    (field) => left[field] === right[field]
  );
}

function validateAssertionVisibility(value, label, expectedLabels = null) {
  exactObject(value, ["method", "effective_opacity_floor", "verified_nodes", "checks"], label);
  if (value.method !== "cdp-dom-get-node-for-location-v1")
    throw new Error(`${label}.method is invalid`);
  if (value.effective_opacity_floor !== 0.01)
    throw new Error(`${label}.effective_opacity_floor is invalid`);
  if (
    !Number.isSafeInteger(value.verified_nodes) ||
    value.verified_nodes < 1 ||
    value.verified_nodes > 21 ||
    !Array.isArray(value.checks) ||
    value.checks.length !== value.verified_nodes
  )
    throw new Error(`${label} must contain one hit test per required visible node`);
  for (const [index, check] of value.checks.entries()) {
    exactObject(
      check,
      ["label", "asserted_backend_node_id", "hit_backend_node_id", "x", "y"],
      `${label}.checks[${index}]`
    );
    boundedText(check.label, 100, `${label}.checks[${index}].label`);
    if (expectedLabels && check.label !== expectedLabels[index])
      throw new Error(`${label}.checks[${index}].label does not match the assertion clause`);
    for (const field of ["asserted_backend_node_id", "hit_backend_node_id", "x", "y"])
      if (!Number.isSafeInteger(check[field]) || check[field] < 0)
        throw new Error(`${label}.checks[${index}].${field} is invalid`);
  }
  if (expectedLabels && value.verified_nodes !== expectedLabels.length)
    throw new Error(`${label} did not hit-test every required visible assertion node`);
  return value;
}

function validateProbeResult(result, plan) {
  exactObject(
    result,
    [
      "schema_version",
      "page",
      "assertion_visibility",
      "assertion_passed",
      "accessibility_observations",
      "dom_observations",
      "screenshot",
      "verification_screenshot",
      "network",
      "timestamps",
    ],
    "capture probe"
  );
  if (result.schema_version !== 2) throw new Error("capture probe schema_version must equal 2");
  exactObject(
    result.page,
    ["target_id", "main_frame_id", "loader_id", "final_url", "css_viewport"],
    "capture probe.page"
  );
  for (const field of ["target_id", "main_frame_id", "loader_id"])
    boundedText(result.page[field], 500, `capture probe.page.${field}`);
  validateUrlIdentity(result.page.final_url, "capture probe.page.final_url");
  if (!sameUrlIdentity(result.page.final_url, plan.expectedUrlIdentity))
    throw new Error(
      "navigation drift: observed final URL does not match the expected URL identity"
    );
  if (
    !urlMatchesSurface(
      `${result.page.final_url.origin}${result.page.final_url.pathname}`,
      plan.subject.surface
    )
  )
    throw new Error(
      "navigation drift: observed final URL path does not match the routed subject surface"
    );
  validateAssertionVisibility(result.assertion_visibility, "capture probe.assertion_visibility", [
    "state marker",
    ...plan.assertion.all.flatMap((clause, index) =>
      clause.expect.kind === "visible" ? [`state assertion clause ${index + 1}`] : []
    ),
  ]);
  exactObject(
    result.page.css_viewport,
    [
      "inner_width",
      "inner_height",
      "client_width",
      "client_height",
      "scroll_width",
      "scroll_height",
      "device_scale_factor",
      "scroll_x",
      "scroll_y",
      "visual_scale",
      "page_zoom",
    ],
    "capture probe.page.css_viewport"
  );
  const viewport = result.page.css_viewport;
  for (const field of [
    "inner_width",
    "inner_height",
    "client_width",
    "client_height",
    "scroll_width",
    "scroll_height",
  ])
    if (!Number.isSafeInteger(viewport[field]) || viewport[field] < 1)
      throw new Error(`capture probe.page.css_viewport.${field} must be a positive integer`);
  if (
    viewport.inner_width !== plan.viewport.width ||
    viewport.inner_height !== plan.viewport.height ||
    viewport.client_width !== plan.viewport.width ||
    viewport.client_height !== plan.viewport.height ||
    viewport.device_scale_factor !== 1 ||
    viewport.scroll_x !== 0 ||
    viewport.scroll_y !== 0 ||
    viewport.visual_scale !== 1 ||
    viewport.page_zoom !== 1
  )
    throw new Error("browser CSS viewport does not match the routed capture viewport");
  if (result.assertion_passed !== true) throw new Error("capture probe did not pass its assertion");
  validateAttestation(result.screenshot, "capture probe.screenshot");
  validateAttestation(result.verification_screenshot, "capture probe.verification_screenshot");
  exactObject(
    result.network,
    ["policy", "allowed_origins", "observed_origins", "requests", "violations"],
    "capture probe.network"
  );
  if (result.network.policy !== "explicit-origin-allowlist")
    throw new Error("capture probe network policy is invalid");
  if (JSON.stringify(result.network.allowed_origins) !== JSON.stringify(plan.allowedOrigins))
    throw new Error("capture probe changed the network allowlist");
  if (!Array.isArray(result.network.violations) || result.network.violations.length !== 0)
    throw new Error("capture probe observed a network policy violation");
  if (!Array.isArray(result.network.requests) || result.network.requests.length > 2000)
    throw new Error("capture probe network request ledger is outside bounds");
  if (!Array.isArray(result.network.observed_origins))
    throw new Error("capture probe observed origins must be an array");
  exactObject(
    result.timestamps,
    ["started_at", "page_ready_at", "captured_at", "completed_at"],
    "capture probe.timestamps"
  );
  let previous = 0;
  for (const field of ["started_at", "page_ready_at", "captured_at", "completed_at"]) {
    const value = Date.parse(result.timestamps[field]);
    if (!Number.isFinite(value) || value < previous)
      throw new Error("capture probe timestamps must be ordered RFC 3339 values");
    previous = value;
  }
}

function invocationDigest(plan, routeSha256) {
  return digest(
    Buffer.from(
      JSON.stringify({
        producer: { name: "pm:design-critique-capture", version: PLUGIN_VERSION },
        route_sha256: routeSha256,
        run_id: plan.route.run_id,
        commit: plan.route.source.commit,
        subject_id: plan.subject.id,
        coverage: {
          id: plan.coverage.id,
          state: plan.coverage.state,
          viewport: plan.coverage.viewport,
        },
        capture_id: plan.captureId,
        route_surface: plan.subject.surface,
        requested_url: plan.requestedUrlIdentity,
        expected_url: plan.expectedUrlIdentity,
        viewport: plan.viewport,
        assertion: { path: plan.assertionPath, sha256: plan.assertionSha256 },
        allowed_origins: plan.allowedOrigins,
        readiness_timeout_ms: plan.readinessTimeoutMs,
        settle_ms: plan.settleMs,
        browser_args_profile: BROWSER_ARGS_PROFILE,
        acquisition: ACQUISITION_METHOD,
      })
    )
  );
}

function writeExclusive(filePath, bytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureProjectDirectory(root, relative) {
  const projectRoot = fs.realpathSync(root);
  let current = projectRoot;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(`output ancestor is not a real directory: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const real = fs.realpathSync(current);
    if (real !== projectRoot && !real.startsWith(`${projectRoot}${path.sep}`))
      throw new Error("output ancestor resolves outside the project root");
  }
  return current;
}

function publishBundle(root, outputDir, files) {
  const projectRoot = fs.realpathSync(root);
  const parentRelative = path.posix.dirname(outputDir);
  const parent = ensureProjectDirectory(projectRoot, parentRelative);
  const finalPath = path.join(projectRoot, ...outputDir.split("/"));
  if (fs.existsSync(finalPath))
    throw new Error("capture bundle already exists; never overwrite evidence");
  const staging = fs.mkdtempSync(path.join(parent, ".pm-capture-bundle-"));
  try {
    for (const [name, bytes] of files) writeExclusive(path.join(staging, name), bytes);
    let descriptor;
    try {
      descriptor = fs.openSync(staging, fs.constants.O_RDONLY);
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!new Set(["EINVAL", "ENOTSUP", "EPERM", "EISDIR"]).has(error.code)) throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    if (fs.existsSync(finalPath))
      throw new Error("capture bundle destination changed before commit");
    fs.renameSync(staging, finalPath);
    return finalPath;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function manifestShape(manifest) {
  exactObject(
    manifest,
    [
      "schema_version",
      "kind",
      "run_id",
      "mode",
      "commit",
      "route",
      "subject_id",
      "coverage",
      "capture",
      "raw_evidence",
      "page",
      "observation",
      "timestamps",
    ],
    "capture manifest"
  );
  exactObject(manifest.route, ["path", "sha256"], "capture manifest.route");
  exactObject(manifest.coverage, ["id", "state", "viewport"], "capture manifest.coverage");
  exactObject(
    manifest.capture,
    [
      "id",
      "path",
      "sha256",
      "pixel_sha256",
      "visual_metrics",
      "width",
      "height",
      "full_page",
      "round",
      "captured_at",
    ],
    "capture manifest.capture"
  );
  exactObject(
    manifest.capture.visual_metrics,
    [
      "meaningful_pixel_ratio",
      "meaningful_tile_ratio",
      "color_bucket_count",
      "luminance_range",
      "perceptual_grid",
    ],
    "capture manifest.capture.visual_metrics"
  );
  exactObject(
    manifest.raw_evidence,
    ["accessibility_tree", "dom_audit", "network_ledger"],
    "capture manifest.raw_evidence"
  );
  for (const [key, value] of Object.entries(manifest.raw_evidence))
    exactObject(value, ["path", "sha256"], `capture manifest.raw_evidence.${key}`);
  exactObject(
    manifest.page,
    [
      "route_surface",
      "requested_url",
      "expected_url",
      "final_url",
      "target_id",
      "main_frame_id",
      "loader_id",
      "css_viewport",
      "state_assertion",
    ],
    "capture manifest.page"
  );
  for (const field of ["requested_url", "expected_url", "final_url"])
    validateUrlIdentity(manifest.page[field], `capture manifest.page.${field}`);
  exactObject(
    manifest.page.state_assertion,
    ["path", "sha256", "passed", "visibility"],
    "capture manifest.page.state_assertion"
  );
  exactObject(
    manifest.page.state_assertion.visibility,
    ["method", "effective_opacity_floor", "verified_nodes", "checks"],
    "capture manifest.page.state_assertion.visibility"
  );
  validateAssertionVisibility(
    manifest.page.state_assertion.visibility,
    "capture manifest.page.state_assertion.visibility"
  );
  exactObject(
    manifest.page.css_viewport,
    [
      "inner_width",
      "inner_height",
      "client_width",
      "client_height",
      "scroll_width",
      "scroll_height",
      "device_scale_factor",
      "scroll_x",
      "scroll_y",
      "visual_scale",
      "page_zoom",
    ],
    "capture manifest.page.css_viewport"
  );
  exactObject(
    manifest.observation,
    [
      "assurance_level",
      "producer",
      "browser",
      "source",
      "network",
      "configuration",
      "invocation_configuration_sha256",
      "stability",
    ],
    "capture manifest.observation"
  );
  exactObject(
    manifest.observation.producer,
    ["name", "version"],
    "capture manifest.observation.producer"
  );
  exactObject(
    manifest.observation.browser,
    ["engine", "before", "after"],
    "capture manifest.observation.browser"
  );
  for (const key of ["before", "after"])
    exactObject(
      manifest.observation.browser[key],
      ["path", "bytes", "sha256", "version"],
      `capture manifest.observation.browser.${key}`
    );
  exactObject(
    manifest.observation.source,
    ["before", "after", "guard"],
    "capture manifest.observation.source"
  );
  for (const key of ["before", "after"])
    exactObject(
      manifest.observation.source[key],
      ["head", "tree", "tracked_status_sha256", "clean"],
      `capture manifest.observation.source.${key}`
    );
  exactObject(
    manifest.observation.network,
    [
      "policy",
      "allowed_origins",
      "observed_origins",
      "request_count",
      "ledger_sha256",
      "violations",
    ],
    "capture manifest.observation.network"
  );
  exactObject(
    manifest.observation.stability,
    ["samples", "native_observations_sha256", "decoded_pixels_sha256"],
    "capture manifest.observation.stability"
  );
  exactObject(
    manifest.observation.configuration,
    ["readiness_timeout_ms", "settle_ms", "browser_args_profile", "acquisition"],
    "capture manifest.observation.configuration"
  );
  exactObject(
    manifest.timestamps,
    ["started_at", "page_ready_at", "captured_at", "completed_at"],
    "capture manifest.timestamps"
  );
  return manifest;
}

function captureProductUi(options, runtime = {}) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const routeFile = readProjectInput(root, options.routePath, MAX_ROUTE_BYTES);
  let route;
  try {
    route = JSON.parse(routeFile.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`route is invalid JSON: ${error.message}`);
  }
  const assertionFile = readProjectInput(root, options.assertionPath, MAX_ASSERTION_BYTES);
  let assertion;
  try {
    assertion = JSON.parse(assertionFile.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`state assertion is invalid JSON: ${error.message}`);
  }
  const assertionSha256 = digest(assertionFile.bytes);
  const plan = prepareCapturePlan(route, routeFile.relative, {
    ...options,
    assertion,
    assertionPath: assertionFile.relative,
    assertionSha256,
  });
  const routeSha256 = digest(routeFile.bytes);
  const sourceBefore = sourceIdentity(root);
  if (sourceBefore.head !== route.source.commit)
    throw new Error("route commit does not equal current HEAD");
  assertRouteDiff(root, route);
  const browserPath = resolveBrowser(options.browserPath);
  const browserBefore = browserIdentity(browserPath);
  const invocationConfigurationSha256 = invocationDigest(plan, routeSha256);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "pm-product-ui-capture-"));
  try {
    const screenshotPath = path.join(staging, "capture.png");
    const verificationPath = path.join(staging, "verification.png");
    const probe = (runtime.runProbe || runCaptureProbe)({
      browserPath: browserBefore.public.path,
      url: plan.requestedUrl,
      expectedUrl: plan.expectedUrl,
      viewport: plan.viewport,
      stateAssertion: plan.assertion,
      allowedOrigins: plan.allowedOrigins,
      readinessTimeoutMs: plan.readinessTimeoutMs,
      settleMs: plan.settleMs,
      outputPath: screenshotPath,
      verificationPath,
    });
    validateProbeResult(probe, plan);
    const screenshotBytes = readPinnedCapture(screenshotPath, probe.screenshot);
    const verificationBytes = readPinnedCapture(verificationPath, probe.verification_screenshot);
    const screenshot = inspectPngVisualBytes(screenshotBytes);
    const verification = inspectPngVisualBytes(verificationBytes);
    if (
      screenshot.width !== plan.viewport.width ||
      screenshot.height !== plan.viewport.height ||
      verification.width !== plan.viewport.width ||
      verification.height !== plan.viewport.height
    )
      throw new Error("decoded screenshot dimensions do not match the routed viewport");
    if (!screenshot.pixelSha256 || screenshot.pixelSha256 !== verification.pixelSha256)
      throw new Error("decoded screenshot pixels changed during atomic capture");
    if (
      screenshot.visiblePixels === null ||
      screenshot.visiblePixels / screenshot.totalPixels < MIN_VISIBLE_PIXEL_RATIO
    )
      throw new Error("product UI screenshot has less than 1% effective visible coverage");
    if (screenshot.hasVisualVariation !== true)
      throw new Error("product UI screenshot has no visible pixel variation");
    const visualMetrics = validateMeaningfulVisual(screenshot);

    const base = `${plan.outputDir}/`;
    const screenshotRelative = `${base}capture.png`;
    const a11yRelative = `${base}accessibility-tree-raw.json`;
    const domRelative = `${base}dom-audit-raw.json`;
    const networkRelative = `${base}network-ledger.json`;
    const manifestRelative = `${base}capture.json`;
    const a11yRaw = {
      schema_version: 1,
      kind: "accessibility-tree",
      subject_id: plan.subject.id,
      commit: route.source.commit,
      capture_ids: [plan.captureId],
      observations: probe.accessibility_observations,
    };
    const domRaw = {
      schema_version: 1,
      kind: "dom-audit",
      subject_id: plan.subject.id,
      commit: route.source.commit,
      capture_ids: [plan.captureId],
      observations: probe.dom_observations,
    };
    const a11yBytes = Buffer.from(`${JSON.stringify(a11yRaw, null, 2)}\n`);
    const domBytes = Buffer.from(`${JSON.stringify(domRaw, null, 2)}\n`);
    if (a11yBytes.length > MAX_RAW_AUDIT_BYTES || domBytes.length > MAX_RAW_AUDIT_BYTES)
      throw new Error("raw audit exceeds the 1 MiB budget");
    normalizeRawAudit(a11yRaw, { path: a11yRelative, sha256: digest(a11yBytes) });
    normalizeRawAudit(domRaw, { path: domRelative, sha256: digest(domBytes) });
    const networkLedger = {
      schema_version: 1,
      policy: "explicit-origin-allowlist",
      allowed_origins: probe.network.allowed_origins,
      observed_origins: probe.network.observed_origins,
      requests: probe.network.requests,
      violations: [],
    };
    const networkBytes = Buffer.from(`${JSON.stringify(networkLedger, null, 2)}\n`);
    if (networkBytes.length > MAX_NETWORK_BYTES)
      throw new Error("network ledger exceeds the 1 MiB budget");

    const browserAfter = browserIdentity(browserBefore.public.path);
    if (!sameIdentity(browserBefore, browserAfter))
      throw new Error("browser executable changed during product UI capture");
    const sourceAfter = sourceIdentity(root);
    if (!sameIdentity(sourceBefore, sourceAfter))
      throw new Error("Git source changed during product UI capture");
    const routeAfter = readProjectInput(root, routeFile.relative, MAX_ROUTE_BYTES);
    if (digest(routeAfter.bytes) !== routeSha256)
      throw new Error("route changed during product UI capture");
    const assertionAfter = readProjectInput(root, assertionFile.relative, MAX_ASSERTION_BYTES);
    if (digest(assertionAfter.bytes) !== assertionSha256)
      throw new Error("state assertion changed during product UI capture");

    const finalUrlIdentity = probe.page.final_url;
    const publicPageIdentity = {
      target_id: probe.page.target_id,
      main_frame_id: probe.page.main_frame_id,
      loader_id: probe.page.loader_id,
      final_url: finalUrlIdentity,
      css_viewport: probe.page.css_viewport,
    };
    const nativeObservationSha256 = digest(
      Buffer.from(
        JSON.stringify({
          page: publicPageIdentity,
          assertion_visibility: probe.assertion_visibility,
          accessibility: probe.accessibility_observations,
          dom: probe.dom_observations,
        })
      )
    );
    const manifest = manifestShape({
      schema_version: 2,
      kind: "product-ui-capture",
      run_id: route.run_id,
      mode: "product-ui",
      commit: route.source.commit,
      route: { path: routeFile.relative, sha256: routeSha256 },
      subject_id: plan.subject.id,
      coverage: {
        id: plan.coverage.id,
        state: plan.coverage.state,
        viewport: plan.coverage.viewport,
      },
      capture: {
        id: plan.captureId,
        path: screenshotRelative,
        sha256: digest(screenshotBytes),
        pixel_sha256: screenshot.pixelSha256,
        visual_metrics: visualMetrics,
        width: screenshot.width,
        height: screenshot.height,
        full_page: false,
        round: plan.round,
        captured_at: probe.timestamps.captured_at,
      },
      raw_evidence: {
        accessibility_tree: { path: a11yRelative, sha256: digest(a11yBytes) },
        dom_audit: { path: domRelative, sha256: digest(domBytes) },
        network_ledger: { path: networkRelative, sha256: digest(networkBytes) },
      },
      page: {
        route_surface: plan.subject.surface,
        requested_url: plan.requestedUrlIdentity,
        expected_url: plan.expectedUrlIdentity,
        final_url: finalUrlIdentity,
        target_id: probe.page.target_id,
        main_frame_id: probe.page.main_frame_id,
        loader_id: probe.page.loader_id,
        css_viewport: probe.page.css_viewport,
        state_assertion: {
          path: assertionFile.relative,
          sha256: assertionSha256,
          passed: true,
          visibility: probe.assertion_visibility,
        },
      },
      observation: {
        assurance_level: CAPTURE_ASSURANCE,
        producer: { name: "pm:design-critique-capture", version: PLUGIN_VERSION },
        browser: {
          engine: "chromium",
          before: browserBefore.public,
          after: browserAfter.public,
        },
        source: {
          before: sourceBefore,
          after: sourceAfter,
          guard: "clean-tracked-tree-before-and-after",
        },
        network: {
          policy: "explicit-origin-allowlist",
          allowed_origins: probe.network.allowed_origins,
          observed_origins: probe.network.observed_origins,
          request_count: probe.network.requests.length,
          ledger_sha256: digest(networkBytes),
          violations: 0,
        },
        configuration: {
          readiness_timeout_ms: plan.readinessTimeoutMs,
          settle_ms: plan.settleMs,
          browser_args_profile: BROWSER_ARGS_PROFILE,
          acquisition: ACQUISITION_METHOD,
        },
        invocation_configuration_sha256: invocationConfigurationSha256,
        stability: {
          samples: 2,
          native_observations_sha256: nativeObservationSha256,
          decoded_pixels_sha256: screenshot.pixelSha256,
        },
      },
      timestamps: probe.timestamps,
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    publishBundle(root, plan.outputDir, [
      ["capture.png", screenshotBytes],
      ["accessibility-tree-raw.json", a11yBytes],
      ["dom-audit-raw.json", domBytes],
      ["network-ledger.json", networkBytes],
      ["capture.json", manifestBytes],
    ]);
    const committed = readProjectInput(root, manifestRelative, MAX_RAW_AUDIT_BYTES);
    if (!committed.bytes.equals(manifestBytes))
      throw new Error("published capture manifest differs from committed bytes");
    return {
      ok: true,
      assurance_level: CAPTURE_ASSURANCE,
      manifest: { path: manifestRelative, sha256: digest(manifestBytes) },
      capture: manifest.capture,
      raw_evidence: manifest.raw_evidence,
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { allowedOrigins: [] };
  const names = new Map([
    ["--root", "root"],
    ["--route", "routePath"],
    ["--subject", "subjectId"],
    ["--coverage", "coverageId"],
    ["--capture", "captureId"],
    ["--url", "url"],
    ["--expect-url", "expectedUrl"],
    ["--state-assertion", "assertionPath"],
    ["--width", "width"],
    ["--height", "height"],
    ["--out-dir", "outputDir"],
    ["--browser", "browserPath"],
    ["--readiness-timeout-ms", "readinessTimeoutMs"],
    ["--settle-ms", "settleMs"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--allow-origin") {
      const value = argv[++index];
      if (!value) throw new Error("--allow-origin requires a value");
      options.allowedOrigins.push(value);
      continue;
    }
    const field = names.get(token);
    if (!field) throw new Error(`unknown argument ${token}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`${token} requires a value`);
    options[field] = value;
  }
  for (const field of [
    "routePath",
    "subjectId",
    "coverageId",
    "captureId",
    "url",
    "assertionPath",
    "width",
    "height",
    "outputDir",
  ])
    if (options[field] === undefined) throw new Error(`missing required ${field}`);
  for (const field of ["width", "height", "readinessTimeoutMs", "settleMs"])
    if (options[field] !== undefined) options[field] = Number(options[field]);
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const result = captureProductUi(options);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Product UI capture saved: ${result.manifest.path}\nAssurance: ${result.assurance_level} (workflow attestation, not a signature)\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  ACQUISITION_METHOD,
  BROWSER_ARGS_PROFILE,
  CAPTURE_ASSURANCE,
  VIEWPORT_BOUNDS,
  browserIdentity,
  canonicalOrigin,
  canonicalUrl,
  captureVisualMetrics,
  captureProductUi,
  invocationDigest,
  manifestShape,
  parseArgs,
  prepareCapturePlan,
  redactedUrlIdentity,
  resolveBrowser,
  runCaptureProbe,
  sourceIdentity,
  validateProbeResult,
  validateAssertionVisibility,
  validateMeaningfulVisual,
  validateRoute,
  validateStateAssertion,
  validateSurfacePattern,
  validateUrlIdentity,
  validateViewport,
  urlMatchesSurface,
};
