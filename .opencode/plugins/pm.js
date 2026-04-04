const fs = require("fs");
const path = require("path");

// Load the pm:setup skill content at require-time
const skillPath = path.resolve(__dirname, "../../skills/setup/SKILL.md");
let skillContent;
try {
  skillContent = fs.readFileSync(skillPath, "utf-8");
} catch {
  skillContent =
    "Error: Could not load pm setup skill. Check plugin installation.";
}

// Detect whether the project has already been configured
const configPath = path.join(process.cwd(), ".pm", "config.json");
const isConfigured = fs.existsSync(configPath);

const injectedMessage = isConfigured
  ? `# PM Plugin Active

The PM plugin is configured for this project. Available skills:

| Command | Description |
|---------|-------------|
| \`/pm:setup\` | Re-run setup or update integrations |
| \`/pm:ingest <path>\` | Import customer evidence from local files or folders and update shared research artifacts |
| \`/pm:strategy\` | Generate and refine product positioning and strategic bets |
| \`/pm:research <topic>\` | Landscape mapping, competitor deep-dives, user signal analysis |
| \`/pm:groom\` | Convert strategy into groomed Linear issues ready for sprint |
| \`/pm:dig <question>\` | Ad-hoc deep research on a specific question or topic |
| \`/pm:refresh [scope]\` | Audit research for staleness and missing data, then patch without losing existing content |
| \`/pm:view\` | Browse and search accumulated research and strategy artifacts |

Run any skill by typing its command.`
  : `# PM Plugin: Setup Required

This project has not been configured for the PM plugin yet. Run \`/pm:setup\` to get started.

Setup configures:
- Product context and target market
- Linear integration (or markdown backlog fallback)
- SEO provider (Ahrefs MCP or web search only)
- Customer evidence import workflow via \`/pm:ingest <path>\`
- Knowledge base folder structure (\`pm/\` and \`.pm/\`)

## Setup Skill Reference

${skillContent}`;

module.exports = {
  hooks: {
    "experimental.chat.system.transform": (systemPrompt) => {
      return `${systemPrompt}\n\n<EXTREMELY_IMPORTANT>\n${injectedMessage}\n</EXTREMELY_IMPORTANT>`;
    },
  },
};
