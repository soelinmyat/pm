#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const configPath = path.join(repoRoot, 'plugin.config.json');
const checkMode = process.argv.includes('--check');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const skillsRoot = path.join(repoRoot, 'skills');
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function listCommandFiles() {
  const commandsRoot = path.join(repoRoot, 'commands');
  if (!fs.existsSync(commandsRoot)) {
    return [];
  }

  return fs.readdirSync(commandsRoot)
    .filter((entry) => entry.endsWith('.md'))
    .sort();
}

function assertCanonicalInventory(config, skillDirs, commandFiles) {
  const configuredSkillSet = new Set([
    ...config.codex.fallbackSkillAliases.pm,
    ...config.codex.fallbackSkillAliases.dev
  ]);

  const actualSkillSet = new Set(skillDirs);
  const missingSkills = [...configuredSkillSet].filter((name) => !actualSkillSet.has(name));
  const unmappedSkills = skillDirs.filter((name) => !configuredSkillSet.has(name));

  if (missingSkills.length > 0 || unmappedSkills.length > 0) {
    const problems = [];
    if (missingSkills.length > 0) {
      problems.push(`missing skill dirs: ${missingSkills.join(', ')}`);
    }
    if (unmappedSkills.length > 0) {
      problems.push(`unmapped skill dirs: ${unmappedSkills.join(', ')}`);
    }
    throw new Error(`plugin.config.json skill aliases are out of sync with skills/: ${problems.join('; ')}`);
  }

  const configuredCommandSet = new Set(config.commands.map((name) => `${name}.md`));
  const missingCommands = [...configuredCommandSet].filter((name) => !commandFiles.includes(name));
  const unconfiguredCommands = commandFiles.filter((name) => !configuredCommandSet.has(name));

  if (missingCommands.length > 0 || unconfiguredCommands.length > 0) {
    const problems = [];
    if (missingCommands.length > 0) {
      problems.push(`missing command files: ${missingCommands.join(', ')}`);
    }
    if (unconfiguredCommands.length > 0) {
      problems.push(`unconfigured command files: ${unconfiguredCommands.join(', ')}`);
    }
    throw new Error(`plugin.config.json commands are out of sync with commands/: ${problems.join('; ')}`);
  }
}

function buildCommonManifest(config) {
  return {
    name: config.name,
    description: config.description,
    version: config.version,
    author: {
      name: config.author.name
    },
    homepage: config.homepage,
    repository: config.repository,
    license: config.license,
    keywords: config.keywords
  };
}

function buildClaudePluginManifest(config, commandFiles) {
  const manifest = {
    ...buildCommonManifest(config),
    skills: './skills/'
  };

  if (commandFiles.length > 0) {
    manifest.commands = './commands/';
  }

  return manifest;
}

function buildCursorPluginManifest(config, commandFiles) {
  const manifest = {
    ...buildCommonManifest(config),
    displayName: config.displayName,
    skills: './skills/',
    agents: './agents/',
    hooks: './hooks/hooks.json'
  };

  if (commandFiles.length > 0) {
    manifest.commands = './commands/';
  }

  return manifest;
}

function buildClaudeMarketplaceManifest(config) {
  return {
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: config.name,
    owner: {
      name: config.author.name
    },
    plugins: [
      {
        name: config.name,
        description: config.marketplace.description,
        version: config.version,
        author: {
          name: config.author.name
        },
        source: './',
        category: config.marketplace.category,
        homepage: config.homepage
      }
    ]
  };
}

function buildGeminiExtensionManifest(config) {
  return {
    name: config.name,
    contextFileName: config.gemini.contextFileName,
    version: config.version
  };
}

function buildCodexPluginManifest(config) {
  return {
    ...buildCommonManifest(config),
    skills: './skills/',
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
      brandColor: config.codex.interface.brandColor
    }
  };
}

function buildCodexInstallDoc(config) {
  const pmSkills = config.codex.fallbackSkillAliases.pm;
  const devSkills = config.codex.fallbackSkillAliases.dev;

  const pmLinkLines = pmSkills
    .map((skill) => `ln -sfn ~/.agents/vendor/${config.name}/skills/${skill} ~/.agents/skills/pm-${skill}`)
    .join('\n');
  const devLinkLines = devSkills
    .map((skill) => `ln -sfn ~/.agents/vendor/${config.name}/skills/${skill} ~/.agents/skills/dev-${skill}`)
    .join('\n');

  return `# PM Plugin: Codex Installation

PM now ships a native Codex plugin manifest at \`.codex-plugin/plugin.json\`.

Until your Codex install loads this repository as a plugin directly, the generated skill-symlink flow below remains the compatible fallback. It uses the same canonical plugin metadata and current skill inventory as the other platform manifests.

PM integrates with Codex as a set of skills across two domains: product management (\`pm-*\`) and development (\`dev-*\`). Codex discovers user-installed skills from \`~/.agents/skills\` and project-local skills from \`<project>/.agents/skills\`.

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

Restart Codex so it reloads the newly installed skills.

## Verification

Start a new Codex session and invoke one PM skill and one dev skill:

\`\`\`text
$pm-groom
$dev-dev
\`\`\`

If Codex does not find a skill:

1. Check that \`~/.agents/skills/<skill-name>/SKILL.md\` exists.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

### Quick check: all ${pmSkills.length + devSkills.length} skills

\`\`\`bash
ls -d ~/.agents/skills/pm-* ~/.agents/skills/dev-*
# Should list ${pmSkills.length} pm-* and ${devSkills.length} dev-* directories
\`\`\`

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

\`\`\`bash
git -C ~/.agents/vendor/pm pull --ff-only
\`\`\`

Your \`~/.agents/skills/pm-*\` and \`~/.agents/skills/dev-*\` symlinks do not need to be recreated unless you move the clone.

## Windows Notes

If you are installing on Windows, enable Developer Mode or use PowerShell as Administrator so the skill symlinks can be created successfully.
`;
}

function checkOrWriteFile(filePath, content, format) {
  if (checkMode) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Generated file is missing: ${path.relative(repoRoot, filePath)}`);
    }

    const current = fs.readFileSync(filePath, 'utf8');
    const expected = format === 'json'
      ? serializeJson(content)
      : content;
    if (current !== expected) {
      throw new Error(`Generated file is out of date: ${path.relative(repoRoot, filePath)}`);
    }
    return;
  }

  if (format === 'json') {
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

  const generatedFiles = [
    [path.join(repoRoot, '.claude-plugin', 'plugin.json'), buildClaudePluginManifest(config, commandFiles), 'json'],
    [path.join(repoRoot, '.cursor-plugin', 'plugin.json'), buildCursorPluginManifest(config, commandFiles), 'json'],
    [path.join(repoRoot, '.claude-plugin', 'marketplace.json'), buildClaudeMarketplaceManifest(config), 'json'],
    [path.join(repoRoot, 'gemini-extension.json'), buildGeminiExtensionManifest(config), 'json'],
    [path.join(repoRoot, '.codex-plugin', 'plugin.json'), buildCodexPluginManifest(config), 'json'],
    [path.join(repoRoot, '.codex', 'INSTALL.md'), buildCodexInstallDoc(config), 'text']
  ];

  for (const [filePath, content, format] of generatedFiles) {
    checkOrWriteFile(filePath, content, format);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
