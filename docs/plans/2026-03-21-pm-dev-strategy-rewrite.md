# PM-045: Rewrite strategy.md for Product Engineer Positioning

**Parent:** PM-044 (Merge PM and Dev plugins)
**Date:** 2026-03-21

## Problem

The current `pm/strategy.md` defines PM as a plugin that "ends at the groomed ticket" — a deliberate boundary between PM and dev work. PM-044 overrides this boundary because agentic coding blurs PM/engineer roles. The strategy document must be rewritten to reflect the merged plugin's identity: a workflow optimization tool for product engineers, covering the full lifecycle from idea to shipped code.

The rewrite is sequencing-critical — all subsequent PM-044 sub-issues reference the updated strategy for alignment checks during grooming.

## Section-by-Section Changes

### Section 1: Product Identity

**Current:** "PM (Product Memory) is a free, open-source plugin for AI coding assistants that gives small product teams structured workflows for competitive research, product strategy, and feature grooming — all inside the editor."

**Replace with:** New identity statement centered on "structured workflows for the product engineer, on top of whatever AI coding assistant they already use." Key changes:
- Replace "small product teams" with "the product engineer"
- Expand scope beyond "competitive research, product strategy, and feature grooming" to include the full lifecycle (research → strategy → grooming → implementation → review → merge)
- Keep "free, open-source plugin" and "inside the editor" framing
- Keep "persistent knowledge base that compounds over time" — this still applies

### Section 2: ICP and Segmentation

**Current:** Primary ICP is "small product squads (2-8 people)" with secondary segments of solo founders and PMs at larger companies.

**Replace with:** Primary ICP is explicitly "the product engineer" — the person who owns both product decisions and implementation. Support with market evidence:
- Anthropic/Cat Wu quote: "Designers ship code, engineers make product decisions, product managers build prototypes and evals"
- ~$165K avg US comp signal (Bentes, Gottlob, Sachdeva sources)
- Gibson Consultants March 2026: "messy middle" where PMs build prototypes with AI tools
- Deloitte/CIO.com: "Agentic Product Managers" as emerging role

Secondary segments remain similar but reframed:
- Technical founders who own full lifecycle (previously "solo founders")
- Small-squad builders (2-5) where everyone touches both product and code

Keep "Buyer = User" — unchanged.

### Section 3: Core Value Prop and Differentiation

**Current:** Value prop focused on "upstream product work" (research, strategy, competitive analysis, grooming). Differentiation against Productboard Spark, CI tools, general AI prompts.

**Replace with:** Value prop reframed around three goals:
1. **Build valuable products** — research, strategy, competitive analysis ground decisions in evidence
2. **Build efficiently** — groomed issues flow into implementation with zero manual handoff
3. **Manage cognitive load** — structured workflows reduce context switching across the lifecycle

Update differentiation to include dev lifecycle competitors:
- Keep Productboard Spark comparison (enterprise SaaS vs. editor-native)
- Keep CI tools comparison (enterprise sales vs. builder-focused)
- Keep general AI prompts comparison (ephemeral vs. persistent)
- **Add:** vs. Compound Engineering — deliberately excluded PM/research/strategy; purely dev lifecycle
- **Add:** vs. Kiro — spec-driven but assumes specs exist; no upstream product work (Martin Fowler critique)
- **Add:** vs. MetaGPT — defines PM+Engineer roles but is a research framework, not a production plugin

### Section 4: Competitive Positioning

**Current:** "PM occupies the bottom-left quadrant: editor-native tools for individual builders and small squads."

**Replace with:** Updated positioning that names the specific gap:
- No competitor offers an integrated research → grooming → implementation → merge pipeline
- Compound Engineering's deliberate PM exclusion = the gap on the dev side
- Kiro's spec-blindness (assumes specs exist, can't detect spec quality) = the gap on the spec side
- PM closes both gaps by providing upstream product work AND connecting it to dev lifecycle

Keep the quadrant framing but update axes:
- Y-axis: standalone SaaS → editor-native (unchanged)
- X-axis: dev-only → full product lifecycle (updated from "individual builders")

Update "where we win" to include: groomed context flowing into implementation, reducing ceremony for well-researched issues.

Update "where we intentionally don't compete" to align with new non-goals (Section 7).

### Section 5: Go-to-Market

**Minimal changes.** The GTM strategy is mostly independent of the PM/dev merge:
- Update plugin marketplace list if needed (already includes Claude Code, Cursor, Codex, Gemini CLI)
- Keep "free forever" positioning
- Keep expansion path to productmemory.io
- Update keyword targets if the "product engineer" angle creates new SEO opportunities — but this is a follow-up task, not part of this rewrite

### Section 6: Current Phase and Priorities

**Current:** Three priorities: depth of product context, quality of groomed output, plugin ecosystem reach.

**Replace with:** Updated priorities reflecting the merged plugin:
1. **Groom-to-dev handoff quality.** Groomed issues should flow into implementation with minimal ceremony. This is the unique value of the merge — no competitor connects upstream PM work to dev lifecycle.
2. **Depth of product context.** Keep this priority (input sources, analytics, issue trackers). Still the moat.
3. **Plugin ecosystem reach.** Keep this priority. The merged plugin needs to work across Claude Code, Cursor, Codex, Gemini CLI.

Note: "quality of groomed output" is subsumed by priority #1 — groomed output quality is now measured by how well it feeds implementation, not in isolation.

### Section 7: Explicit Non-Goals

**Current non-goals:**
1. "No development or implementation. PM ends at the groomed ticket."
2. "No sprint planning or project management."
3. "No product analytics."
4. "No enterprise sales motion."

**Replace:**

**Non-Goal #1 (replaced):** "Not an AI model, coding platform, or infrastructure tool. Workflow optimization layer for product engineers. Does not serve platform engineering, infrastructure operations, or production incident management." This replaces the old "PM ends at the groomed ticket" boundary with a role-based boundary.

**Non-Goal #2 (reframed):** "Not an enterprise project management tool. No sprint planning, velocity tracking, capacity management, approval workflows, or role-based access control. Small teams share context through the repo — scales to the squad, not the org."

**Non-Goal #3 (keep as-is):** "No product analytics." Still valid — PM ingests analytics, doesn't collect them.

**Non-Goal #4 (keep as-is):** "No enterprise sales motion." Still valid — free, open-source, self-serve.

### Section 8: Success Metrics

**Current:** Leading indicators (stars, installs, repeat usage, KB depth). Lagging indicators (contributions, organic traffic, cloud waitlist).

**Add two new leading indicators:**
- **Groomed issues completing in fewer steps:** Measures whether the groom→dev handoff actually reduces implementation ceremony. Track: number of dev flow steps skipped when a groomed issue is detected vs. an ungroomed issue.
- **One-session shipping rate:** Percentage of groomed issues that go from "ready" to merged PR in a single dev session. This is the ultimate measure of the merged workflow's value.

Keep all existing metrics — they remain valid.

## Task Breakdown

### Task 1: Update Section 1 (Product Identity)

**File:** `pm/strategy.md`

Replace the product identity paragraph with the new framing. Key phrase: "Structured workflows for the product engineer, on top of whatever AI coding assistant they already use." Expand scope to full lifecycle. Keep free/open-source and editor-native framing.

### Task 2: Update Section 2 (ICP and Segmentation)

**File:** `pm/strategy.md`

Replace primary ICP with "the product engineer." Add market evidence citations (Cat Wu, Gibson Consultants, $165K comp signal, Deloitte/CIO.com). Reframe secondary segments. Keep "Buyer = User."

### Task 3: Update Section 3 (Core Value Prop and Differentiation)

**File:** `pm/strategy.md`

Reframe value prop around three goals (build valuable products, build efficiently, manage cognitive load). Add Compound Engineering, Kiro, and MetaGPT to differentiation. Keep existing competitor comparisons.

### Task 4: Update Section 4 (Competitive Positioning)

**File:** `pm/strategy.md`

Name the specific competitive gap. Add Compound Engineering PM exclusion and Kiro spec-blindness. Update quadrant framing. Update "where we win" and "where we don't compete."

### Task 5: Update Section 6 (Current Phase and Priorities)

**File:** `pm/strategy.md`

Replace priority #1 with groom-to-dev handoff quality. Keep priorities #2 and #3. Note that Section 5 (GTM) needs only minimal touch-up.

### Task 6: Replace Non-Goals #1 and #2

**File:** `pm/strategy.md`

Replace Non-Goal #1 (old dev boundary) with new role-based boundary. Reframe Non-Goal #2 with explicit scope list. Keep Non-Goals #3 and #4.

### Task 7: Add new success metrics

**File:** `pm/strategy.md`

Add "groomed issues completing in fewer steps" and "one-session shipping rate" as leading indicators. Keep all existing metrics.

### Task 8: Update frontmatter

**File:** `pm/strategy.md`

Update the `updated` date to 2026-03-21.

### Task 9: Backlog alignment audit

**Files:** All files in `pm/backlog/*.md`

Audit each backlog item for alignment with the updated strategy. Specifically check:
- Items referencing old Non-Goal #1 ("PM ends at the groomed ticket") that may have outdated scope boundaries
- Items whose outcomes or ACs assume PM and dev are separate plugins
- Items whose priorities may shift given the new "groom-to-dev handoff quality" priority

**Known items to check closely:**
- `pm-dev-groom-handoff.md` (PM-050) — should align naturally since it's a sibling under PM-044
- `groom-em-feasibility-review.md` (PM-003) — done, but its EM persona may reference old boundaries
- `prd-grade-output.md` — grooming quality items may need scope expansion
- All `pm-dev-*.md` items — siblings under PM-044, should align by design

**Output:** Add a "Backlog Alignment Notes" section to the bottom of `pm/strategy.md` (or as a separate committed artifact) listing any flagged items and the recommended action (update scope, update ACs, no change needed).

### Task 10: Final review

Read the completed `pm/strategy.md` end-to-end and verify:
- Internal consistency across all 8 sections
- No references to old "PM ends at the groomed ticket" boundary
- Market evidence citations are accurate (cross-check against `pm/research/pm-dev-merge/findings.md`)
- Non-goals are crisp and non-overlapping
- Success metrics are measurable

## Ordering and Dependencies

- **No upstream dependencies.** PM-045 is the first sub-issue of PM-044 and must be completed before other sub-issues begin (they reference strategy for alignment).
- **Downstream dependents:** All PM-044 sub-issues (PM-046 through PM-051) reference strategy.md for alignment during grooming.
- Tasks 1-8 can be done in a single pass through the file (sequential edits to one file).
- Task 9 (backlog audit) is independent of Tasks 1-8 and can run after or in parallel.
- Task 10 (final review) must run after all other tasks.

## Out of Scope

- SEO keyword research for "product engineer" positioning (follow-up)
- Changes to `pm/landscape.md` or `pm/competitors/` (separate update if needed)
- Changes to plugin source code, skills, or scripts (PM-045 is strategy only)
- Updates to README.md or install guides (PM-046+ handle those)
- Cloud product (productmemory.io) strategy changes
