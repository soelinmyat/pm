"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  resolvePmDir,
  resolvePmPaths,
  tryConfigBased,
  _clearCache,
} = require("../scripts/resolve-pm-dir.js");

// Cache pollution across tests is benign in practice (each test uses a fresh
// mkdtemp path) but flush before each test to keep failures local.
test.beforeEach(() => _clearCache());

const HELPER_PATH = path.join(__dirname, "..", "scripts", "resolve-pm-dir.js");

function makeTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root: fs.realpathSync(root),
    write(relPath, content) {
      const full = path.join(this.root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return full;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(this.root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(this.root, { recursive: true, force: true });
    },
  };
}

// Stub gitCommonDir injector that always reports "not in a worktree"
const noWorktree = () => null;

// --- Direct (no worktree) cases ---

test("resolvePmDir: no config, no worktree → returns projectDir/pm", () => {
  const project = makeTmp("pm-resolve-a-");
  try {
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmPaths: no config permits a structured same-repo fallback", () => {
  const project = makeTmp("pm-resolve-absent-");
  try {
    assert.deepEqual(resolvePmPaths(project.root, { gitCommonDir: noWorktree }), {
      ok: true,
      pmDir: path.join(project.root, "pm"),
      pmStateDir: path.join(project.root, ".pm"),
      sourceDir: project.root,
      mode: "same-repo",
      configPath: null,
      warnings: [],
    });
  } finally {
    project.cleanup();
  }
});

test("resolvePmPaths: malformed config fails closed instead of falling back", () => {
  const project = makeTmp("pm-resolve-malformed-");
  try {
    project.write(".pm/config.json", "{not valid json");
    assert.throws(
      () => resolvePmPaths(project.root, { gitCommonDir: noWorktree }),
      new RegExp(`Invalid JSON.*${path.basename(project.root)}.*\\.pm/config\\.json`)
    );
    assert.equal(fs.existsSync(path.join(project.root, "pm")), false);
  } finally {
    project.cleanup();
  }
});

test("resolvePmPaths: malformed configured pointer fails closed", () => {
  const project = makeTmp("pm-resolve-malformed-pointer-");
  try {
    project.write(".pm/config.json", JSON.stringify({ config_schema: 2, pm_repo: null }));
    assert.throws(
      () => resolvePmPaths(project.root, { gitCommonDir: noWorktree }),
      /Invalid pm_repo pointer/
    );
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir: direct .pm/config.json with pm_repo wins", () => {
  const project = makeTmp("pm-resolve-direct-");
  const kb = makeTmp("pm-kb-direct-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: kb.root },
      })
    );
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: self-referential config → projectDir/pm", () => {
  const project = makeTmp("pm-resolve-self-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: ".." },
      })
    );
    // ".." from .pm/ resolves back to project.root
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir: pm_repo type 'remote' throws", () => {
  const project = makeTmp("pm-resolve-remote-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "remote", path: "git@github.com:org/repo.git" },
      })
    );
    assert.throws(
      () => resolvePmDir(project.root, { gitCommonDir: noWorktree }),
      /[Rr]emote.*not.*supported/
    );
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir: pm_repo points to nonexistent dir → fails closed", () => {
  const project = makeTmp("pm-resolve-missing-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: "/nonexistent/path/does/not/exist" },
      })
    );
    assert.throws(
      () => resolvePmDir(project.root, { gitCommonDir: noWorktree }),
      /Configured PM repository does not exist/
    );
    assert.equal(fs.existsSync(path.join(project.root, "pm")), false);
  } finally {
    project.cleanup();
  }
});

// --- Worktree-walking cases ---

test("resolvePmDir: worktree with no local config, main repo has pm_repo → resolves via main", () => {
  const mainRepo = makeTmp("pm-resolve-main-");
  const worktree = makeTmp("pm-resolve-wt-");
  const kb = makeTmp("pm-resolve-kb-");
  try {
    mainRepo.mkdir(".pm");
    mainRepo.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: kb.root },
      })
    );
    // Stub gitCommonDir to claim worktree's main repo lives at mainRepo
    const stub = () => path.join(mainRepo.root, ".git");
    const result = resolvePmDir(worktree.root, { gitCommonDir: stub });
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    mainRepo.cleanup();
    worktree.cleanup();
    kb.cleanup();
  }
});

test("resolvePmPaths: worktree main config returns all paths and worktree mode", () => {
  const mainRepo = makeTmp("pm-resolve-main-paths-");
  const worktree = makeTmp("pm-resolve-wt-paths-");
  const kb = makeTmp("pm-resolve-kb-paths-");
  try {
    const configPath = mainRepo.write(
      "pm.config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.mkdir("pm");
    kb.mkdir(".pm");
    const result = resolvePmPaths(worktree.root, {
      gitCommonDir: () => path.join(mainRepo.root, ".git"),
    });
    assert.deepEqual(result, {
      ok: true,
      pmDir: path.join(kb.root, "pm"),
      pmStateDir: path.join(kb.root, ".pm"),
      sourceDir: worktree.root,
      mode: "worktree-main-config",
      configPath,
      warnings: [],
    });
  } finally {
    mainRepo.cleanup();
    worktree.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: worktree with its OWN config wins over main repo's config", () => {
  const mainRepo = makeTmp("pm-resolve-main2-");
  const worktree = makeTmp("pm-resolve-wt2-");
  const kbMain = makeTmp("pm-resolve-kbmain-");
  const kbWt = makeTmp("pm-resolve-kbwt-");
  try {
    mainRepo.mkdir(".pm");
    mainRepo.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kbMain.root } })
    );
    worktree.mkdir(".pm");
    worktree.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kbWt.root } })
    );
    const stub = () => path.join(mainRepo.root, ".git");
    const result = resolvePmDir(worktree.root, { gitCommonDir: stub });
    assert.equal(result, path.join(kbWt.root, "pm"));
  } finally {
    mainRepo.cleanup();
    worktree.cleanup();
    kbMain.cleanup();
    kbWt.cleanup();
  }
});

test("resolvePmDir: worktree, main repo has no separate-repo config → fallback to projectDir/pm", () => {
  const mainRepo = makeTmp("pm-resolve-main3-");
  const worktree = makeTmp("pm-resolve-wt3-");
  try {
    mainRepo.mkdir(".pm");
    mainRepo.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2 }) // no pm_repo
    );
    const stub = () => path.join(mainRepo.root, ".git");
    const result = resolvePmDir(worktree.root, { gitCommonDir: stub });
    assert.equal(result, path.join(worktree.root, "pm"));
  } finally {
    mainRepo.cleanup();
    worktree.cleanup();
  }
});

test("resolvePmDir: worktree, main repo IS the projectDir → no infinite walk-up", () => {
  const repo = makeTmp("pm-resolve-self2-");
  try {
    repo.mkdir(".pm");
    repo.write(".pm/config.json", JSON.stringify({ config_schema: 2 }));
    const stub = () => path.join(repo.root, ".git");
    const result = resolvePmDir(repo.root, { gitCommonDir: stub });
    assert.equal(result, path.join(repo.root, "pm"));
  } finally {
    repo.cleanup();
  }
});

test("resolvePmDir: gitCommonDir returns non-.git path → no walk-up", () => {
  const project = makeTmp("pm-resolve-bare-");
  try {
    // e.g. bare repo where common dir is the repo root itself
    const stub = () => "/some/bare/repo";
    const result = resolvePmDir(project.root, { gitCommonDir: stub });
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

// --- tryConfigBased direct tests ---

// --- Flat vs nested layout ---

test("resolvePmDir: nested layout ({kb}/pm exists) returns nested path", () => {
  const project = makeTmp("pm-resolve-nested-");
  const kb = makeTmp("pm-kb-nested-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.mkdir("pm");
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: flat layout (KB content at root, no pm/ subdir) returns root", () => {
  const project = makeTmp("pm-resolve-flat-");
  const kb = makeTmp("pm-kb-flat-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    // Flat marker at kb root — backlog/ directory signals content lives here
    kb.mkdir("backlog");
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, kb.root);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: flat layout detected via memory.md marker", () => {
  const project = makeTmp("pm-resolve-flat-memory-");
  const kb = makeTmp("pm-kb-flat-memory-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.write("memory.md", "# memory\n");
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, kb.root);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: empty kb (no markers, no pm/) defaults to nested convention", () => {
  const project = makeTmp("pm-resolve-empty-kb-");
  const kb = makeTmp("pm-kb-empty-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    // No content in kb — should default to nested path (backward compat)
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

// --- resolvePmPaths (bundled pmDir + pmStateDir) ---

test("resolvePmPaths: nested layout returns pmStateDir at parent", () => {
  const project = makeTmp("pm-paths-nested-");
  const kb = makeTmp("pm-paths-nested-kb-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.mkdir("pm");
    kb.mkdir(".pm");
    const result = resolvePmPaths(project.root, { gitCommonDir: noWorktree });
    assert.equal(result.pmDir, path.join(kb.root, "pm"));
    assert.equal(result.pmStateDir, path.join(kb.root, ".pm"));
    assert.equal(result.sourceDir, project.root);
    assert.equal(result.mode, "separate-nested");
    assert.equal(result.configPath, path.join(project.root, ".pm", "config.json"));
    assert.deepEqual(result.warnings, []);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmPaths: flat layout returns pmStateDir inside pmDir", () => {
  const project = makeTmp("pm-paths-flat-");
  const kb = makeTmp("pm-paths-flat-kb-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.mkdir("backlog"); // flat marker
    kb.mkdir(".pm"); // state dir at kb root
    const result = resolvePmPaths(project.root, { gitCommonDir: noWorktree });
    assert.equal(result.pmDir, kb.root);
    assert.equal(result.pmStateDir, path.join(kb.root, ".pm"));
    assert.equal(result.sourceDir, project.root);
    assert.equal(result.mode, "separate-flat");
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmPaths: same-repo mode returns {projectDir}/pm + {projectDir}/.pm", () => {
  const project = makeTmp("pm-paths-same-");
  try {
    const result = resolvePmPaths(project.root, { gitCommonDir: noWorktree });
    assert.equal(result.pmDir, path.join(project.root, "pm"));
    assert.equal(result.pmStateDir, path.join(project.root, ".pm"));
    assert.equal(result.sourceDir, project.root);
    assert.equal(result.mode, "same-repo");
  } finally {
    project.cleanup();
  }
});

test("resolvePmPaths: PM-repo source pointer resolves sourceDir centrally", () => {
  const pmRepo = makeTmp("pm-paths-source-pointer-");
  const sourceRepo = makeTmp("pm-paths-source-target-");
  try {
    pmRepo.mkdir("pm");
    pmRepo.mkdir(".pm");
    const configPath = pmRepo.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        source_repo: { type: "local", path: sourceRepo.root },
      })
    );
    assert.deepEqual(resolvePmPaths(pmRepo.root, { gitCommonDir: noWorktree }), {
      ok: true,
      pmDir: path.join(pmRepo.root, "pm"),
      pmStateDir: path.join(pmRepo.root, ".pm"),
      sourceDir: sourceRepo.root,
      mode: "separate-nested",
      configPath,
      warnings: [],
    });
  } finally {
    pmRepo.cleanup();
    sourceRepo.cleanup();
  }
});

test("resolvePmPaths: missing configured source repo fails closed", () => {
  const pmRepo = makeTmp("pm-paths-source-missing-");
  try {
    pmRepo.mkdir("pm");
    pmRepo.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        source_repo: { type: "local", path: "/missing/source/repository" },
      })
    );
    assert.throws(
      () => resolvePmPaths(pmRepo.root, { gitCommonDir: noWorktree }),
      /Configured source repository does not exist/
    );
  } finally {
    pmRepo.cleanup();
  }
});

// --- CLI --json flag ---

test("CLI: --json prints the complete structured path contract", () => {
  const project = makeTmp("pm-resolve-cli-json-");
  const kb = makeTmp("pm-resolve-cli-json-kb-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    kb.mkdir("backlog");
    kb.mkdir(".pm");
    const out = execFileSync("node", [HELPER_PATH, "--json", project.root], {
      encoding: "utf8",
    }).trim();
    const parsed = JSON.parse(out);
    assert.equal(parsed.pmDir, kb.root);
    assert.equal(parsed.pmStateDir, path.join(kb.root, ".pm"));
    assert.equal(parsed.sourceDir, project.root);
    assert.equal(parsed.mode, "separate-flat");
    assert.equal(parsed.configPath, path.join(project.root, ".pm", "config.json"));
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.ok, true);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("tryConfigBased: malformed JSON → throws", () => {
  const project = makeTmp("pm-resolve-bad-");
  try {
    project.mkdir(".pm");
    project.write(".pm/config.json", "{not valid json");
    assert.throws(() => tryConfigBased(project.root), /Invalid JSON/);
  } finally {
    project.cleanup();
  }
});

// --- Flat pm.config.json fallback ---

test("tryConfigBased: flat pm.config.json resolves when no .pm/config.json", () => {
  const project = makeTmp("pm-resolve-flat-config-");
  const kb = makeTmp("pm-kb-flat-config-");
  try {
    project.write(
      "pm.config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: kb.root },
      })
    );
    const result = tryConfigBased(project.root);
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: flat pm.config.json with no .pm/ dir at all", () => {
  const project = makeTmp("pm-resolve-flat-only-");
  const kb = makeTmp("pm-kb-flat-only-");
  try {
    // Deliberately no .pm/ directory in project — flat config is the only marker.
    project.write(
      "pm.config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: kb.root },
      })
    );
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(kb.root, "pm"));
    // Sanity: ensure the resolver did NOT silently create a .pm/ dir.
    assert.equal(fs.existsSync(path.join(project.root, ".pm")), false);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("tryConfigBased: nested .pm/config.json wins when both present, warns once", () => {
  const project = makeTmp("pm-resolve-both-");
  const kbNested = makeTmp("pm-kb-both-nested-");
  const kbFlat = makeTmp("pm-kb-both-flat-");
  // Capture stderr writes
  const origWrite = process.stderr.write.bind(process.stderr);
  const stderrChunks = [];
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kbNested.root } })
    );
    project.write(
      "pm.config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kbFlat.root } })
    );
    // First call resolves and warns
    const r1 = tryConfigBased(project.root);
    assert.equal(r1, path.join(kbNested.root, "pm"));
    // Second call resolves silently (warning is once-per-process-per-root)
    const r2 = tryConfigBased(project.root);
    assert.equal(r2, path.join(kbNested.root, "pm"));
    const joined = stderrChunks.join("");
    assert.match(joined, /both .pm\/config.json and pm.config.json present/);
    const matches = joined.match(/both .pm\/config.json/g) || [];
    assert.equal(matches.length, 1, "expected warning to fire exactly once");
  } finally {
    process.stderr.write = origWrite;
    project.cleanup();
    kbNested.cleanup();
    kbFlat.cleanup();
  }
});

test("resolvePmPaths: both config forms surface the precedence warning", () => {
  const project = makeTmp("pm-resolve-both-structured-");
  const kb = makeTmp("pm-resolve-both-structured-kb-");
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    project.write("pm.config.json", JSON.stringify({ config_schema: 2 }));
    const result = resolvePmPaths(project.root, { gitCommonDir: noWorktree });
    assert.equal(result.configPath, path.join(project.root, ".pm", "config.json"));
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /both \.pm\/config\.json and pm\.config\.json/);
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: worktree, main repo has flat pm.config.json → resolves via main", () => {
  const mainRepo = makeTmp("pm-resolve-flat-main-");
  const worktree = makeTmp("pm-resolve-flat-wt-");
  const kb = makeTmp("pm-resolve-flat-kb-");
  try {
    // Main repo uses flat config (no .pm/ dir at all)
    mainRepo.write(
      "pm.config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb.root } })
    );
    const stub = () => path.join(mainRepo.root, ".git");
    const result = resolvePmDir(worktree.root, { gitCommonDir: stub });
    assert.equal(result, path.join(kb.root, "pm"));
  } finally {
    mainRepo.cleanup();
    worktree.cleanup();
    kb.cleanup();
  }
});

test("resolvePmDir: flat pm.config.json with relative pm_repo path resolves against project root", () => {
  // With nested config, paths are relative to <root>/.pm/. With flat config,
  // paths are relative to <root>/. Migration must adjust path strings.
  const parent = makeTmp("pm-resolve-rel-parent-");
  try {
    fs.mkdirSync(path.join(parent.root, "mono"));
    fs.mkdirSync(path.join(parent.root, "kb"));
    fs.writeFileSync(
      path.join(parent.root, "mono", "pm.config.json"),
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: "../kb" },
      })
    );
    const result = resolvePmDir(path.join(parent.root, "mono"), { gitCommonDir: noWorktree });
    assert.equal(result, path.join(parent.root, "kb", "pm"));
  } finally {
    parent.cleanup();
  }
});

test("tryConfigBased: missing pm_repo field → null", () => {
  const project = makeTmp("pm-resolve-empty-");
  try {
    project.mkdir(".pm");
    project.write(".pm/config.json", JSON.stringify({ config_schema: 2 }));
    assert.equal(tryConfigBased(project.root), null);
  } finally {
    project.cleanup();
  }
});

// --- CLI mode ---

test("CLI: prints resolved pm dir to stdout", () => {
  const project = makeTmp("pm-resolve-cli-");
  const kb = makeTmp("pm-resolve-cli-kb-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: kb.root },
      })
    );
    const out = execFileSync("node", [HELPER_PATH, project.root], {
      encoding: "utf8",
    }).trim();
    assert.equal(out, path.join(kb.root, "pm"));
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("CLI: exits non-zero on remote pm_repo type", () => {
  const project = makeTmp("pm-resolve-cli-remote-");
  try {
    project.mkdir(".pm");
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "remote", path: "x" },
      })
    );
    assert.throws(
      () =>
        execFileSync("node", [HELPER_PATH, project.root], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      /Error|status 1/
    );
  } finally {
    project.cleanup();
  }
});
