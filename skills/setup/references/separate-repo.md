# Separate-Repo Subcommand

Configure bidirectional linking between a source repo and a separate PM repo.

## Usage

```
/pm:setup separate-repo ../my-app-pm
/pm:setup separate-repo
```

If the path argument is omitted, ask the user for the path to the other repo.

## Flow

### 1. Detect Which Repo You Are In

Check whether the current working directory is a **source repo** or a **PM repo**:

- If `pm/` exists at cwd and contains markdown files (e.g., `pm/backlog/`, `pm/evidence/`), this is a **PM repo**. The user needs to provide the path to the **source repo**.
- Otherwise, this is a **source repo**. The user needs to provide the path to the **PM repo**.

Tell the user which repo type was detected and what path is needed:

- PM repo detected: "This looks like a PM repo. Provide the path to the source repo."
- Source repo detected: "This looks like a source repo. Provide the path to the PM repo."

### 2. Get the Path to the Other Repo

If the user provided a path argument (e.g., `pm:setup separate-repo ../my-app-pm`), use it.

If no path was provided, ask ONE question:

- From a source repo: "What is the path to the PM repo? (relative or absolute)"
- From a PM repo: "What is the path to the source repo? (relative or absolute)"

### 3. Validate Both Paths Exist

Before writing any config:

- Resolve the provided path relative to cwd if it is not absolute.
- Verify the provided path exists on disk (`test -d`). If it does not exist, tell the user: "Path `{path}` does not exist. Check the path and try again." and stop.
- If the current repo is a source repo and the target is the PM repo: verify the target contains a `pm/` directory. If not, warn: "Path `{path}` does not contain a `pm/` directory. Are you sure this is the PM repo?" Ask the user to confirm before continuing.
- If the current repo is a PM repo and the target is the source repo: no additional validation is needed beyond directory existence.

### 4. Compute Relative Paths

Compute relative paths from each config file's parent directory (`.pm/`), since `resolvePmDir()` in start-status.js resolves paths relative to the `.pm/` directory:

- **Source repo config** needs `pm_repo.path`: the relative path from the source repo's `.pm/` directory to the PM repo root.
- **PM repo config** needs `source_repo.path`: the relative path from the PM repo's `.pm/` directory to the source repo root.

Use `node -e` to compute relative paths reliably:

```bash
node -e "const path = require('path'); console.log(path.relative(path.join(process.argv[1], '.pm'), process.argv[2]))" "/absolute/source/repo" "/absolute/pm/repo"
```

Always store paths as relative — never absolute.

### 5. Write Config to Both Repos

For each repo, read `.pm/config.json` if it exists. If it does not exist, create `.pm/config.json` with a minimal scaffold:

```json
{
  "config_schema": 2,
  "project_name": "{directory-name}",
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {}
}
```

Populate `project_name` from the repo directory name.

**Source repo config:** Set `pm_repo` to `{ "type": "local", "path": "{relative-path-to-pm-repo}" }`. Remove `source_repo` if it was previously set (a config should have one pointer, not both). Preserve all other fields.

**PM repo config:** Set `source_repo` to `{ "type": "local", "path": "{relative-path-to-source-repo}" }`. Remove `pm_repo` if it was previously set. Preserve all other fields — especially `integrations` and `preferences`.

Ensure `config_schema` is set to `2` in both configs. If an existing config has `config_schema: 1` or no `config_schema`, upgrade it to `2`.

Create the `.pm/` directory (`mkdir -p .pm`) in either repo if it does not exist before writing the config file.

### 6. Confirm Success

After writing both config files, output exactly:

> Config written to both repos. Run `pm:start` to activate separate-repo mode.

## Config Examples

Example — source repo config (`.pm/config.json` in the app repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "pm_repo": { "type": "local", "path": "../../my-app-pm" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": {}
}
```

Example — PM repo config (`.pm/config.json` in the PM repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "source_repo": { "type": "local", "path": "../../my-app" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": {}
}
```
