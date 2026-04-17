"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const START_STATUS = path.join(__dirname, "..", "scripts", "start-status.js");

// -----------------------------------------------------------------------------
// Goal: verify the CLI output is invariant across environmental variation.
// The skill downstream will invoke this script from different cwds, with or
// without CLAUDE_PLUGIN_ROOT set, against same-repo / separate-repo (nested
// and flat-layout) configurations. If the CLI silently depends on any of
// those, /pm:list breaks in production long after tests pass locally.
//
// Strategy: for each axis of variation, spawn the CLI with the same project
// state under each variant, and compare the structural shape of the output.
// Time-dependent fields (generatedAt, updatedEpoch, ageRelative, staleness)
// and absolute paths (meta.pmDir, meta.sourceDir) vary by design; everything
// else must match.
// -----------------------------------------------------------------------------

function mkProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-list-rows-parity-"));
}

function fm(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) lines.push(`${k}: ${v}`);
  lines.push("---", "");
  return lines.join("\n");
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function runCli(projectDir, { cwd, env } = {}) {
  const stdout = execFileSync(
    "node",
    [START_STATUS, "--project-dir", projectDir, "--format", "list-rows"],
    {
      encoding: "utf8",
      cwd: cwd || projectDir,
      env: env || process.env,
    }
  );
  return JSON.parse(stdout);
}

// Strip the fields that are expected to vary: time-dependent fields and
// absolute paths. Keeps structural identity only.
function stripVariant(payload) {
  const stripRow = (r) => {
    const { updatedEpoch: _ue, ageRelative: _ar, staleness: _st, sourcePath: _sp, ...rest } = r;
    return rest;
  };
  return {
    active: payload.active.map(stripRow),
    proposals: payload.proposals.map(stripRow),
    rfcs: payload.rfcs.map(stripRow),
    shipped: payload.shipped.map(stripRow),
  };
}

function seedStandardTree(projectDir) {
  writeFile(
    projectDir,
    ".pm/groom-sessions/parity-groom.md",
    fm({ topic: "parity-groom", phase: "scope", linear_id: "PM-77" }) + "body"
  );
  writeFile(
    projectDir,
    ".pm/dev-sessions/parity-dev.md",
    "| Ticket | PM-88 |\n| Stage | implement |\n- Next action: continue\n"
  );
  writeFile(
    projectDir,
    "pm/backlog/parity-proposal.md",
    fm({ title: "Parity proposal", status: "planned" }) + "body"
  );
  writeFile(
    projectDir,
    "pm/backlog/parity-rfc.md",
    fm({ title: "Parity RFC", status: "planned", rfc: "rfcs/parity.html" }) + "body"
  );
}

// -----------------------------------------------------------------------------
// Axis 1: cwd variation — project root vs subdirectory vs unrelated path.
// -----------------------------------------------------------------------------

test("parity — cwd at project root vs subdirectory vs unrelated tmp dir", () => {
  const projectDir = mkProject();
  const subDir = path.join(projectDir, "pm", "backlog");
  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), "pm-parity-unrelated-"));
  try {
    seedStandardTree(projectDir);

    const fromRoot = stripVariant(runCli(projectDir, { cwd: projectDir }));
    const fromSub = stripVariant(runCli(projectDir, { cwd: subDir }));
    const fromUnrelated = stripVariant(runCli(projectDir, { cwd: unrelated }));

    assert.deepEqual(fromRoot, fromSub, "root vs sub diverged");
    assert.deepEqual(fromRoot, fromUnrelated, "root vs unrelated-cwd diverged");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(unrelated, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Axis 2: CLAUDE_PLUGIN_ROOT presence — set vs unset vs garbage path.
// The script must ignore this variable entirely (it uses __dirname for its
// own scripts and --project-dir for the target).
// -----------------------------------------------------------------------------

test("parity — CLAUDE_PLUGIN_ROOT set vs unset vs garbage value", () => {
  const projectDir = mkProject();
  try {
    seedStandardTree(projectDir);

    const baseEnv = { ...process.env };
    delete baseEnv.CLAUDE_PLUGIN_ROOT;

    const unset = stripVariant(runCli(projectDir, { env: baseEnv }));
    const set = stripVariant(
      runCli(projectDir, { env: { ...baseEnv, CLAUDE_PLUGIN_ROOT: "/tmp/does-not-exist" } })
    );
    const pointingHere = stripVariant(
      runCli(projectDir, {
        env: { ...baseEnv, CLAUDE_PLUGIN_ROOT: path.join(__dirname, "..") },
      })
    );

    assert.deepEqual(unset, set, "unset vs garbage CLAUDE_PLUGIN_ROOT diverged");
    assert.deepEqual(unset, pointingHere, "unset vs real CLAUDE_PLUGIN_ROOT diverged");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Axis 3: same-repo vs separate-repo (nested layout).
// Content is the same; only the .pm/config.json presence moves the PM dir
// into a sibling kb repo. Active sessions stay on the source side either way.
// -----------------------------------------------------------------------------

test("parity — same-repo and separate-repo (nested) yield identical row shape", () => {
  const sameRepo = mkProject();
  const sourceRepo = mkProject();
  const pmRepo = mkProject();
  try {
    seedStandardTree(sameRepo);

    // Separate-repo: same sessions on source side, same backlog on pm-kb side.
    writeFile(
      sourceRepo,
      ".pm/groom-sessions/parity-groom.md",
      fm({ topic: "parity-groom", phase: "scope", linear_id: "PM-77" }) + "body"
    );
    writeFile(
      sourceRepo,
      ".pm/dev-sessions/parity-dev.md",
      "| Ticket | PM-88 |\n| Stage | implement |\n- Next action: continue\n"
    );
    writeFile(
      sourceRepo,
      ".pm/config.json",
      JSON.stringify({ config_schema: 1, pm_repo: { type: "local", path: pmRepo } })
    );
    writeFile(
      pmRepo,
      "pm/backlog/parity-proposal.md",
      fm({ title: "Parity proposal", status: "planned" }) + "body"
    );
    writeFile(
      pmRepo,
      "pm/backlog/parity-rfc.md",
      fm({ title: "Parity RFC", status: "planned", rfc: "rfcs/parity.html" }) + "body"
    );

    const same = stripVariant(runCli(sameRepo));
    const separate = stripVariant(runCli(sourceRepo));
    assert.deepEqual(same, separate, "same-repo vs separate-repo row shape diverged");
  } finally {
    fs.rmSync(sameRepo, { recursive: true, force: true });
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(pmRepo, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Axis 4: separate-repo nested layout vs flat layout.
// Nested: {pmRepo}/pm/backlog/*.md
// Flat:   {pmRepo}/backlog/*.md
// Both must produce identical row shape for identical content.
// -----------------------------------------------------------------------------

test("parity — separate-repo nested vs flat layout yield identical row shape", () => {
  const sourceNested = mkProject();
  const pmNested = mkProject();
  const sourceFlat = mkProject();
  const pmFlat = mkProject();
  try {
    const seedSource = (dir, pmRepoDir) => {
      writeFile(
        dir,
        ".pm/groom-sessions/parity-groom.md",
        fm({ topic: "parity-groom", phase: "scope", linear_id: "PM-77" }) + "body"
      );
      writeFile(
        dir,
        ".pm/config.json",
        JSON.stringify({ config_schema: 1, pm_repo: { type: "local", path: pmRepoDir } })
      );
    };

    seedSource(sourceNested, pmNested);
    writeFile(
      pmNested,
      "pm/backlog/parity-proposal.md",
      fm({ title: "Parity proposal", status: "planned" }) + "body"
    );

    seedSource(sourceFlat, pmFlat);
    writeFile(
      pmFlat,
      "backlog/parity-proposal.md",
      fm({ title: "Parity proposal", status: "planned" }) + "body"
    );

    const nested = stripVariant(runCli(sourceNested));
    const flat = stripVariant(runCli(sourceFlat));
    assert.deepEqual(nested, flat, "nested vs flat layout row shape diverged");
  } finally {
    for (const d of [sourceNested, pmNested, sourceFlat, pmFlat]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
});

// -----------------------------------------------------------------------------
// Axis 5: invocation via absolute script path vs `node -e` require.
// The skill's step 01 invokes the script by absolute path; we also want a
// consumer that prefers requiring the library to work identically. Covers
// emitListRows() both from the CLI and from a fresh Node runtime.
// -----------------------------------------------------------------------------

test("parity — CLI and programmatic emitListRows() produce the same row shape", () => {
  const projectDir = mkProject();
  try {
    seedStandardTree(projectDir);

    const cli = stripVariant(runCli(projectDir));

    const libStdout = execFileSync(
      "node",
      [
        "-e",
        `const { emitListRows } = require(${JSON.stringify(
          path.join(__dirname, "..", "scripts", "lib", "list-rows.js")
        )}); process.stdout.write(JSON.stringify(emitListRows(${JSON.stringify(projectDir)})));`,
      ],
      { encoding: "utf8" }
    );
    const lib = stripVariant(JSON.parse(libStdout));

    assert.deepEqual(cli, lib, "CLI vs programmatic row shape diverged");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
