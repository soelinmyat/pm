---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# Setup Skill

Toggle integrations on or off for this project, or configure separate-repo mode.

## Usage

```
/pm:setup enable linear
/pm:setup disable linear
/pm:setup enable ahrefs
/pm:setup disable ahrefs
/pm:setup separate-repo [path-to-other-repo]
```

## Supported Integrations

| Integration | Config path | Enable value | Disable value |
|---|---|---|---|
| `linear` | `integrations.linear.enabled` | `true` | `false` |
| `ahrefs` | `integrations.seo.provider` | `"ahrefs"` | `"none"` |

## Config Schema v2 Fields

Schema v2 (`config_schema: 2`) adds two optional repo pointer fields for separate-repo mode. These fields are not present in same-repo mode configs.

| Field | Type | Description |
|---|---|---|
| `pm_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **source repo** to the PM repo. Path is relative to the config file location (`.pm/config.json`). |
| `source_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **PM repo** to the source repo. Path is relative to the config file location. |

Example — source repo config (`.pm/config.json` in the app repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "pm_repo": { "type": "local", "path": "../../my-app-pm" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": { "auto_launch": true }
}
```

Example — PM repo config (`.pm/config.json` in the PM repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "source_repo": { "type": "local", "path": "../../my-app" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": { "auto_launch": true }
}
```

Rules:
- A config with `config_schema: 1` or missing `pm_repo`/`source_repo` fields is same-repo mode — no behavioral change.
- Paths are always stored relative to the directory containing `.pm/config.json`, never as absolute paths.
- `type` is always `"local"` for now. The field exists to support future remote backends.
- A config should have either `pm_repo` or `source_repo`, not both.

## Behavior

1. **Parse the argument.** Extract the subcommand from the user's message. If the subcommand is `separate-repo`, follow the Separate-Repo Subcommand section below. Otherwise, extract the action (`enable` or `disable`) and the integration name. If either is missing or unrecognized, show usage examples and stop.

2. **Check config exists.** Read `.pm/config.json` from the project root. If it does not exist, tell the user: "No config found. Run `/pm:start` first to initialize the project." and stop.

3. **Update the config.** Read the full JSON, update only the relevant field (see table above), and write the file back. Preserve all other fields.

4. **Linear enable extras.** When enabling Linear (`enable linear`), after setting `integrations.linear.enabled` to `true`, check if `integrations.linear.team` and `integrations.linear.project` are already set. If not, ask the user for their Linear team slug and project name, then write those to the config.

5. **Confirm the change.** Print a short confirmation:
   - "Linear enabled. Refresh the dashboard to see the update."
   - "Linear disabled. Refresh the dashboard to see the update."
   - "Ahrefs SEO enabled. Refresh the dashboard to see the update."
   - "Ahrefs SEO disabled. Refresh the dashboard to see the update."

## Separate-Repo Subcommand

Configure bidirectional linking between a source repo and a separate PM repo.

### Usage

```
/pm:setup separate-repo ../my-app-pm
/pm:setup separate-repo
```

If the path argument is omitted, ask the user for the path to the other repo.

### Flow

#### 1. Detect Which Repo You Are In

Check whether the current working directory is a **source repo** or a **PM repo**:

- If `pm/` exists at cwd and contains markdown files (e.g., `pm/backlog/`, `pm/evidence/`), this is a **PM repo**. The user needs to provide the path to the **source repo**.
- Otherwise, this is a **source repo**. The user needs to provide the path to the **PM repo**.

Tell the user which repo type was detected and what path is needed:

- PM repo detected: "This looks like a PM repo. Provide the path to the source repo."
- Source repo detected: "This looks like a source repo. Provide the path to the PM repo."

#### 2. Get the Path to the Other Repo

If the user provided a path argument (e.g., `pm:setup separate-repo ../my-app-pm`), use it.

If no path was provided, ask ONE question:

- From a source repo: "What is the path to the PM repo? (relative or absolute)"
- From a PM repo: "What is the path to the source repo? (relative or absolute)"

#### 3. Validate Both Paths Exist

Before writing any config:

- Resolve the provided path relative to cwd if it is not absolute.
- Verify the provided path exists on disk (`test -d`). If it does not exist, tell the user: "Path `{path}` does not exist. Check the path and try again." and stop.
- If the current repo is a source repo and the target is the PM repo: verify the target contains a `pm/` directory. If not, warn: "Path `{path}` does not contain a `pm/` directory. Are you sure this is the PM repo?" Ask the user to confirm before continuing.
- If the current repo is a PM repo and the target is the source repo: no additional validation is needed beyond directory existence.

#### 4. Compute Relative Paths

Compute relative paths from each config file's directory (`.pm/config.json` lives in the repo root, so relative from each repo root):

- **Source repo config** needs `pm_repo.path`: the relative path from the source repo root to the PM repo root.
- **PM repo config** needs `source_repo.path`: the relative path from the PM repo root to the source repo root.

Use `node -e` to compute relative paths reliably:

```bash
node -e "const path = require('path'); console.log(path.relative(process.argv[1], process.argv[2]))" "/absolute/source/repo" "/absolute/pm/repo"
```

Always store paths as relative — never absolute.

#### 5. Write Config to Both Repos

For each repo, read `.pm/config.json` if it exists. If it does not exist, create `.pm/config.json` with a minimal scaffold:

```json
{
  "config_schema": 2,
  "project_name": "{directory-name}",
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {
    "auto_launch": true
  }
}
```

Populate `project_name` from the repo directory name.

**Source repo config:** Set `pm_repo` to `{ "type": "local", "path": "{relative-path-to-pm-repo}" }`. Remove `source_repo` if it was previously set (a config should have one pointer, not both). Preserve all other fields.

**PM repo config:** Set `source_repo` to `{ "type": "local", "path": "{relative-path-to-source-repo}" }`. Remove `pm_repo` if it was previously set. Preserve all other fields — especially `integrations` and `preferences`.

Ensure `config_schema` is set to `2` in both configs. If an existing config has `config_schema: 1` or no `config_schema`, upgrade it to `2`.

Create the `.pm/` directory (`mkdir -p .pm`) in either repo if it does not exist before writing the config file.

#### 6. Confirm Success

After writing both config files, output exactly:

> Config written to both repos. Run `pm:start` to activate separate-repo mode.

## Constraints

- This skill toggles integrations and configures separate-repo mode. It does not initialize the project — that is `/pm:start`.
- Do not delete existing config fields when writing back. Only update the specific field.
- If the user runs `/pm:setup` without arguments, show the usage examples above.
