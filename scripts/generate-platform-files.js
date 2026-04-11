#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const repoRoot = path.join(__dirname, "..");
const configPath = path.join(repoRoot, "plugin.config.json");
const checkMode = process.argv.includes("--check");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeJson(value));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function listSkillDirs() {
  const skillsRoot = path.join(repoRoot, "skills");
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md"))
    )
    .map((entry) => entry.name)
    .sort();
}

function listCommandFiles() {
  const commandsRoot = path.join(repoRoot, "commands");
  if (!fs.existsSync(commandsRoot)) {
    return [];
  }

  return fs
    .readdirSync(commandsRoot)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
}

function assertCanonicalInventory(config, skillDirs, commandFiles) {
  const configuredSkillSet = new Set([
    ...config.codex.fallbackSkillAliases.pm,
    ...config.codex.fallbackSkillAliases.dev,
  ]);

  const actualSkillSet = new Set(skillDirs);
  const missingSkills = [...configuredSkillSet].filter((name) => !actualSkillSet.has(name));
  const unmappedSkills = skillDirs.filter((name) => !configuredSkillSet.has(name));

  if (missingSkills.length > 0 || unmappedSkills.length > 0) {
    const problems = [];
    if (missingSkills.length > 0) {
      problems.push(`missing skill dirs: ${missingSkills.join(", ")}`);
    }
    if (unmappedSkills.length > 0) {
      problems.push(`unmapped skill dirs: ${unmappedSkills.join(", ")}`);
    }
    throw new Error(
      `plugin.config.json skill aliases are out of sync with skills/: ${problems.join("; ")}`
    );
  }

  const configuredCommandSet = new Set(config.commands.map((name) => `${name}.md`));
  const missingCommands = [...configuredCommandSet].filter((name) => !commandFiles.includes(name));
  const unconfiguredCommands = commandFiles.filter((name) => !configuredCommandSet.has(name));

  if (missingCommands.length > 0 || unconfiguredCommands.length > 0) {
    const problems = [];
    if (missingCommands.length > 0) {
      problems.push(`missing command files: ${missingCommands.join(", ")}`);
    }
    if (unconfiguredCommands.length > 0) {
      problems.push(`unconfigured command files: ${unconfiguredCommands.join(", ")}`);
    }
    throw new Error(
      `plugin.config.json commands are out of sync with commands/: ${problems.join("; ")}`
    );
  }
}

function buildCommonManifest(config) {
  return {
    name: config.name,
    description: config.description,
    version: config.version,
    author: {
      name: config.author.name,
    },
    homepage: config.homepage,
    repository: config.repository,
    license: config.license,
    keywords: config.keywords,
  };
}

function buildClaudePluginManifest(config, commandFiles) {
  const manifest = {
    ...buildCommonManifest(config),
    skills: "./skills/",
  };

  if (commandFiles.length > 0) {
    manifest.commands = "./commands/";
  }

  return manifest;
}

function buildCursorPluginManifest(config, commandFiles) {
  const manifest = {
    ...buildCommonManifest(config),
    displayName: config.displayName,
    skills: "./skills/",
    agents: "./agents/",
    hooks: "./hooks/hooks.json",
  };

  if (commandFiles.length > 0) {
    manifest.commands = "./commands/";
  }

  return manifest;
}

function buildClaudeMarketplaceManifest(config) {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: config.name,
    owner: {
      name: config.author.name,
    },
    plugins: [
      {
        name: config.name,
        description: config.marketplace.description,
        version: config.version,
        author: {
          name: config.author.name,
        },
        source: "./",
        category: config.marketplace.category,
        homepage: config.homepage,
      },
    ],
  };
}

function buildGeminiExtensionManifest(config) {
  return {
    name: config.name,
    contextFileName: config.gemini.contextFileName,
    version: config.version,
  };
}

function buildCodexPluginManifest(config) {
  return {
    ...buildCommonManifest(config),
    skills: "./skills/",
    interface: {
      displayName: config.displayName,
      shortDescription: config.codex.interface.shortDescription,
      longDescription: config.codex.interface.longDescription,
      developerName: config.codex.interface.developerName,
      category: config.codex.interface.category,
      capabilities: config.codex.interface.capabilities,
      websiteURL: config.codex.interface.websiteURL,
      privacyPolicyURL: config.codex.interface.privacyPolicyURL,
      termsOfServiceURL: config.codex.interface.termsOfServiceURL,
      defaultPrompt: config.codex.interface.defaultPrompt,
      brandColor: config.codex.interface.brandColor,
    },
  };
}

function buildCodexInstallDoc(config) {
  const pmSkills = config.codex.fallbackSkillAliases.pm;
  const devSkills = config.codex.fallbackSkillAliases.dev;

  const pmLinkLines = pmSkills
    .map(
      (skill) =>
        `ln -sfn ~/.agents/vendor/${config.name}/skills/${skill} ~/.agents/skills/pm-${skill}`
    )
    .join("\n");
  const devLinkLines = devSkills
    .map(
      (skill) =>
        `ln -sfn ~/.agents/vendor/${config.name}/skills/${skill} ~/.agents/skills/dev-${skill}`
    )
    .join("\n");

  return `# PM Plugin: Codex Installation

PM now ships a native Codex plugin manifest at \`.codex-plugin/plugin.json\`.

Until your Codex install loads this repository as a plugin directly, the generated skill-symlink flow below remains the compatible fallback. It uses the same canonical plugin metadata and current skill inventory as the other platform manifests.

When Codex loads PM as a native plugin, product skills appear under the plugin namespace as \`pm:groom\`, \`pm:research\`, \`pm:strategy\`, \`pm:ingest\`, and \`pm:refresh\`.

The fallback symlink flow below creates explicit aliases across two domains on disk: product management (\`pm-*\`) and development (\`dev-*\`). Codex discovers user-installed skills from \`~/.agents/skills\` and project-local skills from \`<project>/.agents/skills\`.

In current Codex builds, fresh sessions still surface the usable PM workflows under skill names such as \`pm:groom\` and \`pm:dev\`. Treat the alias directory names as an installation detail, not the public skill names.

The instructions below install PM for your user account. If you prefer a repo-local install, replace \`~/.agents\` with \`<project>/.agents\`.

## Prerequisites

- Codex installed and authenticated
- Git

## Install

### 1. Clone PM into a stable vendor path

\`\`\`bash
mkdir -p ~/.agents/vendor ~/.agents/skills
git clone https://github.com/soelinmyat/pm ~/.agents/vendor/pm
\`\`\`

If you already cloned PM there, update the existing checkout instead of cloning again:

\`\`\`bash
git -C ~/.agents/vendor/pm pull --ff-only
\`\`\`

### 2. Expose the skills to Codex

#### Product management skills (${pmSkills.length})

\`\`\`bash
${pmLinkLines}
\`\`\`

#### Development skills (${devSkills.length})

\`\`\`bash
${devLinkLines}
\`\`\`

### 3. Restart Codex

Restart Codex so it reloads the newly installed skills. Existing sessions do not hot-reload skills, so open a fresh session after restarting.

## Verification

### Quick filesystem check

\`\`\`bash
ls -d ~/.agents/skills/pm-* ~/.agents/skills/dev-*
# Should list ${pmSkills.length} pm-* and ${devSkills.length} dev-* directories
\`\`\`

You can also verify that one alias resolves to the vendor clone:

\`\`\`bash
readlink ~/.agents/skills/pm-groom
readlink ~/.agents/skills/dev-dev
\`\`\`

### Quick Codex check

Start a new Codex session and verify that Codex exposes one PM skill and one dev workflow skill:

\`\`\`text
pm:groom
pm:dev
\`\`\`

If Codex does not find a skill:

1. Check that the fallback alias directories exist, for example \`~/.agents/skills/pm-groom/SKILL.md\` and \`~/.agents/skills/dev-dev/SKILL.md\`.
2. Confirm the symlink points at your PM clone with \`readlink ~/.agents/skills/pm-groom\`.
3. Restart Codex and open a fresh session again.
4. If the problem persists, remove the broken alias and recreate it from step 2.

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

\`\`\`bash
git -C ~/.agents/vendor/pm pull --ff-only
\`\`\`

Your \`~/.agents/skills/pm-*\` and \`~/.agents/skills/dev-*\` symlinks do not need to be recreated unless you move the clone.

## Dogfooding Local Source

If you are developing PM from a local checkout and want Codex to use that checkout immediately, sync the local source into the vendor clone, then restart Codex and start a new session:

\`\`\`bash
rsync -a --delete \\
  --exclude '.git/' \\
  --exclude 'node_modules/' \\
  /absolute/path/to/pm_plugin/ \\
  ~/.agents/vendor/pm/
\`\`\`

Notes:

1. Codex reads PM from \`~/.agents/vendor/pm\` in a fresh session. Existing sessions do not hot-reload skills.
2. If you added or renamed skills, rerun the symlink commands from step 2 so \`~/.agents/skills\` stays in sync.

## Windows Notes

If you are installing on Windows, enable Developer Mode or use PowerShell as Administrator so the skill symlinks can be created successfully.
`;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return yaml.load(match[1]);
}

const REQUIRES_ALLOWLIST = ["delegation"];
const DEGRADATION_VALUES = ["inline", "none"];

function assertSkillFrontmatter(skillDirs) {
  const skillsRoot = path.join(repoRoot, "skills");
  const errors = [];

  for (const name of skillDirs) {
    const skillPath = path.join(skillsRoot, name, "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf8");
    const fm = extractFrontmatter(content);

    if (!fm || !fm.runtime) {
      errors.push(`${name}/SKILL.md: missing runtime block`);
      continue;
    }

    const rt = fm.runtime;

    if (!Array.isArray(rt.requires)) {
      errors.push(`${name}/SKILL.md: runtime.requires must be an array`);
    } else {
      for (const cap of rt.requires) {
        if (typeof cap !== "string") {
          errors.push(`${name}/SKILL.md: runtime.requires values must be strings`);
        } else if (!REQUIRES_ALLOWLIST.includes(cap)) {
          errors.push(`${name}/SKILL.md: runtime.requires contains unknown value "${cap}"`);
        }
      }
    }

    if (typeof rt.agents !== "number" || !Number.isInteger(rt.agents) || rt.agents < 0) {
      errors.push(`${name}/SKILL.md: runtime.agents must be a non-negative integer`);
    }

    if (typeof rt.guarantee !== "string" || rt.guarantee.trim() === "") {
      errors.push(`${name}/SKILL.md: runtime.guarantee must be a non-empty string`);
    }

    if (!DEGRADATION_VALUES.includes(rt.degradation)) {
      errors.push(
        `${name}/SKILL.md: runtime.degradation must be one of: ${DEGRADATION_VALUES.join(", ")}`
      );
    }
  }

  // Forbidden-syntax guard: scan all files under skills/ for hardcoded dispatch syntax
  const forbiddenPatterns = [/Agent tool:/, /Agent\(\{/];
  const forbiddenNames = ["Agent tool:", "Agent({"];

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const fileContent = fs.readFileSync(fullPath, "utf8");
        for (let i = 0; i < forbiddenPatterns.length; i++) {
          if (forbiddenPatterns[i].test(fileContent)) {
            const relPath = path.relative(repoRoot, fullPath);
            errors.push(`${relPath}: contains forbidden syntax "${forbiddenNames[i]}"`);
          }
        }
      }
    }
  }
  scanDir(skillsRoot);

  if (errors.length > 0) {
    throw new Error(`Skill frontmatter validation failed:\n  ${errors.join("\n  ")}`);
  }
}

function checkOrWriteFile(filePath, content, format) {
  if (checkMode) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Generated file is missing: ${path.relative(repoRoot, filePath)}`);
    }

    const current = fs.readFileSync(filePath, "utf8");
    const expected = format === "json" ? serializeJson(content) : content;
    if (current !== expected) {
      throw new Error(`Generated file is out of date: ${path.relative(repoRoot, filePath)}`);
    }
    return;
  }

  if (format === "json") {
    writeJson(filePath, content);
  } else {
    writeText(filePath, content);
  }
}

function main() {
  const config = readJson(configPath);
  const skillDirs = listSkillDirs();
  const commandFiles = listCommandFiles();

  assertCanonicalInventory(config, skillDirs, commandFiles);
  assertSkillFrontmatter(skillDirs);

  const generatedFiles = [
    [
      path.join(repoRoot, ".claude-plugin", "plugin.json"),
      buildClaudePluginManifest(config, commandFiles),
      "json",
    ],
    [
      path.join(repoRoot, ".cursor-plugin", "plugin.json"),
      buildCursorPluginManifest(config, commandFiles),
      "json",
    ],
    [
      path.join(repoRoot, ".claude-plugin", "marketplace.json"),
      buildClaudeMarketplaceManifest(config),
      "json",
    ],
    [path.join(repoRoot, "gemini-extension.json"), buildGeminiExtensionManifest(config), "json"],
    [path.join(repoRoot, ".codex-plugin", "plugin.json"), buildCodexPluginManifest(config), "json"],
    [path.join(repoRoot, ".codex", "INSTALL.md"), buildCodexInstallDoc(config), "text"],
  ];

  for (const [filePath, content, format] of generatedFiles) {
    checkOrWriteFile(filePath, content, format);
  }
}

// When required as a module, export internals for testing.
// When run directly, execute main().
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { extractFrontmatter, REQUIRES_ALLOWLIST, DEGRADATION_VALUES };
