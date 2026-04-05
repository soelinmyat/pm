# Component Catalog

Read this file alongside `references/design-system.md` before generating HTML pages. Pick components based on what the content needs — don't force components that don't fit.

Each component shows: name, when to use it, a minimal HTML snippet, and which page types typically use it. The CSS for each component uses tokens from the design system `:root` block.

---

## Hero Components

### metrics-strip

Key numbers in the hero. Use when 3-5 headline stats summarize the page.

```html
<div class="metrics-strip">
  <div class="metric-cell"><div class="metric-val">$1.2M</div><div class="metric-lbl">ARR</div></div>
  <div class="metric-cell"><div class="metric-val">72</div><div class="metric-lbl">NPS</div></div>
</div>
```

```css
.metrics-strip { display: flex; background: rgba(255,255,255,0.06); border-radius: var(--r-md); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
.metric-cell { flex: 1; padding: 0.7rem 1rem; text-align: center; border-right: 1px solid rgba(255,255,255,0.06); }
.metric-cell:last-child { border-right: none; }
.metric-val { font-size: 1.375rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.metric-lbl { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.35); }
```

Used by: Strategy, Competitor, Landscape

### hero-meta-row

Inline metadata beneath the hero summary. Author avatars, dates, approval progress.

```html
<div class="hero-meta">
  <span class="hero-meta-item">
    <span class="avatar-sm" style="background:linear-gradient(135deg,#818CF8,#5B5BD6)">SM</span>
    Sarah M.
  </span>
  <span class="hero-meta-sep">&middot;</span>
  <span class="hero-meta-item">Q3 2026</span>
</div>
```

Used by: PRD, RFC, Research

---

## Evidence Components

### stat-card

Prominent numeric callout with colored top accent line. Use for 2-4 evidence data points.

```html
<div class="evidence-grid">
  <div class="stat-card">
    <div class="stat-value">68%</div>
    <div class="stat-desc">of churned accounts cited "can't collaborate"</div>
  </div>
</div>
```

```css
.evidence-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.625rem; }
.stat-card { background: var(--bg-surface); border: 1px solid var(--rule); border-radius: var(--r-md); padding: 1.125rem 1rem; position: relative; overflow: hidden; }
.stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
.stat-card:nth-child(1)::before { background: var(--negative); }
.stat-card:nth-child(2)::before { background: var(--accent); }
.stat-card:nth-child(3)::before { background: var(--positive); }
.stat-value { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.03em; color: var(--ink); }
.stat-desc { font-size: 0.76rem; color: var(--ink-tertiary); }
```

Used by: PRD, Landscape

### quote-card

Customer or expert quote with typographic quote mark and source attribution.

```html
<div class="quote-card">
  <div class="quote-text">"We love the editor but can't use it for anything involving more than one person."</div>
  <div class="quote-source">Customer Interview — Acme Agency, Mar 12</div>
</div>
```

```css
.quote-card { background: var(--bg-surface); border: 1px solid var(--rule); border-radius: var(--r-md); padding: 1rem 1.25rem; position: relative; }
.quote-card::before { content: '\201C'; position: absolute; top: 0.5rem; left: 1rem; font-size: 2.5rem; color: var(--rule); font-family: Georgia, serif; }
.quote-text { font-size: 0.88rem; color: var(--ink-secondary); font-style: italic; line-height: 1.6; padding-left: 1.75rem; }
.quote-source { font-size: 0.72rem; font-weight: 600; color: var(--ink-faint); margin-top: 0.5rem; padding-left: 1.75rem; }
```

Used by: PRD, Research

### data-callout

Inline stat strip within a section. Use for 3-5 quick numbers mid-content.

```html
<div class="data-callout">
  <div class="data-stat"><div class="data-val">73%</div><div class="data-lbl">Have tokens</div></div>
  <div class="data-stat"><div class="data-val">52%</div><div class="data-lbl">Use Figma Variables</div></div>
</div>
```

```css
.data-callout { display: flex; gap: 1.5rem; padding: 0.875rem 1rem; background: var(--bg-inset); border-radius: var(--r-sm); }
.data-val { font-size: 1.25rem; font-weight: 800; color: var(--ink); }
.data-lbl { font-size: 0.65rem; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.05em; }
```

Used by: Research

### finding-card

Numbered research insight with confidence badge. Use for key findings / TL;DR.

```html
<div class="finding-card">
  <div class="finding-num">1</div>
  <div class="finding-content">
    <div class="finding-headline">DTCG format is the emerging standard</div>
    <div class="finding-detail">W3C-backed JSON format. Figma, Tokens Studio, Style Dictionary all support it.</div>
    <span class="finding-confidence confidence-high">High confidence</span>
  </div>
</div>
```

```css
.finding-num { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 800; flex-shrink: 0; }
.confidence-high { background: var(--positive-soft); color: var(--positive); }
.confidence-medium { background: var(--warning-soft); color: var(--warning); }
.confidence-low { background: var(--bg-muted); color: var(--ink-tertiary); }
```

Used by: Research

---

## Content Components

### scope-grid

Two-column in-scope / out-of-scope with colored left stripes.

```html
<div class="scope-grid">
  <div class="scope-col scope-in">
    <h3>In Scope</h3>
    <ul><li>Item one</li></ul>
  </div>
  <div class="scope-col scope-out">
    <h3>Not In Scope</h3>
    <ul><li>Item one</li></ul>
  </div>
</div>
```

```css
.scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.scope-col { background: var(--bg-surface); border: 1px solid var(--rule); border-radius: var(--r-md); padding: 1rem 1.25rem; position: relative; overflow: hidden; }
.scope-col::before { content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 3px; }
.scope-in::before { background: var(--positive); }
.scope-out::before { background: var(--negative); }
.scope-in h3 { color: var(--positive); }
.scope-out h3 { color: var(--negative); }
```

Used by: PRD, RFC

### story-card

User story with persona tag and Gherkin acceptance criteria.

```html
<div class="story-card">
  <div class="story-header">
    <span class="story-tag story-tag-primary">Primary</span>
    <span class="story-persona">Team Lead</span>
  </div>
  <div class="story-body">
    <div class="story-text">As a team lead, I want to...</div>
    <ul class="ac-list">
      <li><span class="kw">Given</span> ... <span class="kw">When</span> ... <span class="kw">Then</span> ...</li>
    </ul>
  </div>
</div>
```

Used by: PRD

### callout

Info, warning, or danger callout block. Use inline within any section.

```html
<div class="callout callout-info">
  <div class="callout-icon">&#8505;</div>
  <div class="callout-body"><strong>Key point:</strong> Supporting details here.</div>
</div>
```

Variants: `callout-info` (blue), `callout-warning` (amber), `callout-success` (green), `callout-danger` (red).

Used by: RFC, Research, Competitor

### collapsible (details/summary)

Progressive disclosure for detailed content.

```html
<details>
  <summary>Section title</summary>
  <div class="details-body">
    <p>Content here.</p>
  </div>
</details>
```

Used by: PRD, RFC

---

## Technical Components

### code-block

Dark code block with language label. Use for API contracts, config, or code samples.

```html
<div class="code-block" data-lang="typescript">
<span class="code-kw">const</span> server = <span class="code-fn">configure</span>({...})
</div>
```

```css
.code-block { background: #1E1E2E; color: #CDD6F4; font-family: var(--mono); font-size: 0.8rem; line-height: 1.7; padding: 1rem 1.25rem; border-radius: var(--r-md); overflow-x: auto; border: 1px solid rgba(255,255,255,0.06); position: relative; }
.code-block[data-lang]::before { content: attr(data-lang); position: absolute; top: 0.5rem; right: 0.75rem; font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.25); }
.code-kw { color: #CBA6F7; } .code-str { color: #A6E3A1; } .code-type { color: #89B4FA; }
.code-comment { color: #6C7086; font-style: italic; } .code-fn { color: #89DCEB; }
```

Used by: RFC

### api-card

API endpoint card with method pill and path.

```html
<div class="api-card">
  <div class="api-card-header">
    <span class="api-method api-post">POST</span>
    <span class="api-path">/api/documents/:id/share</span>
    <span class="api-desc">Create share link</span>
  </div>
</div>
```

Method variants: `api-get` (blue), `api-post` (green), `api-put` (amber), `api-del` (red), `api-ws` (indigo).

Used by: RFC

### schema-block

Data model table with field, type, and description columns.

```html
<div class="schema-block">
  <div class="schema-label">table_name</div>
  <div class="schema-row schema-required">
    <span class="schema-field">column_name</span>
    <span class="schema-type">uuid</span>
    <span class="schema-desc">Description</span>
  </div>
</div>
```

Used by: RFC

### diagram-card

Container for Mermaid diagrams. Wrap all mermaid content in this.

```html
<div class="diagram-card">
  <div class="diagram-label">System Architecture</div>
  <div class="mermaid">graph LR
    A[Client] --> B[Server]
  </div>
</div>
```

Used by: RFC, PRD

---

## Decision Components

### option-card

Alternative comparison with chosen/rejected verdict and pros/cons grid.

```html
<div class="option-card selected">
  <div class="option-header">
    <span class="option-name">Option A: Yjs CRDT</span>
    <span class="option-verdict verdict-chosen">Chosen</span>
  </div>
  <div class="option-desc">Description of the approach.</div>
  <div class="pros-cons">
    <div class="pros-col"><div class="pc-label">Pros</div><ul><li>Pro item</li></ul></div>
    <div class="cons-col"><div class="pc-label">Cons</div><ul><li>Con item</li></ul></div>
  </div>
</div>
```

Used by: RFC

### implication-card

Action card from research findings. Color-coded: build (green), avoid (red), watch (blue).

```html
<div class="implication-card build">
  <div class="implication-label">Build</div>
  <div class="implication-title">Ingest Figma Variables API first</div>
  <div class="implication-text">Reasoning and details.</div>
  <div class="implication-ref">Supports: Bet #1 &middot; Based on: Findings 3, 4</div>
</div>
```

Used by: Research

### action-card

Competitive response action. Color-coded: exploit (green), defend (amber), monitor (blue).

```html
<div class="action-card exploit">
  <div class="action-label exploit">Exploit</div>
  <div class="action-text"><strong>Double down on X.</strong> Supporting reasoning.</div>
</div>
```

Used by: Competitor

---

## Comparison Components

### competitive-table

Feature matrix with "us" column highlighted.

```html
<div class="table-wrap">
  <table>
    <thead><tr><th>Capability</th><th class="us-col">Us</th><th>Competitor</th></tr></thead>
    <tbody><tr><td>Feature</td><td class="us-col"><span class="check">&#10003;</span></td><td><span class="cross">&#10005;</span></td></tr></tbody>
  </table>
</div>
```

```css
.us-col { background: rgba(91,91,214,0.04); }
th.us-col { background: rgba(91,91,214,0.08); color: var(--accent-text); }
.check { color: var(--positive); font-weight: 700; }
.cross { color: var(--negative); font-weight: 700; }
.partial { color: var(--warning); font-weight: 600; }
```

Used by: PRD, Strategy, Competitor, Landscape

### scored-bars

Dimension scoring with colored fill bars. Use for threat assessment or strength/weakness scoring.

```html
<div class="score-item">
  <div class="score-header"><span class="score-name">Distribution</span><span class="score-val">9/10</span></div>
  <div class="score-bar"><div class="score-fill high" style="width:90%"></div></div>
</div>
```

Fill variants: `.high` (green), `.medium` (amber), `.low` (red).

Used by: Competitor

---

## People Components

### persona-card

ICP persona with avatar, role, and structured details. Use in 2-3 column grid.

```html
<div class="persona-card">
  <div class="persona-header">
    <div class="persona-avatar" style="background:linear-gradient(135deg,#818CF8,#5B5BD6)">FE</div>
    <div><div class="persona-role">Frontend Engineer</div><div class="persona-context">Ships components daily</div></div>
  </div>
  <div class="persona-details">
    <div class="persona-detail"><span class="detail-label">Job</span><span class="detail-value">Turn designs into components</span></div>
    <div class="persona-detail"><span class="detail-label">Pain</span><span class="detail-value">40% time on pixel-matching</span></div>
  </div>
</div>
```

Used by: Strategy

---

## Timeline Components

### phase-group

Issue breakdown grouped by implementation phase.

```html
<div class="phase-group">
  <div class="phase-label">Phase 1 — Foundation (Week 3-5)</div>
  <div class="issue-row">
    <span class="issue-id">PM-093</span>
    <span class="issue-title-text">Hocuspocus server setup</span>
    <span class="issue-size">M</span>
    <span class="issue-dep">&rarr; PM-094</span>
  </div>
</div>
```

Used by: RFC, PRD

### activity-feed

Unified chronological timeline for events, comments, PR links.

```html
<div class="activity-item">
  <div class="activity-avatar" style="background:linear-gradient(...)">AT</div>
  <div class="activity-event">
    <div class="activity-event-line"><strong>Alex T.</strong> commented <span class="activity-time">Apr 8</span></div>
    <div class="activity-comment">Comment content here.</div>
  </div>
</div>
```

Used by: Issue

### rollout-timeline

Vertical timeline for phased rollout plans.

```html
<div class="timeline">
  <div class="timeline-item done">
    <div class="timeline-dot"></div>
    <div class="timeline-phase">Phase 0 — Spike</div>
    <div class="timeline-desc">Description.</div>
  </div>
  <div class="timeline-item current">...</div>
  <div class="timeline-item">...</div>
</div>
```

States: `.done` (green dot), `.current` (accent dot with glow ring), default (outline dot).

Used by: PRD

---

## Layout Components

### two-col (issue detail)

Two-column layout with content left and sticky metadata sidebar right.

```html
<div class="two-col">
  <div class="main-content">...</div>
  <aside class="sidebar">
    <div class="sidebar-card">
      <div class="sidebar-field">
        <span class="sidebar-label">Status</span>
        <span class="sidebar-value">...</span>
      </div>
    </div>
  </aside>
</div>
```

```css
.two-col { display: grid; grid-template-columns: 1fr 280px; gap: 2.5rem; align-items: start; }
.sidebar { position: sticky; top: 2rem; }
```

Used by: Issue

### horizon-grid

Now / Next / Later three-column layout for strategic horizons.

```html
<div class="horizon-grid">
  <div class="horizon-col horizon-now">
    <div class="horizon-label">Now</div>
    <div class="horizon-confidence">High confidence</div>
    <ul class="horizon-items"><li>Item</li></ul>
  </div>
  <div class="horizon-col horizon-next">...</div>
  <div class="horizon-col horizon-later">...</div>
</div>
```

Used by: Strategy

### positioning-map

CSS-only 2x2 scatter plot with dots positioned by percentage.

```html
<div class="positioning-map">
  <span class="axis-top">High fidelity</span>
  <span class="axis-bottom">Low fidelity</span>
  <div class="dot us" style="left:78%; bottom:82%; width:30px; height:30px;">
    <span class="dot-label">Us</span>
  </div>
  <div class="dot competitor" style="left:68%; bottom:35%; width:24px; height:24px;">
    <span class="dot-label">Competitor</span>
  </div>
</div>
```

Used by: Strategy, Landscape

---

## Meta Components

### source-list

Numbered source references with type badges.

```html
<div class="source-item">
  <span class="source-num">1</span>
  <div class="source-content">
    <span class="source-title">Article Title</span>
    <span class="source-type">Docs</span>
    <br><span class="source-url">url.com/path</span>
  </div>
</div>
```

Type badges: Docs, Survey, Talk, Spec, Report, Primary.

Used by: Research

### question-item

Open question with numbered circle and owner/due metadata.

```html
<div class="question-item">
  <div class="question-num">1</div>
  <div>
    <div class="question-text">The question?</div>
    <div class="question-meta">Owner &middot; due date &middot; context</div>
  </div>
</div>
```

Used by: PRD, RFC, Research

### decision-log

Reverse-chronological decision entries with date and author.

```html
<div class="decision-item">
  <div class="decision-date">Apr 2</div>
  <div class="decision-text"><strong>Decision made.</strong> Reasoning. <em>— Author</em></div>
</div>
```

Used by: PRD, RFC

---

## Competitor-Specific Components

### competitor-card

Overview card for competitor grid view. Left border color = tier.

```html
<div class="comp-card tier-direct">
  <div class="comp-card-header">
    <span class="comp-card-name">Competitor Name</span>
    <span class="comp-tier direct">Direct</span>
  </div>
  <div class="comp-card-desc">One-line description.</div>
  <div class="comp-card-stats">
    <div><span class="comp-stat-val">2M+</span><span class="comp-stat-lbl">Users</span></div>
  </div>
  <div class="comp-card-bar">
    <div class="threat-bar"><div class="threat-fill high" style="width:78%"></div></div>
    <span class="threat-score">78</span>
  </div>
</div>
```

Tier variants: `.tier-direct` (red), `.tier-adjacent` (amber), `.tier-indirect` (gray).

Used by: Landscape

### feed-item

Competitor activity timeline entry with category icon.

```html
<div class="feed-item">
  <div class="feed-icon feed-icon-product">P</div>
  <div class="feed-content">
    <div class="feed-head">
      <span class="feed-type">Product</span>
      <span class="feed-date">Mar 22</span>
    </div>
    <div class="feed-text"><strong>Feature launched.</strong> Details.</div>
  </div>
</div>
```

Icon variants: `feed-icon-product` (blue), `feed-icon-pricing` (green), `feed-icon-hiring` (amber), `feed-icon-funding` (purple), `feed-icon-msg` (indigo).

Used by: Competitor

---

## Strategy-Specific Components

### bet-card

Numbered strategic priority with anti-bet.

```html
<div class="bet-card">
  <div class="bet-number">1</div>
  <div class="bet-content">
    <div class="bet-title">Bet title as action statement</div>
    <div class="bet-desc">Why this bet matters.</div>
    <div class="bet-anti"><strong>Not betting on:</strong> What we deliberately exclude.</div>
  </div>
</div>
```

Used by: Strategy

### tenet-item

Numbered guiding principle / decision rail.

```html
<div class="tenet-item">
  <span class="tenet-num">01</span>
  <div class="tenet-text"><strong>Principle name.</strong> Explanation of when/how it applies.</div>
</div>
```

Used by: Strategy

### success-card

Target metric with current baseline.

```html
<div class="success-card">
  <div class="success-val">10K</div>
  <div class="success-label">Active teams</div>
  <div class="success-baseline">today: 2,400</div>
</div>
```

Used by: Strategy, PRD
