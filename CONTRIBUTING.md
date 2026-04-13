# Contributing to PM

PM welcomes contributions — bug fixes, new platform support, skill improvements, and documentation.

## Getting Started

```bash
git clone https://github.com/soelinmyat/pm.git
cd pm
npm install
npm test                        # 511+ tests, all must pass
npm run quality                 # lint + format + tests (matches CI)
```

## How the Repo is Organized

| Directory | What it contains |
|---|---|
| `commands/` | Public command entrypoints — each `.md` file is a user-invocable command |
| `skills/` | Workflow implementations — each directory has a `SKILL.md` with frontmatter |
| `personas/` | Role overlays used by review and critique agents |
| `scripts/` | Runtime scripts (server, generator, validation) |
| `hooks/` | Shell hooks that run on session start/end |
| `templates/` | HTML templates for proposals, strategy decks |
| `references/` | Shared reference docs consulted by skills (never invoked directly) |
| `tests/` | Node.js test suite |

## Adding a Command

1. Create `commands/{name}.md` with frontmatter (`description`, `argument-hint`)
2. Add the command name to the `commands` array in `plugin.config.json`
3. Run `node scripts/generate-platform-files.js` to regenerate manifests
4. Run `npm test` — the inventory check will catch mismatches

## Adding a Skill

1. Create `skills/{name}/SKILL.md` with `name:` and `description:` in frontmatter
2. Add the skill to the appropriate alias list in `plugin.config.json` under `codex.fallbackSkillAliases`
3. Run `node scripts/generate-platform-files.js`
4. Run `npm test`

## Adding Platform Support

PM officially supports Claude Code and Codex. We welcome community contributions for other platforms.

To add a new platform:

1. Add a builder function in `scripts/generate-platform-files.js`
2. Add the output path to the `generatedFiles` array in the same script
3. Add any platform-specific config to `plugin.config.json`
4. Add the generated manifest files to the CI validate job in `.github/workflows/ci.yml`
5. Submit a PR with a brief note on how you tested the integration

## Running Tests

```bash
npm test                        # run the full test suite
npm run quality                 # lint + format + tests (same as CI)
node scripts/generate-platform-files.js --check   # verify manifests are in sync
```

CI runs all three checks. Your PR must pass all of them.

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run quality` — fix any failures
4. Run `node scripts/generate-platform-files.js --check` — regenerate if needed
5. Open a PR against `main`

Keep PRs focused. One concern per PR. If you're fixing a bug and noticed an unrelated issue, submit them separately.

## Code Style

- JavaScript: ESLint + Prettier (configured in repo)
- Shell: ShellCheck
- Markdown skill files: frontmatter with `name:` and `description:` required

## Reporting Issues

- **Bugs:** Open an [issue](https://github.com/soelinmyat/pm/issues) with steps to reproduce
- **Features:** Start a [discussion](https://github.com/soelinmyat/pm/discussions) first
- **Security:** See [SECURITY.md](SECURITY.md)
