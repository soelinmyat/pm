#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MANIFEST_PATH = ".pm/dev-sessions/current.gates.json";
const DEFAULT_REQUIRED_GATES = [
  "tdd",
  "simplify",
  "design-critique",
  "qa",
  "review",
  "verification",
];
const VALID_GATE_NAMES = new Set(DEFAULT_REQUIRED_GATES);
const VALID_STATUSES = new Set(["passed", "skipped", "failed", "blocked"]);
const DEFAULT_ALLOW_SKIPPED_GATES = ["tdd", "simplify", "design-critique", "qa"];
const NEVER_SKIPPABLE_GATES = new Set(["review", "verification"]);
const REQUIRED_GATE_FIELDS = ["name", "status", "commit", "artifact", "reason", "checked_at"];
const SESSION_BRANCH_PREFIXES = ["codex/", "feat/", "fix/", "chore/", "release/"];
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
  if (!Array.isArray(manifest.gates)) {
    issues.push(issue(manifestPath, "gates must be an array"));
    return { ok: false, issues };
  }
  const sessionContext = readSessionContext(manifest, opts);

  const byName = new Map();
  manifest.gates.forEach((gate, index) => {
    const where = `${manifestPath}#gates[${index}]`;
    validateGateRow(gate, where, issues, { artifactRoot });
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) return;
    if (byName.has(gate.name)) {
      issues.push(issue(where, `duplicate gate ${gate.name}`));
      return;
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

  return { ok: issues.length === 0, issues };
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

function isUiImpactPath(file) {
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

function deriveSessionSlug(branchName) {
  let slug = String(branchName || "").trim();
  for (const prefix of SESSION_BRANCH_PREFIXES) {
    if (slug.startsWith(prefix)) {
      slug = slug.slice(prefix.length);
      break;
    }
  }
  slug = slug.replace(/\//g, "-");
  return slug || "current";
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
    "Usage: node scripts/dev-gate-check.js [--manifest PATH] [--commit SHA] [--base REF] [--changed-files file[,file]] [--changed-file file] [--require gate[,gate]] [--allow-skip gate[,gate]] [--no-skip] [--json]",
    "",
    "Default manifest: .pm/dev-sessions/current.gates.json",
    `Default required gates: ${DEFAULT_REQUIRED_GATES.join(", ")}`,
    `Default skip-allowed gates: ${DEFAULT_ALLOW_SKIPPED_GATES.join(", ")}`,
  ].join("\n");
}

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
  });
  printResult(result, opts.json);
  return result.ok ? 0 : 1;
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
