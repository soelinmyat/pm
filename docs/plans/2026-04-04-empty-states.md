# PM-126: Empty States and Partial-Data States

## Header

**Goal:** Replace every "no data" / blank area in the dashboard with activation prompts that explain what the section does and show a click-to-copy command to populate it. Partial-data states show populated sections normally and guide users to fill gaps.

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). Empty states are scattered across ~20 locations in handler functions. CSS for `.empty-state` is at lines 724-736. Click-to-copy JS is provided by PM-125.

**Upstream dependency:** PM-125 must land first (provides click-to-copy JS). PM-117 must land first (provides `--space-*` tokens).

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 724-736 | Upgrade `.empty-state` CSS (dashed border, centered, structured) |
| `scripts/server.js` | 3640-3652 | Rewrite home empty state for non-technical viewers |
| `scripts/server.js` | 3979-3984 | Upgrade proposals empty state |
| `scripts/server.js` | 4014 | Upgrade landscape empty state |
| `scripts/server.js` | 4079-4081 | Upgrade competitors empty state |
| `scripts/server.js` | 4088-4096 | Upgrade research topics empty state |
| `scripts/server.js` | 4792 | Upgrade strategy empty state |
| `scripts/server.js` | 3023, 3173, 3207 | Upgrade backlog kanban empty states |
| `scripts/server.js` | 5162 | Upgrade shipped empty state |
| `scripts/server.js` | 5214 | Upgrade archived empty state |
| `scripts/server.js` | 1687-1694 | Upgrade "no pm/ directory" empty state |
| `tests/server.test.js` | append | Empty state tests |

**Done criteria:**
- Every empty state uses the `.empty-state` class with dashed border, centered text, title + explanation + click-to-copy command
- Home page empty state explains PM to non-technical viewers first, shows command secondary
- Home page partial state: strategy exists but no proposals shows strategy snapshot + "Start your first feature" CTA
- All command hints use `.click-to-copy` with `data-copy` attribute
- No page shows raw "No data" or blank area without guidance
- All tests pass: `cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test`

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Visual: delete pm/ contents one section at a time, reload each page, verify empty states
```

## Upstream Context

From `pm/research/dashboard-linear-quality/findings.md`:
- Empty states are activation moments, especially for squad adoption
- The biz lead discovers PM via a shared dashboard link and needs to understand what they're looking at
- Format: dashed border, centered text, clear title + one-line explanation + command

## Complete Empty State Inventory

Every page and its empty state message, title, explanation, and click-to-copy CTA:

### Page: No `pm/` directory (line 1687)
| Field | Value |
|-------|-------|
| Title | Welcome to PM |
| Explanation | PM is your team's shared product brain -- strategy, research, proposals, and roadmap in one place. To get started, an engineer needs to initialize the knowledge base. |
| CTA command | `/pm:setup` |
| CTA label | Initialize knowledge base |

### Page: Home -- fully empty (line 3640)
| Field | Value |
|-------|-------|
| Title | Your team's shared product brain |
| Explanation | Strategy, research, proposals, and roadmap in one place. Once content is added, you'll see project health, active sessions, and recent proposals here. |
| CTA command | `/pm:groom` |
| CTA label | Start your first feature |

### Page: Home -- partial (strategy exists, no proposals) (line ~3640)
| Field | Value |
|-------|-------|
| Behavior | Show strategy snapshot + stat cards normally. Replace proposals section with: |
| Title | Ready for your first feature |
| Explanation | Your strategy is set. Start grooming to create a structured proposal with research and scoped issues. |
| CTA command | `/pm:groom` |

### Page: Proposals -- empty (line 3979)
| Field | Value |
|-------|-------|
| Title | No proposals yet |
| Explanation | Proposals are structured feature plans with research, strategy alignment, and scoped issues. |
| CTA command | `/pm:groom` |
| CTA label | Create your first proposal |

### Page: KB Strategy -- empty (line 4792)
| Field | Value |
|-------|-------|
| Title | No strategy defined |
| Explanation | Your product strategy defines ICP, value proposition, competitive positioning, and priorities. |
| CTA command | `/pm:strategy` |
| CTA label | Define your strategy |

### Page: KB Landscape -- empty (line 4014)
| Field | Value |
|-------|-------|
| Title | No landscape research |
| Explanation | The landscape maps your market -- TAM/SAM/SOM, market trends, and positioning opportunities. |
| CTA command | `/pm:research landscape` |
| CTA label | Map your market |

### Page: KB Competitors -- empty (line 4079)
| Field | Value |
|-------|-------|
| Title | No competitor profiles |
| Explanation | Competitor profiles cover features, pricing, API, SEO, and user sentiment for each rival. |
| CTA command | `/pm:research competitors` |
| CTA label | Profile your competitors |

### Page: KB Research Topics -- empty (line 4088)
| Field | Value |
|-------|-------|
| Title | No topic research |
| Explanation | Topic research covers external market research and customer evidence on specific subjects. |
| CTA command | `/pm:research {topic}` |
| CTA label | Research a topic |
| Secondary CTA | `/pm:ingest path/to/evidence` -- Import customer evidence |

### Page: Backlog -- empty (lines 3023, 3173, 3207)
| Field | Value |
|-------|-------|
| Title | No backlog items |
| Explanation | Backlog items are scoped issues created during grooming. They have acceptance criteria, wireframes, and priority. |
| CTA command | `/pm:groom` |
| CTA label | Start grooming |

### Page: Shipped -- empty (line 5162)
| Field | Value |
|-------|-------|
| Title | Nothing shipped yet |
| Explanation | Completed items appear here once their status is set to done. |
| CTA command | (none -- informational only) |

### Page: Archived -- empty (line 5214)
| Field | Value |
|-------|-------|
| Title | No archived items |
| Explanation | Archived items are ideas or issues that were deprioritized. |
| CTA command | (none -- informational only) |

## Task Breakdown

### Task 1: Write empty state tests (RED)

**Test file:** `tests/server.test.js` (append)

Tests to write:
1. `.empty-state` CSS contains `border-style: dashed` (or `border.*dashed`)
2. `.empty-state` CSS contains `text-align: center`
3. Home empty state contains "shared product brain" explanatory text
4. Home empty state contains `.click-to-copy` with `data-copy="/pm:groom"`
5. Proposals empty state contains `.click-to-copy` with `data-copy="/pm:groom"`
6. Strategy empty state contains `.click-to-copy` with `data-copy="/pm:strategy"`
7. Landscape empty state contains `.click-to-copy` with `data-copy="/pm:research landscape"`
8. Competitors empty state contains `.click-to-copy` with `data-copy="/pm:research competitors"`
9. Backlog empty state contains `.click-to-copy` with `data-copy="/pm:groom"`
10. No page handler contains the literal string `'No data'` (audit for orphaned bare messages)
11. Every empty state `<div>` has both a title (`<h2>` or `<h3>`) and a `<p>` explanation

```
Verify: node --test -> 11 new tests FAIL
```

### Task 2: Upgrade .empty-state CSS (lines 724-736)

**Current (lines 724-728):**
```css
.empty-state { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-state h2 { color: var(--text); margin-bottom: 0.5rem; }
.empty-state p { max-width: 420px; margin-left: auto; margin-right: auto; }
.empty-state code { background: var(--accent-subtle); padding: 0.2em 0.5em; border-radius: 4px;
  font-size: 0.85rem; color: var(--accent); }
```

**New:**
```css
.empty-state { text-align: center; padding: var(--space-12) var(--space-6); color: var(--text-muted);
  border: 2px dashed var(--border); border-radius: var(--radius); margin: var(--space-4) 0; }
.empty-state h2 { color: var(--text); margin-bottom: var(--space-2); font-size: var(--text-xl); }
.empty-state h3 { color: var(--text); margin-bottom: var(--space-2); font-size: var(--text-lg); }
.empty-state p { max-width: 480px; margin-left: auto; margin-right: auto; font-size: var(--text-base);
  line-height: 1.6; margin-bottom: var(--space-3); }
.empty-state p:last-of-type { margin-bottom: var(--space-4); }
.empty-state code { background: var(--accent-subtle); padding: 0.2em 0.5em; border-radius: 4px;
  font-size: var(--text-sm); color: var(--accent); }
.empty-state .click-to-copy { margin-top: var(--space-4); }
```

Leave `.empty-state-cta` rules (lines 730-736) unchanged -- those are for the home page CTA which gets its own treatment.

### Task 3: Rewrite home page empty state (lines 3640-3652)

**Current (line 3647-3651):**
```html
<div class="empty-state-cta">
  <h2>Ready to build?</h2>
  <p>Start grooming your first feature...</p>
  <p><code>/pm:groom</code></p>
</div>
```

**New:**
```html
<div class="empty-state-cta">
  <h2>Your team's shared product brain</h2>
  <p>Strategy, research, proposals, and roadmap in one place. Once content is added, you'll see project health, active sessions, and recent proposals here.</p>
  <p><span class="click-to-copy" data-copy="/pm:groom" tabindex="0" role="button"><code>/pm:groom</code><span class="copy-icon" aria-hidden="true">&#x2398;</span></span></p>
  <p style="font-size:var(--text-sm);color:var(--text-muted);margin-top:var(--space-1)">Start your first feature</p>
</div>
```

### Task 4: Add home page partial state

**NOTE:** PM-120 (Home Redesign) rewrites `handleDashboardHome()` to use a new structure with strategy snapshot, proposals section, shipped section, and KB health cards. The old `pulseScoreHtml`, `controlCards`, `kbReferenceHtml`, and `suggestedHtml` variables no longer exist after PM-120. This task must be written against PM-120's output, not the pre-epic codebase.

**Insert a new branch** in the home page conditional, after the fully-empty check. The partial state shows the strategy snapshot (if strategy exists) plus a CTA to start the first feature:

```javascript
} else if (proposalCount === 0) {
  // Partial state: strategy/KB exists but no proposals yet
  body = `${strategySnapshotHtml}
<div class="section">
  <div class="section-header"><span class="section-title">What's coming</span></div>
  <div class="empty-state">
    <h3>Ready for your first feature</h3>
    <p>Your knowledge base has content. Start grooming to create a structured proposal with research and scoped issues.</p>
    <span class="click-to-copy" data-copy="/pm:groom" tabindex="0" role="button"><code>/pm:groom</code><span class="copy-icon" aria-hidden="true">&#x2398;</span></span>
  </div>
</div>
${kbHealthHtml}`;
```

### Task 5: Upgrade all remaining empty states (bulk)

For each of the following locations, replace the existing `<div class="empty-state">` HTML with the structured format from the inventory table above:

1. **Line 3979-3984** -- Proposals empty: add title, explanation, click-to-copy
2. **Line 4014** -- Landscape empty (in `buildLandscapeContent`): add title, explanation, click-to-copy
3. **Line 4079-4081** -- Competitors empty (in `buildCompetitorsContent`): add title, explanation, click-to-copy
4. **Line 4088-4096** -- Topics empty (in `buildTopicsContent`): add title, explanation, click-to-copy for both `/pm:research {topic}` and `/pm:ingest`
5. **Line 4792** -- Strategy empty (in `handleKnowledgeBasePage`): add title, explanation, click-to-copy
6. **Line 3023** -- Backlog kanban empty (in `buildBacklogKanban` or helper): add title, explanation, click-to-copy
7. **Lines 3173, 3207** -- Other backlog view empties: same pattern
8. **Line 5162** -- Shipped empty: title + explanation only (no CTA)
9. **Line 5214** -- Archived empty: title + explanation only (no CTA)
10. **Line 1687-1694** -- No `pm/` directory: title "Welcome to PM", explanation for non-technical viewer, click-to-copy `/pm:setup`

Each replacement follows this template:
```html
<div class="empty-state">
  <h2>{Title}</h2>
  <p>{Explanation}</p>
  <span class="click-to-copy" data-copy="{command}" tabindex="0" role="button">
    <code>{command}</code><span class="copy-icon" aria-hidden="true">&#x2398;</span>
  </span>
</div>
```

For shipped/archived (no CTA), omit the `click-to-copy` span.

### Task 6: Run tests (GREEN)

```
Verify: node --test -> all tests PASS
```

### Task 7: Visual smoke test

Manually verify each empty state by temporarily removing data:
1. Delete `pm/` entirely -- verify "Welcome to PM" state
2. Empty `pm/` (mkdir only) -- verify home empty state
3. Add `strategy.md` only -- verify partial home state + KB strategy populated
4. Navigate to each KB tab with no data -- verify structured empty states
5. Check that click-to-copy works on every empty state CTA
6. Toggle dark/light themes
