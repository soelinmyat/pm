---
name: view
description: "Open the PM knowledge base dashboard in your browser. Starts the bundled dashboard server for the current project's pm directory and returns the local URL."
---

# pm:view

## Purpose

Open the PM dashboard in a browser so the user can review the current landscape, strategy, competitors, research, and backlog visually.

## Flow

1. Check whether `pm/` exists in the current project.
2. If it does not exist, explain that there is no PM knowledge base yet and suggest `/pm:setup` or `/pm:research landscape` first.
3. If it exists, run the bundled `scripts/start-server.sh` helper with dashboard mode and the current project as the data root:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
```

4. Parse the returned JSON.
5. Extract the `url` field and present it to the user.
6. If the helper returns an error, summarize the error and tell the user what to check next.

## Output

Use this format:

```text
Dashboard running at {url}
```

If the dashboard cannot be started, explain why in one sentence and give the next corrective step.
