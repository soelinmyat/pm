"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { resolvePmDir, resolvePmPaths, tryConfigBased } = require("../scripts/resolve-pm-dir.js");

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

test("resolvePmDir: pm_repo points to nonexistent dir → fallback", () => {
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
    const result = resolvePmDir(project.root, { gitCommonDir: noWorktree });
    assert.equal(result, path.join(project.root, "pm"));
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
  } finally {
    project.cleanup();
  }
});

// --- CLI --json flag ---

test("CLI: --json prints both pmDir and pmStateDir", () => {
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
  } finally {
    project.cleanup();
    kb.cleanup();
  }
});

test("tryConfigBased: malformed JSON → null", () => {
  const project = makeTmp("pm-resolve-bad-");
  try {
    project.mkdir(".pm");
    project.write(".pm/config.json", "{not valid json");
    assert.equal(tryConfigBased(project.root), null);
  } finally {
    project.cleanup();
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
