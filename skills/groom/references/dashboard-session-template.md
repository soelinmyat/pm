# Dashboard Session Template

Reference template for per-phase dashboard session canvases written to `.pm/sessions/groom-{slug}/current.html`.

All phase write steps produce a complete HTML document following this structure. Fill the placeholder slots with phase-specific content.

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TOPIC} — {PHASE_LABEL}</title>
<style>
  :root {
    --bg: #0d0f12; --surface: #1a1d23; --border: #2a2e37;
    --text: #e8eaed; --text-muted: #8b8f96;
    --accent: #5e6ad2; --accent-subtle: #1e1f35;
    --success: #4ade80; --warning: #fb923c;
    --radius: 8px; --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem; }

  /* Header */
  .header { margin-bottom: 1.5rem; }
  .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .header .phase-label {
    font-size: 0.8125rem; color: var(--accent); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;
  }

  /* Phase Stepper */
  .stepper { display: flex; gap: 0; margin-bottom: 2rem; overflow-x: auto; }
  .step {
    flex: 1; text-align: center; padding: 0.625rem 0.25rem;
    font-size: 0.6875rem; font-weight: 500; position: relative;
    border-bottom: 2px solid var(--border); color: var(--text-muted);
    white-space: nowrap; min-width: 0;
  }
  .step.completed { border-bottom-color: var(--success); color: var(--success); }
  .step.current { border-bottom-color: var(--accent); color: var(--accent); font-weight: 700; }
  .step .icon { display: block; font-size: 0.875rem; margin-bottom: 0.125rem; }

  /* Content */
  .content { margin-bottom: 2rem; }
  .content h2 { font-size: 1.125rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
  .content h3 { font-size: 0.9375rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .content p { margin-bottom: 0.75rem; }
  .content ul { margin: 0.5rem 0 0.75rem 1.5rem; }
  .content li { margin-bottom: 0.25rem; }

  /* Tables */
  .content table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
  .content th, .content td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
  .content th {
    background: #1e2128; font-weight: 600; font-size: 0.8125rem;
    text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted);
  }

  /* Scope Grid (two-column) */
  .scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
  .scope-col {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1rem;
  }
  .scope-col h3 { margin-top: 0; }
  .scope-col.in-scope { border-left: 3px solid var(--success); }
  .scope-col.out-scope { border-left: 3px solid var(--warning); }

  /* Badge */
  .badge {
    display: inline-block; padding: 0.2em 0.6em; border-radius: 4px;
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-success { background: rgba(74,222,128,0.15); color: var(--success); }
  .badge-warning { background: rgba(251,146,60,0.15); color: var(--warning); }
  .badge-info { background: rgba(94,106,210,0.15); color: var(--accent); }

  /* Cards */
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1rem 1.25rem; margin-bottom: 0.75rem;
  }
  .card h3 { margin-top: 0; font-size: 0.9375rem; }
  .card .outcome { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 0.5rem; }

  /* Verdict row */
  .verdict-row {
    display: flex; gap: 0.75rem; margin: 1rem 0; flex-wrap: wrap;
  }
  .verdict-card {
    flex: 1; min-width: 140px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0.75rem 1rem; text-align: center;
  }
  .verdict-card .role { font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .verdict-card .verdict { font-size: 0.875rem; font-weight: 700; margin-top: 0.25rem; }

  /* Numbered list (for blocking issues) */
  .content ol { margin: 0.5rem 0 0.75rem 1.5rem; }
  .content ol li { margin-bottom: 0.375rem; }

  /* Collapsible */
  details { margin: 0.75rem 0; }
  summary {
    cursor: pointer; font-weight: 600; font-size: 0.875rem;
    color: var(--text-muted); padding: 0.5rem 0;
  }
  details[open] summary { color: var(--text); }

  /* Footer */
  .footer {
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);
    font-size: 0.75rem; color: var(--text-muted); text-align: center;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .scope-grid { grid-template-columns: 1fr; }
    .verdict-row { flex-direction: column; }
    .stepper { font-size: 0.5625rem; }
  }
</style>
<!-- Mermaid.js for diagram rendering (Phase 5) -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="phase-label">{PHASE_LABEL}</div>
    <h1>{TOPIC}</h1>
  </div>

  <div class="stepper">
    {STEPPER_HTML}
    <!-- Each step: <div class="step completed|current|upcoming"><span class="icon">...</span> Label</div> -->
  </div>

  <div class="content">
    {CONTENT}
  </div>

  <div class="footer">Powered by PM</div>
</div>
</body>
</html>
```

## Stepper Construction

Build `{STEPPER_HTML}` using this logic:

```
PHASE_ORDER = ['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'groom', 'team-review', 'bar-raiser', 'present']

LABELS = {
  intake:         { gerund: 'Capturing idea...',    past: 'Idea captured',     short: 'Intake' },
  strategy-check: { gerund: 'Checking strategy...', past: 'Strategy checked',  short: 'Strategy' },
  research:       { gerund: 'Researching...',        past: 'Research complete', short: 'Research' },
  scope:          { gerund: 'Defining scope...',     past: 'Scope defined',     short: 'Scope' },
  scope-review:   { gerund: 'Reviewing scope...',    past: 'Scope reviewed',    short: 'Scope Review' },
  groom:          { gerund: 'Drafting issues...',    past: 'Issues drafted',    short: 'Groom' },
  team-review:    { gerund: 'Reviewing issues...',   past: 'Issues reviewed',   short: 'Team Review' },
  bar-raiser:     { gerund: 'Raising the bar...',    past: 'Bar raised',        short: 'Bar Raiser' },
  present:        { gerund: 'Presenting...',         past: 'Presented',         short: 'Present' },
}

For each phase in PHASE_ORDER:
  if index < currentIndex  -> class="step completed", icon="&#10003;", label=past
  if index == currentIndex -> class="step current",   icon="&#9679;",  label=gerund
  if index > currentIndex  -> class="step",           icon="",         label=short
```

## Content Slot

The `{CONTENT}` slot is phase-specific. Each phase write step in the groom skill specifies exactly what HTML to produce for the content area. Use the CSS classes defined above (`.scope-grid`, `.verdict-row`, `.card`, `.badge`, tables, etc.) to build content that is richer than terminal output.
