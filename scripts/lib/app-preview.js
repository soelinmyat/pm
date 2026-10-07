"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitExec, trustedDiffArgs } = require("./git-env");
const { isGitObjectId } = require("./git-object-id");
const { isRfc3339DateTime } = require("./iso-time");
const { readProjectInput } = require("./safe-project-output");
const { writeProjectFileAtomic } = require("./project-atomic-write");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TREE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 128;
const CANDIDATE_FIELDS = [
  "schema_version",
  "mode",
  "source",
  "reviewed_starting_code",
  "fixtures",
  "launch",
  "journeys",
  "capture",
];
const OBSERVATION_FIELDS = [
  "receipt",
  "capture_id",
  "input_sha256",
  "recorded_at",
  "observer",
  "backend_certified",
  "journeys",
];

// Roots are caller-supplied execution context, never portable identity fields.
function resolveSourceRoot(identity, options) {
  const explicit =
    options.sourceRoot ||
    options.previewSourceRoot ||
    options.previewSourceRoots?.[identity.source.repository];
  if (explicit) return root(explicit, "preview source root");
  if (options.repoRoot) {
    const candidate = root(options.repoRoot, "artifact repository root");
    try {
      if (git(candidate, "rev-parse", "HEAD") === identity.source.head_commit) return candidate;
    } catch {
      // A separate artifact repository cannot infer a consumer from disk paths.
    }
  }
  throw new Error(
    `app_preview source root must be explicitly supplied for source repository ${identity.source.repository}`
  );
}

function prepareAppPreview(config, options = {}) {
  exact(
    config,
    ["repository", "base_commit", "reviewed_paths", "fixture_directory", "launch", "journeys"],
    "preview config"
  );
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(config.repository || ""))
    throw new Error("preview repository must be a portable logical ID");
  if (!isGitObjectId(config.base_commit))
    throw new Error("preview base_commit must be a full Git object ID");
  const sourceRoot = root(options.sourceRoot || options.previewSourceRoot, "preview source root");
  relative(config.fixture_directory, "fixture directory");
  const source = sourceIdentity(
    sourceRoot,
    config.repository,
    config.base_commit,
    config.fixture_directory
  );
  const reviewed = reviewedCode(
    sourceRoot,
    source,
    config.reviewed_paths,
    config.fixture_directory
  );
  const fixtures = fixtureIdentity(sourceRoot, config.fixture_directory);
  const launch = validateLaunch(config.launch, config.fixture_directory, sourceRoot);
  validateJourneys(config.journeys);
  const candidate = {
    schema_version: 1,
    mode: "in-app",
    source,
    reviewed_starting_code: reviewed,
    fixtures,
    launch: structuredClone(launch),
    journeys: structuredClone(config.journeys),
    capture: { id: crypto.randomUUID(), started_at: new Date().toISOString(), input_sha256: null },
  };
  candidate.capture.input_sha256 = inputHash(candidate);
  verifyCandidate(candidate, { ...options, sourceRoot });
  return candidate;
}

function completeAppPreview(candidate, observations, options = {}) {
  verifyCandidate(candidate, options);
  validateObservations(candidate, observations);
  const repoRoot = root(options.repoRoot, "artifact repository root");
  const { receipt, ...attestation } = observations;
  const receiptBytes = read(repoRoot, receipt, "observation receipt");
  let parsed;
  try {
    parsed = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("observation receipt must contain valid JSON");
  }
  if (canonical(parsed) !== canonical(attestation))
    throw new Error("observation receipt does not match attested journey/state bytes");
  const evidencePaths = [
    ...new Set([
      receipt,
      ...observations.journeys.flatMap((journey) => journey.states.map((state) => state.evidence)),
    ]),
  ].sort();
  const evidence = evidenceIdentity(repoRoot, evidencePaths);
  const identity = {
    ...structuredClone(candidate),
    observations: structuredClone(observations),
    evidence,
    sha256: null,
  };
  identity.sha256 = identityHash(identity);
  verifyAppPreviewIdentity(identity, options);
  return identity;
}

function validateAppPreviewIdentity(identity, label = "app_preview") {
  exact(identity, [...CANDIDATE_FIELDS, "observations", "evidence", "sha256"], label);
  validateCandidate(identity, label, false);
  validateObservations(identity, identity.observations);
  validateEntries(identity.evidence, `${label}.evidence`);
  const expected = [
    ...new Set([
      identity.observations.receipt,
      ...identity.observations.journeys.flatMap((journey) =>
        journey.states.map((state) => state.evidence)
      ),
    ]),
  ].sort();
  if (canonical(identity.evidence.map((entry) => entry.path)) !== canonical(expected))
    throw new Error(`${label}.evidence must cover exactly the attested receipt and state evidence`);
  if (identity.sha256 !== identityHash(identity))
    throw new Error(
      `${label} identity hash does not match its source/fixture/launch/state binding`
    );
  return identity;
}

function verifyAppPreviewIdentity(identity, options = {}) {
  validateAppPreviewIdentity(identity);
  verifyCandidate(identity, options, false);
  const repoRoot = root(options.repoRoot, "artifact repository root");
  if (
    canonical(
      evidenceIdentity(
        repoRoot,
        identity.evidence.map((entry) => entry.path)
      )
    ) !== canonical(identity.evidence)
  )
    throw new Error("app_preview observation evidence drift");
  const { receipt, ...attestation } = identity.observations;
  const actual = JSON.parse(read(repoRoot, receipt, "observation receipt").toString("utf8"));
  if (canonical(actual) !== canonical(attestation))
    throw new Error("app_preview observation receipt drift");
  return true;
}

function appPreviewVerificationKey(identity, options) {
  const artifactRoot = root(options.repoRoot, "artifact repository root");
  const sourceRoot = resolveSourceRoot(identity, options);
  return canonical({ identity, artifactRoot, sourceRoot });
}

// Artifact handoff preserves only the attested observations. Consumer source and
// mock fixtures remain in their explicitly supplied source worktree.
function transferAppPreviewEvidence(identity, options = {}) {
  verifyAppPreviewIdentity(identity, options);
  const artifactRoot = root(options.repoRoot, "artifact repository root");
  const targetRoot = root(options.targetRoot, "artifact evidence target root");
  if (artifactRoot === targetRoot) throw new Error("preview evidence target must be separate");
  let total = 0;
  const files = identity.evidence.map((entry) => {
    if (
      within(entry.path, identity.fixtures.directory) ||
      identity.reviewed_starting_code.some((source) => source.path === entry.path)
    )
      throw new Error("preview evidence transfer cannot include consumer source or fixtures");
    const bytes = read(artifactRoot, entry.path, "observation evidence");
    total += bytes.length;
    if (total > MAX_TREE_BYTES) throw new Error("observation evidence exceeds bounded byte count");
    if (hash(bytes) !== entry.sha256) throw new Error("app_preview observation evidence drift");
    return { ...entry, bytes };
  });
  for (const file of files) {
    writeProjectFileAtomic(targetRoot, file.path, file.bytes, {
      maxBytes: MAX_FILE_BYTES,
      replace: false,
      acceptIdentical: true,
      fileMode: 0o600,
      directoryMode: 0o700,
    });
  }
  verifyAppPreviewIdentity(identity, { ...options, repoRoot: targetRoot });
  return true;
}

// Adoption transfers only the reviewed committed delta, never mocked fixture bytes.
// It intentionally stages changes without claiming backend integration or committing.
function adoptAppPreview(identity, options = {}) {
  verifyAppPreviewIdentity(identity, options);
  const sourceRoot = resolveSourceRoot(identity, options);
  const targetRoot = root(options.targetRoot, "adoption target root");
  if (sourceRoot === targetRoot)
    throw new Error("adoption target must be a separate isolated Dev worktree");
  assertIsolated(targetRoot);
  if (git(targetRoot, "rev-parse", "HEAD") !== identity.source.base_commit)
    throw new Error("adoption target must be at the exact preview base_commit");
  if (git(targetRoot, "status", "--porcelain", "--untracked-files=all"))
    throw new Error("adoption target must be clean before applying reviewed starting code");
  const patch = gitExec(
    sourceRoot,
    trustedDiffArgs(
      "--binary",
      "--full-index",
      "--no-renames",
      identity.source.base_commit,
      identity.source.head_commit,
      "--",
      ...identity.reviewed_starting_code.map((entry) => entry.path)
    ),
    null
  );
  if (patch.length === 0 || patch.length > MAX_TREE_BYTES)
    throw new Error("reviewed starting code patch must be non-empty and bounded");
  gitExec(targetRoot, ["apply", "--check", "--index", "--whitespace=nowarn", "-"], "utf8", patch);
  gitExec(targetRoot, ["apply", "--index", "--whitespace=nowarn", "-"], "utf8", patch);
  return {
    base_commit: identity.source.base_commit,
    source_commit: identity.source.head_commit,
    preview_sha256: identity.sha256,
    reviewed_paths: identity.reviewed_starting_code.map((entry) => entry.path),
    excluded_fixture_directory: identity.fixtures.directory,
    patch_sha256: hash(patch),
    backend_certified: false,
  };
}

function verifyCandidate(candidate, options, strict = true) {
  validateCandidate(candidate, "app_preview", strict);
  const sourceRoot = resolveSourceRoot(candidate, options);
  const current = sourceIdentity(
    sourceRoot,
    candidate.source.repository,
    candidate.source.base_commit,
    candidate.fixtures.directory
  );
  if (canonical(current) !== canonical(candidate.source))
    throw new Error("app_preview source repository/commit/tree drift");
  if (
    canonical(
      reviewedCode(
        sourceRoot,
        current,
        candidate.reviewed_starting_code.map((entry) => entry.path),
        candidate.fixtures.directory
      )
    ) !== canonical(candidate.reviewed_starting_code)
  )
    throw new Error("app_preview reviewed starting code drift");
  if (
    canonical(fixtureIdentity(sourceRoot, candidate.fixtures.directory)) !==
    canonical(candidate.fixtures)
  )
    throw new Error("app_preview fixture drift");
  validateLaunch(candidate.launch, candidate.fixtures.directory, sourceRoot);
}

function validateCandidate(candidate, label, strict = true) {
  if (strict) exact(candidate, CANDIDATE_FIELDS, label);
  if (candidate.schema_version !== 1 || candidate.mode !== "in-app")
    throw new Error(`${label} requires schema_version 1 and mode in-app`);
  exact(candidate.source, ["repository", "base_commit", "head_commit", "tree"], `${label}.source`);
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(candidate.source.repository || ""))
    throw new Error(`${label}.source.repository must be a portable logical ID`);
  for (const key of ["base_commit", "head_commit", "tree"])
    if (!isGitObjectId(candidate.source[key]))
      throw new Error(`${label}.source.${key} must be a full Git object ID`);
  validateEntries(candidate.reviewed_starting_code, `${label}.reviewed_starting_code`, true);
  exact(candidate.fixtures, ["directory", "files", "sha256"], `${label}.fixtures`);
  relative(candidate.fixtures.directory, "fixture directory");
  validateEntries(candidate.fixtures.files, `${label}.fixtures.files`);
  if (candidate.fixtures.sha256 !== hash(canonical(candidate.fixtures.files)))
    throw new Error(`${label}.fixtures hash mismatch`);
  for (const entry of candidate.reviewed_starting_code)
    if (within(entry.path, candidate.fixtures.directory))
      throw new Error(`${label} reviewed starting code cannot include fixture paths`);
  validateLaunch(candidate.launch, candidate.fixtures.directory);
  validateJourneys(candidate.journeys);
  exact(candidate.capture, ["id", "started_at", "input_sha256"], `${label}.capture`);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      candidate.capture.id || ""
    )
  )
    throw new Error(`${label}.capture requires a producer capture UUID`);
  date(candidate.capture.started_at, `${label}.capture.started_at`);
  if (candidate.capture.input_sha256 !== inputHash(candidate))
    throw new Error(`${label} capture input hash mismatch`);
}

function validateObservations(candidate, observations) {
  exact(observations, OBSERVATION_FIELDS, "app_preview observations");
  relative(observations.receipt, "observation receipt");
  if (
    observations.capture_id !== candidate.capture.id ||
    observations.input_sha256 !== candidate.capture.input_sha256
  )
    throw new Error("observations are replayed from a different capture/input");
  date(observations.recorded_at, "observation recorded_at");
  if (Date.parse(observations.recorded_at) < Date.parse(candidate.capture.started_at))
    throw new Error("stale observations predate the preview capture");
  if (!text(observations.observer)) throw new Error("observation observer is required");
  if (observations.backend_certified !== false)
    throw new Error("mocked preview cannot claim backend certification");
  if (
    !Array.isArray(observations.journeys) ||
    observations.journeys.length !== candidate.journeys.length
  )
    throw new Error("observations require exactly the declared journeys");
  const ids = new Set();
  for (const journey of observations.journeys) {
    exact(journey, ["id", "steps", "states"], "observed journey");
    const declared = candidate.journeys.find((entry) => entry.id === journey.id);
    if (!declared || ids.has(journey.id))
      throw new Error("observations contain unknown or duplicate journey");
    ids.add(journey.id);
    strings(journey.steps, "executed journey steps");
    if (!Array.isArray(journey.states) || journey.states.length !== declared.required_states.length)
      throw new Error(`journey ${journey.id} requires exactly all declared states`);
    const states = new Set();
    for (const state of journey.states) {
      exact(state, ["id", "evidence"], "observed state");
      if (!declared.required_states.includes(state.id) || states.has(state.id))
        throw new Error(`journey ${journey.id} contains unknown or duplicate state`);
      states.add(state.id);
      relative(state.evidence, "state evidence path");
      if (state.evidence === observations.receipt)
        throw new Error("state evidence must be distinct from the workflow observation receipt");
    }
  }
}

function sourceIdentity(sourceRoot, repository, base, fixtureDirectory) {
  assertIsolated(sourceRoot);
  if (git(sourceRoot, "rev-parse", "--show-toplevel") !== sourceRoot)
    throw new Error("preview source root must be the exact consumer Git root");
  if (git(sourceRoot, "rev-parse", `${base}^{commit}`) !== base)
    throw new Error("preview base_commit must resolve exactly");
  git(sourceRoot, "merge-base", "--is-ancestor", base, "HEAD");
  const flags = git(sourceRoot, "ls-files", "-v", "-z").split("\0").filter(Boolean);
  if (flags.some((entry) => /^[a-zS]/.test(entry)))
    throw new Error(
      "preview source index cannot hide changes with assume-unchanged or skip-worktree"
    );
  const status = git(
    sourceRoot,
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none"
  );
  if (
    status
      .split("\0")
      .filter(Boolean)
      .some((line) => !(line.startsWith("?? ") && within(line.slice(3), fixtureDirectory)))
  )
    throw new Error("preview source worktree must be clean; commit reviewed source before capture");
  return {
    repository,
    base_commit: base,
    head_commit: git(sourceRoot, "rev-parse", "HEAD"),
    tree: git(sourceRoot, "rev-parse", "HEAD^{tree}"),
  };
}

function assertIsolated(sourceRoot) {
  const gitDir = path.resolve(sourceRoot, git(sourceRoot, "rev-parse", "--git-dir"));
  const commonDir = path.resolve(sourceRoot, git(sourceRoot, "rev-parse", "--git-common-dir"));
  if (gitDir === commonDir)
    throw new Error("preview requires an isolated linked consumer worktree, not its main checkout");
}

function reviewedCode(sourceRoot, source, paths, fixtureDirectory) {
  strings(paths, "reviewed paths");
  for (const file of paths) relative(file, "reviewed path");
  const changed = git(
    sourceRoot,
    ...trustedDiffArgs("--name-only", "--no-renames", "-z", source.base_commit, source.head_commit)
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (canonical([...paths].sort()) !== canonical(changed))
    throw new Error("reviewed paths must cover exactly the committed preview source changes");
  const records = new Map(
    git(sourceRoot, "ls-tree", "-z", source.head_commit, "--", ...paths)
      .split("\0")
      .filter(Boolean)
      .map((record) => [record.slice(record.indexOf("\t") + 1), record])
  );
  return [...paths].sort().map((file) => {
    if (within(file, fixtureDirectory))
      throw new Error("reviewed code cannot include mock fixture directory");
    const record = records.get(file);
    if (!record) return { path: file, sha256: null, deleted: true };
    if (!record.startsWith("100644 blob ") && !record.startsWith("100755 blob "))
      throw new Error(`reviewed path must be a regular source file: ${file}`);
    return {
      path: file,
      sha256: hash(read(sourceRoot, file, "reviewed starting code")),
      deleted: false,
    };
  });
}

function fixtureIdentity(sourceRoot, directory) {
  if (git(sourceRoot, "ls-files", "-z", "--", directory))
    throw new Error("fixture directory must stay separate from committed production source");
  const files = [];
  let total = 0;
  function walk(relativeDirectory, depth) {
    if (depth > 8) throw new Error("fixture tree exceeds bounded directory depth");
    const absolute = safeDirectory(sourceRoot, relativeDirectory);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("fixture directory cannot contain symbolic links or non-directories");
    const children = fs.readdirSync(absolute).sort();
    if (children.length > MAX_FILES)
      throw new Error("fixture directory exceeds bounded entry count");
    for (const child of children) {
      const file = `${relativeDirectory}/${child}`;
      relative(file, "fixture path");
      const entry = fs.lstatSync(path.join(sourceRoot, file));
      if (entry.isSymbolicLink()) throw new Error(`fixture cannot contain symbolic link ${file}`);
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.isFile()) {
        const bytes = read(sourceRoot, file, "fixture file");
        total += bytes.length;
        files.push({ path: file.slice(directory.length + 1), sha256: hash(bytes) });
        if (files.length > MAX_FILES || total > MAX_TREE_BYTES)
          throw new Error("fixture tree exceeds bounded file/byte count");
      } else throw new Error(`fixture contains a non-regular file ${file}`);
    }
  }
  walk(directory, 0);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (files.length === 0) throw new Error("preview requires realistic fixture files");
  return { directory, files, sha256: hash(canonical(files)) };
}

function safeDirectory(repoRoot, directory) {
  let current = repoRoot;
  for (const component of directory.split("/")) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("fixture directory cannot traverse symbolic links or non-directories");
  }
  return current;
}

function evidenceIdentity(repoRoot, files) {
  if (files.length > MAX_FILES) throw new Error("observation evidence exceeds bounded file count");
  let total = 0;
  return files.map((file) => {
    const bytes = read(repoRoot, file, "observation evidence");
    total += bytes.length;
    if (total > MAX_TREE_BYTES) throw new Error("observation evidence exceeds bounded byte count");
    return { path: file, sha256: hash(bytes) };
  });
}

function validateLaunch(launch, fixtureDirectory, sourceRoot) {
  exact(launch, ["executable", "args", "cwd", "url", "env"], "preview launch");
  if (!["node", "npm", "pnpm", "yarn", "bun"].includes(launch.executable))
    throw new Error(
      "preview launch requires a structured supported executable; shell text is refused"
    );
  strings(launch.args, "launch args", false);
  if (launch.args.some(hasControl))
    throw new Error("launch args cannot contain control characters");
  if (launch.cwd !== ".") relative(launch.cwd, "launch cwd");
  let url;
  try {
    url = new URL(launch.url);
  } catch {
    throw new Error("preview launch URL is invalid");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("preview launch URL must use HTTP on a loopback host");
  if (
    !object(launch.env) ||
    launch.env.PM_PREVIEW_FIXTURES !== fixtureDirectory ||
    Object.keys(launch.env).some(
      (key) =>
        !/^PM_PREVIEW_[A-Z0-9_]+$/.test(key) ||
        !text(launch.env[key]) ||
        hasControl(launch.env[key])
    )
  )
    throw new Error("launch env must explicitly select separate fixtures using PM_PREVIEW_* keys");
  if (launch.executable === "node") {
    relative(launch.args[0], "node launch entry");
    if (sourceRoot) trackedLaunch(sourceRoot, launch.cwd, launch.args[0]);
  } else {
    if (launch.args[0] !== "run" || !/^[a-zA-Z0-9:_-]+$/.test(launch.args[1] || ""))
      throw new Error("package launch must select an explicit package script with run NAME");
    if (sourceRoot) {
      trackedLaunch(sourceRoot, launch.cwd, "package.json");
      const file = launch.cwd === "." ? "package.json" : `${launch.cwd}/package.json`;
      const pkg = JSON.parse(read(sourceRoot, file, "launch package").toString("utf8"));
      if (!text(pkg.scripts?.[launch.args[1]])) throw new Error("launch package script is missing");
    }
  }
  return launch;
}

function trackedLaunch(sourceRoot, cwd, entry) {
  const file = cwd === "." ? entry : `${cwd}/${entry}`;
  const record = git(sourceRoot, "ls-tree", "HEAD", "--", file);
  if (!/^100(644|755) blob /.test(record))
    throw new Error("launch entry must be committed regular source code");
  read(sourceRoot, file, "launch entry");
}

function validateJourneys(journeys) {
  if (!Array.isArray(journeys) || journeys.length === 0 || journeys.length > 16)
    throw new Error("preview requires bounded declared journeys");
  const ids = new Set();
  for (const journey of journeys) {
    exact(journey, ["id", "purpose", "required_states"], "preview journey");
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(journey.id || "") ||
      ids.has(journey.id) ||
      !text(journey.purpose)
    )
      throw new Error("preview journey requires unique portable id and purpose");
    ids.add(journey.id);
    strings(journey.required_states, "required journey states");
    if (journey.required_states.length > 32)
      throw new Error("preview journey state count exceeds bound");
  }
}

function validateEntries(entries, label, reviewed = false) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_FILES)
    throw new Error(`${label} requires bounded files`);
  const seen = new Set();
  for (const entry of entries) {
    exact(entry, reviewed ? ["path", "sha256", "deleted"] : ["path", "sha256"], label);
    relative(entry.path, label);
    if (seen.has(entry.path)) throw new Error(`${label} contains duplicate files`);
    seen.add(entry.path);
    if (reviewed && typeof entry.deleted !== "boolean")
      throw new Error(`${label} requires explicit deleted classification`);
    if (reviewed && entry.deleted && entry.sha256 !== null)
      throw new Error(`${label} deleted files must have null hashes`);
    if (!(reviewed && entry.deleted) && !/^sha256:[a-f0-9]{64}$/.test(entry.sha256 || ""))
      throw new Error(`${label} requires exact file hashes`);
  }
  if (canonical(entries.map((entry) => entry.path)) !== canonical([...seen].sort()))
    throw new Error(`${label} paths must be sorted`);
}

function inputHash(candidate) {
  const input = { ...candidate };
  for (const key of ["capture", "observations", "evidence", "sha256"]) delete input[key];
  return hash(canonical(input));
}

function identityHash(identity) {
  const value = { ...identity };
  delete value.sha256;
  return hash(canonical(value));
}

function read(repoRoot, file, label) {
  relative(file, label);
  try {
    return readProjectInput(repoRoot, file, MAX_FILE_BYTES, { requireStablePath: true }).bytes;
  } catch (error) {
    throw new Error(`${label} cannot be read safely: ${error.message}`);
  }
}

function root(value, label) {
  if (!text(value)) throw new Error(`${label} is required`);
  const absolute = path.resolve(value);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`${label} must be a real directory without a symbolic directory link`);
  return fs.realpathSync(absolute);
}

function relative(value, label) {
  if (
    !text(value) ||
    /[\\*?[\]{}:]/.test(value) ||
    hasControl(value) ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
  )
    throw new Error(`${label} must be one normalized repo-relative path`);
}

function exact(value, fields, label) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} requires exactly ${fields.join(", ")}`);
}

function strings(value, label, unique = true) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => !text(item)) ||
    (unique && new Set(value).size !== value.length)
  )
    throw new Error(`${label} requires non-empty${unique ? " unique" : ""} strings`);
}

function date(value, label) {
  if (!isRfc3339DateTime(value) || Date.parse(value) > Date.now() + 300000)
    throw new Error(`${label} requires a valid non-future timestamp`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
function git(repoRoot, ...args) {
  return gitExec(repoRoot, args).trimEnd();
}
function within(file, directory) {
  return file === directory || file.startsWith(`${directory}/`);
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function hasControl(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  adoptAppPreview,
  appPreviewVerificationKey,
  completeAppPreview,
  prepareAppPreview,
  transferAppPreviewEvidence,
  validateAppPreviewIdentity,
  verifyAppPreviewIdentity,
};
