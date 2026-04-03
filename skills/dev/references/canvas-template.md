# Dev Canvas Template

Reference for writing canvas HTML during dev sessions. Read on demand by dev agents.

## When to write

Write `.pm/sessions/{canvas-id}/current.html` at each stage transition:

| Stage | Canvas ID | Content |
|-------|-----------|---------|
| Intake | `dev-{slug}` or `epic-{parent-slug}` | Issue title, size, branch |
| Workspace | same | Branch created, deps installed |
| Implement | same | Task progress, current file |
| Review | same | Review verdict, findings count |
| Ship | same | PR link, CI status |
| Merged | same | Final summary card |

## After each write

1. Write the `.state` file:
   ```bash
   echo "active" > ".pm/sessions/${CANVAS_ID}/.state"
   ```
   Use `idle` when waiting for user input, `completed` when session ends.

## HTML structure

Canvas HTML must be a self-contained page. Use this skeleton:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev: {ISSUE_TITLE}</title>
<style>
  :root { --bg:#0f1117; --surface:#161922; --border:#2a2d3a; --text:#e2e4e9;
    --text-muted:#8b8fa3; --accent:#2563eb; --success:#22c55e; --warning:#f59e0b; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',system-ui,sans-serif; background:var(--bg); color:var(--text);
    padding:2rem; max-width:720px; margin:0 auto; }
  h1 { font-size:1.5rem; font-weight:700; margin-bottom:0.5rem; }
  .meta { font-size:0.8125rem; color:var(--text-muted); margin-bottom:1.5rem; }
  .badge { display:inline-block; padding:0.125rem 0.5rem; border-radius:999px;
    font-size:0.6875rem; font-weight:600; text-transform:uppercase; }
  .badge-active { background:rgba(34,197,94,0.15); color:var(--success); }
  .badge-done { background:rgba(37,99,235,0.15); color:var(--accent); }

  /* Stage stepper */
  .stepper { display:flex; gap:0.25rem; margin-bottom:1.5rem; }
  .step { flex:1; height:4px; border-radius:2px; background:var(--border); }
  .step.done { background:var(--success); }
  .step.current { background:var(--accent); }

  /* Content sections */
  .section { margin-bottom:1.25rem; padding:1rem; background:var(--surface);
    border:1px solid var(--border); border-radius:8px; }
  .section-title { font-size:0.75rem; font-weight:600; color:var(--text-muted);
    text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.5rem; }
  .result { font-size:0.875rem; }
  .pass { color:var(--success); }
  .fail { color:#ef4444; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }

  /* Epic sub-issue table */
  table { width:100%; border-collapse:collapse; font-size:0.8125rem; }
  th { text-align:left; font-weight:600; color:var(--text-muted); padding:0.5rem 0.75rem;
    border-bottom:1px solid var(--border); }
  td { padding:0.5rem 0.75rem; border-bottom:1px solid var(--border); }
</style>
</head>
<body>

<h1>{ISSUE_TITLE}</h1>
<div class="meta">
  <span class="badge badge-active">{STAGE}</span>
  {SIZE} · {BRANCH}
</div>

<!-- Stage stepper: mark completed stages as .done, current as .current -->
<div class="stepper">
  <div class="step done"></div>   <!-- intake -->
  <div class="step done"></div>   <!-- workspace -->
  <div class="step current"></div> <!-- implement -->
  <div class="step"></div>         <!-- review -->
  <div class="step"></div>         <!-- ship -->
</div>

<!-- Test results (update after each test run) -->
<div class="section">
  <div class="section-title">Tests</div>
  <div class="result">
    <span class="pass">✓ {PASS_COUNT} passed</span>
    <!-- <span class="fail">✗ {FAIL_COUNT} failed</span> -->
  </div>
</div>

<!-- PR status (show after PR creation) -->
<!--
<div class="section">
  <div class="section-title">Pull Request</div>
  <div class="result"><a href="{PR_URL}">#{PR_NUMBER}</a> · {PR_STATUS}</div>
</div>
-->

<!-- Epic variant: sub-issue progress table -->
<!--
<div class="section">
  <div class="section-title">Sub-Issues</div>
  <table>
    <thead><tr><th>#</th><th>Issue</th><th>Size</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>{TITLE}</td><td>S</td><td>✓ Merged</td></tr>
      <tr><td>2</td><td>{TITLE}</td><td>S</td><td>▸ Implementing</td></tr>
    </tbody>
  </table>
</div>
-->

</body>
</html>
```

## Key rules

- Canvas HTML must be self-contained (inline CSS, no external deps)
- Use the same color variables as the dashboard for visual consistency
- Keep it simple — this is a status display, not a full page
- The server injects SSE hot-reload automatically; don't add your own EventSource
- Write `.state` file alongside `current.html` in the same directory
