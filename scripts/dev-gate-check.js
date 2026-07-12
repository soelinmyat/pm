#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { deriveSessionSlug } = require("./lib/session-slug");

const DEFAULT_MANIFEST_PATH = ".pm/dev-sessions/current.gates.json";
const DEFAULT_REQUIRED_GATES = ["tdd", "design-critique", "qa", "review", "verification"];
// "simplify" was absorbed into review in v1.9. The name stays valid only so
// legacy sidecars carrying old rows don't hard-fail; passed/skipped/stale rows
// are tolerated, failed/blocked rows are not. Single-gate --require calls are
// incremental checks, never a substitute for the default full-gate run.
const VALID_GATE_NAMES = new Set([...DEFAULT_REQUIRED_GATES, "simplify"]);
const VALID_STATUSES = new Set(["passed", "skipped", "failed", "blocked"]);
const DEFAULT_ALLOW_SKIPPED_GATES = ["tdd", "simplify", "design-critique", "qa"];
const NEVER_SKIPPABLE_GATES = new Set(["review", "verification"]);
const REQUIRED_GATE_FIELDS = ["name", "status", "commit", "artifact", "reason", "checked_at"];
const UI_SKIP_GATES = new Set(["design-critique", "qa"]);
const NO_UI_SKIP_REASON =
  /(no (ui|visual|user-visible|interaction) (impact|change|surface)|no visual impact|no user-visible (impact|change|surface)|backend-only|docs-only|config-only|generated-only|pure refactor)/i;
const ENVIRONMENT_SKIP_REASON =
  /(server|environment|db|database|auth|login|seed|screenshot|artifact|can't start|cannot start|failed to start|not running)/i;
const TDD_SKIP_REASON =
  /(docs-only|documentation-only|config-only|generated-only|lockfile-only|non-behavior|no behavior change|no runtime behavior)/i;
const SIMPLIFY_SKIP_REASON =
  /(xs size|kind (task|bug) uses review gate|no code changes|no runtime-source changes|no reviewable source)/i;
const PM_RUNTIME_PATH_RE =
  /^(commands|skills|templates|hooks|scripts|tests|references|agents|\.githooks)\//;
const PM_RUNTIME_FILE_RE = /^(plugin\.config\.json|\.claude-plugin\/|\.codex-plugin\/)/;
const UI_PATH_RE =
  /(^|\/)(components?|screens?|pages?|routes?|views?|layouts?|design-system|styles?|theme|copy|locales?|i18n)(\/|$)|\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i;
const JS_TS_PATH_RE = /\.(js|mjs|cjs|ts)$/i;
const UI_JS_TS_PATH_RE =
  /(^|\/)(app\/javascript|assets\/javascripts?|public\/javascripts?|frontend|client|web|mobile|ui|browser)(\/|$)/i;
const UI_JS_TS_ENTRY_RE =
  /(^|\/)src\/(App|app|main|index|bootstrap|entry-client|entry-server)\.(js|mjs|cjs|ts)$/i;
const UI_APP_ROOT_RE =
  /(^|\/)(apps?|packages)\/[^/]*(web|frontend|client|mobile|ui|browser)[^/]*\/(src|app)\//i;
const NEXT_APP_ROUTER_UI_RE =
  /(^|\/)(src\/)?app\/([^/]+\/)*(page|layout|template|loading|error|not-found|global-error|default)\.(js|mjs|cjs|ts)$/i;
const NEXT_APP_ROUTER_MARKUP_RE =
  /(^|\/)(src\/)?app\/([^/]+\/)*(page|layout|template|loading|error|not-found|global-error|default)\.(mdx|md)$/i;
const ANGULAR_UI_TS_RE = /(^|\/)(src\/)?app\/([^/]+\/)*[^/]+\.(component|directive|pipe)\.ts$/i;
const UI_ROUTER_JS_TS_RE =
  /(^|\/)(src\/)?((routes|routing|router)\.(js|mjs|cjs|ts)|router\/(index|routes|router)\.(js|mjs|cjs|ts)|app\/([^/]+\/)*[^/]+(\.routes|-routing\.module)\.ts)$/i;
const UI_SINGLE_APP_STATE_RE =
  /(^|\/)src\/(features?|hooks?|stores?|state|contexts?|providers?|redux|reducers?|slices?|zustand)\//i;
const UI_CONFIG_RE =
  /(^|\/)(tailwind\.config|postcss\.config|uno\.config|unocss\.config|theme\.config|tokens\.config)\.(js|mjs|cjs|ts)$/i;
const UI_TOKEN_DATA_RE =
  /(^|\/)(design-tokens?|tokens?|themes?)(\/|[-.])|(^|\/)(design-tokens?|tokens?|themes?|style-dictionary\.config)\.(json|ya?ml|toml)$/i;
const UI_TEMPLATE_MARKUP_RE =
  /\.(html?|astro|erb|ejs|hbs|handlebars|liquid|twig|njk|j2|pug|jade|slim|haml|mustache|cshtml|razor|blade\.php)$/i;
const CODE_PATH_RE =
  /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|kts|swift|php|cs|cpp|cxx|cc|c|h|hpp|m|mm|sh|bash|zsh|fish|ps1|sql)$/i;
const DOC_OR_CONFIG_PATH_RE =
  /(^|\/)(README|CHANGELOG|LICENSE)(\.[^/]*)?$|(^|\/)docs\/|\.md$|\.mdx$|\.txt$|\.ya?ml$|\.json$|\.toml$|\.ini$|\.env(\.|$)|(^|\/)(package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock)$/i;
const GENERATED_PATH_RE =
  /(^|\/)(dist|build|coverage|generated|__generated__|vendor|node_modules)\//i;

function checkGateManifest(manifest, opts = {}) {
  const issues = [];
  const requiredGatesInput = normalizeGateNames(opts.requiredGates);
  const requiredGates = requiredGatesInput.length > 0 ? requiredGatesInput : DEFAULT_REQUIRED_GATES;
  const allowSkippedGates = new Set(
    normalizeGateNames(opts.allowSkippedGates || DEFAULT_ALLOW_SKIPPED_GATES)
  );
  const currentCommit = opts.currentCommit || "";
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST_PATH;
  const artifactRoot = opts.artifactRoot || process.cwd();
  const changedFiles = normalizeChangedFiles(opts.changedFiles || []);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, issues: [issue(manifestPath, "gate manifest must be an object")] };
  }
  if (manifest.schema_version !== 1) {
    issues.push(issue(manifestPath, "schema_version must equal 1"));
  }
  if (opts.runId && manifest.run_id !== opts.runId) {
    issues.push(issue(manifestPath, `run_id must equal active session ${opts.runId}`));
  }
  if (!Array.isArray(manifest.gates)) {
    issues.push(issue(manifestPath, "gates must be an array"));
    return { ok: false, issues };
  }
  const sessionContext = readSessionContext(manifest, opts);

  const legacySimplifyTolerated = !requiredGates.includes("simplify");
  const byName = new Map();
  manifest.gates.forEach((gate, index) => {
    const where = `${manifestPath}#gates[${index}]`;
    const legacyRow = legacySimplifyTolerated && gate?.name === "simplify";
    validateGateRow(gate, where, issues, { artifactRoot, skipArtifactExistence: legacyRow });
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) return;
    if (byName.has(gate.name)) {
      issues.push(issue(where, `duplicate gate ${gate.name}`));
      return;
    }
    // Legacy tolerance covers passed/skipped/stale rows, never recorded failures.
    if (legacyRow && (gate.status === "failed" || gate.status === "blocked")) {
      issues.push(issue(where, `legacy gate simplify is ${gate.status} — resolve or remove it`));
    }
    byName.set(gate.name, gate);
  });

  for (const name of requiredGates) {
    if (!VALID_GATE_NAMES.has(name)) {
      issues.push(issue(manifestPath, `unknown required gate ${name}`));
      continue;
    }
    const gate = byName.get(name);
    if (!gate) {
      issues.push(issue(manifestPath, `missing required gate ${name}`));
      continue;
    }
    if (gate.status !== "passed" && gate.status !== "skipped") {
      issues.push(issue(manifestPath, `required gate ${name} is ${gate.status}`));
    }
    if (
      gate.status === "skipped" &&
      (NEVER_SKIPPABLE_GATES.has(name) || !allowSkippedGates.has(name))
    ) {
      issues.push(issue(manifestPath, `required gate ${name} cannot be skipped`));
    }
    if (gate.status === "skipped") {
      validateRequiredSkipReason(gate, manifestPath, { changedFiles, ...sessionContext }, issues);
    }
    if (gate.commit !== currentCommit && gate.verified_commit !== currentCommit) {
      issues.push(issue(manifestPath, `required gate ${name} is stale for current commit`));
    }
  }

  if (requiredGates.includes("review")) {
    const reviewGate = byName.get("review");
    validateReviewLenses(reviewGate, manifestPath, sessionContext, issues);
    validateReviewReportArtifact(reviewGate, manifestPath, artifactRoot, currentCommit, issues);
  }

  return { ok: issues.length === 0, issues };
}

function validateReviewReportArtifact(
  reviewGate,
  manifestPath,
  artifactRoot,
  currentCommit,
  issues
) {
  if (!reviewGate || reviewGate.status !== "passed") return;
  if (reviewGate.evidence_kind === undefined) {
    const artifact = String(reviewGate.artifact || "")
      .split(path.sep)
      .join("/");
    if (/(^|\/)review\/report\.html$/.test(artifact))
      issues.push(
        issue(manifestPath, "canonical review/report.html requires evidence_kind review-report-v1")
      );
    return;
  }
  if (reviewGate.evidence_kind !== "review-report-v1") {
    issues.push(issue(manifestPath, "review evidence_kind must equal review-report-v1"));
    return;
  }
  const htmlPath = resolveArtifactPath(reviewGate.artifact, artifactRoot);
  if (
    path.basename(htmlPath) !== "report.html" ||
    path.basename(path.dirname(htmlPath)) !== "review"
  ) {
    issues.push(issue(manifestPath, "review-report-v1 artifact must point to review/report.html"));
    return;
  }
  const reportPath = path.join(path.dirname(htmlPath), "report.json");
  if (!fs.existsSync(reportPath)) {
    issues.push(issue(manifestPath, "review-report-v1 requires sibling review/report.json"));
    return;
  }
  try {
    const root = path.resolve(artifactRoot || process.cwd());
    const relative = path.relative(root, reportPath).split(path.sep).join("/");
    const { checkReview, expandFromReport } = require("./review-check");
    const result = checkReview(expandFromReport({ root, reportPath: relative, fromReport: true }));
    if (!result.ok)
      issues.push(
        issue(
          manifestPath,
          `review-report-v1 failed current validation: ${result.issues
            .slice(0, 3)
            .map((item) => `${item.path}: ${item.message}`)
            .join("; ")}`
        )
      );
    if (result.report?.source?.commit !== currentCommit || result.report?.outcome !== "passed")
      issues.push(
        issue(manifestPath, "review-report-v1 must be passed and bound to current commit")
      );
  } catch (error) {
    issues.push(issue(manifestPath, `cannot validate review-report-v1: ${error.message}`));
  }
}

// The v1.9 absorption of simplify into review is enforceable, not prose-only:
// M/L/XL sessions must show the review row actually ran the absorbed lenses.
const ABSORBED_REVIEW_LENSES = ["reuse", "quality", "efficiency"];
const LENSED_SIZES = new Set(["m", "l", "xl"]);

function validateReviewLenses(reviewGate, manifestPath, sessionContext, issues) {
  if (!reviewGate || reviewGate.status !== "passed") return;
  if (!LENSED_SIZES.has(sessionContext.sessionSize)) return;
  if (!Array.isArray(reviewGate.lenses)) {
    issues.push(
      issue(
        manifestPath,
        "review row must record lenses for M/L/XL sessions (6-lens fan-out, v1.9)"
      )
    );
    return;
  }
  const have = new Set(reviewGate.lenses.map(normalizeContextValue));
  if (!ABSORBED_REVIEW_LENSES.every((l) => have.has(l))) {
    issues.push(issue(manifestPath, "review lenses must include reuse, quality, efficiency"));
  }
}

function validateGateRow(gate, where, issues, context = {}) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    issues.push(issue(where, "gate row must be an object"));
    return;
  }
  for (const field of REQUIRED_GATE_FIELDS) {
    if (!(field in gate)) issues.push(issue(where, `missing gate field ${field}`));
  }
  if (!VALID_GATE_NAMES.has(gate.name)) {
    issues.push(issue(where, `invalid gate name ${gate.name}`));
  }
  if (!VALID_STATUSES.has(gate.status)) {
    issues.push(issue(where, `invalid gate status ${gate.status}`));
  }
  if (!gate.commit || typeof gate.commit !== "string") {
    issues.push(issue(where, "commit must be a string"));
  }
  if (typeof gate.artifact !== "string") {
    issues.push(issue(where, "artifact must be a string"));
  } else if (gate.status === "passed" && gate.artifact.trim() === "") {
    issues.push(issue(where, "artifact is required when gate passed"));
  } else if (
    gate.status === "passed" &&
    !context.skipArtifactExistence &&
    !artifactExists(gate.artifact, context.artifactRoot || process.cwd())
  ) {
    issues.push(issue(where, `artifact path does not exist: ${gate.artifact}`));
  }
  if (["skipped", "failed", "blocked"].includes(gate.status) && !gate.reason) {
    issues.push(issue(where, "reason is required when gate is skipped, failed, or blocked"));
  }
  if (!gate.checked_at || Number.isNaN(Date.parse(gate.checked_at))) {
    issues.push(issue(where, "checked_at must be an ISO timestamp"));
  }
  if ("verified_commit" in gate && typeof gate.verified_commit !== "string") {
    issues.push(issue(where, "verified_commit must be a string when present"));
  }
  if ("verified_at" in gate && Number.isNaN(Date.parse(gate.verified_at))) {
    issues.push(issue(where, "verified_at must be an ISO timestamp when present"));
  }
  if ("verified_commit" in gate !== "verified_at" in gate) {
    issues.push(issue(where, "verified_commit and verified_at must be written together"));
  }
}

function validateRequiredSkipReason(gate, manifestPath, context, issues) {
  const reason = String(gate.reason || "");
  if (UI_SKIP_GATES.has(gate.name)) {
    validateUiSkipReason(gate, reason, manifestPath, context, issues);
    return;
  }
  if (gate.name === "tdd") {
    validateTddSkipReason(reason, manifestPath, context, issues);
    return;
  }
  if (gate.name === "simplify") {
    validateSimplifySkipReason(reason, manifestPath, context, issues);
  }
}

function validateUiSkipReason(gate, reason, manifestPath, context, issues) {
  const environmentFailure = ENVIRONMENT_SKIP_REASON.test(reason);
  if (environmentFailure) {
    issues.push(
      issue(manifestPath, `required gate ${gate.name} cannot be skipped for environment failure`)
    );
    return;
  }
  if (!NO_UI_SKIP_REASON.test(reason)) {
    issues.push(
      issue(manifestPath, `required gate ${gate.name} skip reason must describe no UI impact`)
    );
  }
  if (hasUiImpact(context.changedFiles)) {
    issues.push(
      issue(
        manifestPath,
        `required gate ${gate.name} cannot be skipped when UI-impact files changed`
      )
    );
  }
}

function validateTddSkipReason(reason, manifestPath, context, issues) {
  if (!TDD_SKIP_REASON.test(reason)) {
    issues.push(issue(manifestPath, "required gate tdd skip reason is not allowed"));
  }
  if (context.changedFiles.length > 0 && !context.changedFiles.every(isTddSkippablePath)) {
    issues.push(
      issue(manifestPath, "required gate tdd cannot be skipped when behavior files changed")
    );
  }
}

function validateSimplifySkipReason(reason, manifestPath, context, issues) {
  if (!SIMPLIFY_SKIP_REASON.test(reason)) {
    issues.push(issue(manifestPath, "required gate simplify skip reason is not allowed"));
  }
  if (/xs size/i.test(reason) && context.sessionSize !== "xs") {
    issues.push(issue(manifestPath, "required gate simplify XS skip requires manifest size XS"));
  }
  const kindMatch = reason.match(/kind (task|bug) uses review gate/i);
  if (kindMatch && context.sessionKind !== kindMatch[1].toLowerCase()) {
    issues.push(
      issue(manifestPath, `required gate simplify kind skip requires manifest kind ${kindMatch[1]}`)
    );
  }
  const noCodeReason = /no code changes|no runtime-source changes|no reviewable source/i.test(
    reason
  );
  if (noCodeReason && context.changedFiles.some(isReviewableSourcePath)) {
    issues.push(
      issue(
        manifestPath,
        "required gate simplify cannot use no-code skip when runtime source files changed"
      )
    );
  }
}

function hasUiImpact(changedFiles) {
  return changedFiles.some(isUiImpactPath);
}

const KB_ARTIFACT_PATH_RE = /^\.?pm\//;

function isUiImpactPath(file) {
  // pm/ (and .pm/) hold PM knowledge-base documents — generated RFC/proposal
  // HTML included. They are read as documents, not shipped as app UI; without
  // this exemption every branch carrying an RFC HTML would force the
  // design-critique gate.
  if (KB_ARTIFACT_PATH_RE.test(file)) return false;
  if (UI_PATH_RE.test(file)) return true;
  if (UI_TOKEN_DATA_RE.test(file)) return true;
  if (UI_TEMPLATE_MARKUP_RE.test(file)) return true;
  if (NEXT_APP_ROUTER_MARKUP_RE.test(file)) return true;
  if (!JS_TS_PATH_RE.test(file)) return false;
  return (
    UI_JS_TS_PATH_RE.test(file) ||
    UI_JS_TS_ENTRY_RE.test(file) ||
    UI_APP_ROOT_RE.test(file) ||
    NEXT_APP_ROUTER_UI_RE.test(file) ||
    ANGULAR_UI_TS_RE.test(file) ||
    UI_ROUTER_JS_TS_RE.test(file) ||
    UI_SINGLE_APP_STATE_RE.test(file) ||
    UI_CONFIG_RE.test(file)
  );
}

function artifactExists(artifact, artifactRoot) {
  const filePath = resolveArtifactPath(artifact, artifactRoot);
  return filePath !== "" && fs.existsSync(filePath);
}

function resolveArtifactPath(artifact, artifactRoot) {
  const raw = String(artifact || "").trim();
  const withoutFragment = raw.split("#")[0].trim();
  if (withoutFragment === "") return "";
  return path.isAbsolute(withoutFragment)
    ? withoutFragment
    : path.resolve(artifactRoot || process.cwd(), withoutFragment);
}

function isTddSkippablePath(file) {
  if (isPmRuntimePath(file)) return false;
  if (isUiImpactPath(file)) return false;
  return DOC_OR_CONFIG_PATH_RE.test(file) || GENERATED_PATH_RE.test(file);
}

function isReviewableSourcePath(file) {
  if (isPmRuntimePath(file)) return true;
  if (GENERATED_PATH_RE.test(file)) return false;
  if (isUiImpactPath(file)) return true;
  return CODE_PATH_RE.test(file);
}

function isPmRuntimePath(file) {
  return PM_RUNTIME_PATH_RE.test(file) || PM_RUNTIME_FILE_RE.test(file);
}

function readSessionContext(manifest, opts) {
  const context = manifest.context && typeof manifest.context === "object" ? manifest.context : {};
  return {
    sessionSize: normalizeContextValue(
      opts.sessionSize || opts.size || manifest.size || manifest.session_size || context.size
    ),
    sessionKind: normalizeContextValue(
      opts.sessionKind || opts.kind || manifest.kind || manifest.session_kind || context.kind
    ),
  };
}

function normalizeContextValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeGateNames(value) {
  const names = Array.isArray(value) ? value : String(value || "").split(",");
  return names
    .flatMap((name) => String(name).split(","))
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeChangedFiles(value) {
  const files = Array.isArray(value) ? value : String(value || "").split(",");
  return files
    .flatMap((file) => String(file).split(","))
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.split(path.sep).join("/"));
}

function loadGateManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadChangedFilesFromGit(baseRef, cwd = process.cwd(), targetRef = "HEAD") {
  const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...${targetRef}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return normalizeChangedFiles(output.split(/\r?\n/));
}

function currentGitCommit(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  const opts = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    requiredGates: [],
    allowSkippedGates: DEFAULT_ALLOW_SKIPPED_GATES,
    changedFiles: [],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      opts.manifestPath = requireValue(argv, ++index, arg);
    } else if (arg === "--commit") {
      opts.currentCommit = requireValue(argv, ++index, arg);
    } else if (arg === "--run-id") {
      opts.runId = requireValue(argv, ++index, arg);
    } else if (arg === "--require") {
      opts.requiredGates.push(...normalizeGateNames(requireValue(argv, ++index, arg)));
    } else if (arg === "--allow-skip") {
      const gateNames = normalizeGateNames(requireValue(argv, ++index, arg));
      for (const gateName of gateNames) {
        if (NEVER_SKIPPABLE_GATES.has(gateName)) {
          throw new Error(`${arg} cannot include non-skippable gate ${gateName}`);
        }
      }
      opts.allowSkippedGates.push(...gateNames);
    } else if (arg === "--no-skip") {
      opts.allowSkippedGates = [];
    } else if (arg === "--base") {
      opts.baseRef = requireValue(argv, ++index, arg);
    } else if (arg === "--changed-file") {
      opts.changedFiles.push(requireValue(argv, ++index, arg));
    } else if (arg === "--changed-files") {
      opts.changedFiles.push(...normalizeChangedFiles(requireValue(argv, ++index, arg)));
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  if (opts.requiredGates.length === 0) {
    opts.requiredGates = DEFAULT_REQUIRED_GATES;
  }
  return opts;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function usage() {
  return [
    "Usage: node scripts/dev-gate-check.js [--manifest PATH] [--run-id ID] [--commit SHA] [--base REF] [--changed-files file[,file]] [--changed-file file] [--require gate[,gate]] [--allow-skip gate[,gate]] [--no-skip] [--json]",
    "",
    "Default manifest: .pm/dev-sessions/current.gates.json",
    `Default required gates: ${DEFAULT_REQUIRED_GATES.join(", ")}`,
    `Default skip-allowed gates: ${DEFAULT_ALLOW_SKIPPED_GATES.join(", ")}`,
  ].join("\n");
}

// These four helpers are intentionally NOT pulled from scripts/lib/check-cli.js
// (where rfc-sidecar-check.js gets them). .githooks/pre-push runs THIS file as an
// isolated `git show` copy in /tmp, so any repo-relative require() would resolve
// against /tmp and fail — breaking every PM push. Keep dev-gate-check.js
// dependency-free (node builtins only). Duplicating ~20 trivial lines is the
// cheaper trade than teaching the hook to carry this file's dependency tree.
function issue(file, message) {
  return { file: toRel(file), message };
}

function toRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/") || file;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.ok) {
    process.stdout.write("Dev gate check passed.\n");
    return;
  }
  process.stdout.write("Dev gate check failed:\n");
  for (const found of result.issues) {
    process.stdout.write(`- ${found.file}: ${found.message}\n`);
  }
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(usage() + "\n");
      return 0;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return 2;
  }

  const manifestPath = path.resolve(opts.manifestPath);
  let currentCommit;
  try {
    currentCommit = opts.currentCommit || currentGitCommit(process.cwd());
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(process.cwd(), `unable to determine current git commit: ${err.message}`)],
    };
    printResult(result, opts.json);
    return 1;
  }
  let manifest;
  try {
    manifest = loadGateManifest(manifestPath);
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(manifestPath, `unable to read gate manifest: ${err.message}`)],
    };
    printResult(result, opts.json);
    return 1;
  }
  let changedFiles = opts.changedFiles;
  if (opts.baseRef) {
    try {
      changedFiles = loadChangedFilesFromGit(opts.baseRef, process.cwd(), currentCommit);
    } catch (err) {
      const result = {
        ok: false,
        issues: [issue(process.cwd(), `unable to determine changed files: ${err.message}`)],
      };
      printResult(result, opts.json);
      return 1;
    }
  }

  const result = checkGateManifest(manifest, {
    currentCommit,
    manifestPath,
    requiredGates: opts.requiredGates,
    allowSkippedGates: opts.allowSkippedGates,
    changedFiles,
    runId: opts.runId || readSiblingRunId(manifestPath),
  });
  printResult(result, opts.json);
  return result.ok ? 0 : 1;
}

function readSiblingRunId(manifestPath) {
  if (path.basename(manifestPath) !== "gates.json") return null;
  try {
    const session = JSON.parse(
      fs.readFileSync(path.join(path.dirname(manifestPath), "session.json"), "utf8")
    );
    return typeof session.run_id === "string" ? session.run_id : null;
  } catch {
    return null;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DEFAULT_ALLOW_SKIPPED_GATES,
  DEFAULT_REQUIRED_GATES,
  checkGateManifest,
  deriveSessionSlug,
  loadChangedFilesFromGit,
  loadGateManifest,
  normalizeChangedFiles,
  parseArgs,
  currentGitCommit,
  main,
};
