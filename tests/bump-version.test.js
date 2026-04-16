const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");

describe("bump-version.js", () => {
  it("script exists and is valid JS", () => {
    const scriptPath = path.join(repoRoot, "scripts", "bump-version.js");
    assert.ok(fs.existsSync(scriptPath), "scripts/bump-version.js must exist");
    // Require without executing (arg check exits early)
    const src = fs.readFileSync(scriptPath, "utf8");
    assert.ok(src.includes("plugin.config.json"), "must read plugin.config.json");
    assert.ok(
      src.includes("generate-platform-files.js"),
      "must run generate-platform-files.js to sync manifests"
    );
    assert.ok(src.includes("git tag"), "must create a git tag");
  });

  it("all 4 version files reference the same version", () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugin.config.json"), "utf8"));
    const claude = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")
    );
    const codex = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8")
    );
    const marketplace = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8")
    );

    const expected = config.version;
    assert.equal(claude.version, expected, ".claude-plugin/plugin.json version mismatch");
    assert.equal(codex.version, expected, ".codex-plugin/plugin.json version mismatch");
    assert.equal(
      marketplace.plugins[0].version,
      expected,
      ".claude-plugin/marketplace.json version mismatch"
    );
  });

  it("npm run bump is defined in package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    assert.ok(pkg.scripts.bump, "package.json must have a bump script");
    assert.ok(pkg.scripts.bump.includes("bump-version.js"), "bump script must run bump-version.js");
  });
});
