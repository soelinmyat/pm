---
type: backlog-issue
id: "PM-029"
title: "Navigation Restructure — Knowledge Base Umbrella"
outcome: "Dashboard navigation reflects PM's workflow hierarchy with four primary sections: Home, Proposals, Backlog, Knowledge Base — where KB groups Research, Competitors, and Strategy as sub-tabs"
status: drafted
parent: "dashboard-proposal-hero"
children: []
labels:
  - "dashboard"
  - "ux"
priority: medium
research_refs:
  - pm/research/dashboard-proposal-centric/findings.md
created: 2026-03-17
updated: 2026-03-17
---

## Outcome

The dashboard nav bar changes from `Home | Research | Strategy | Backlog` to `Home | Proposals | Backlog | Knowledge Base`. Research, Competitors, and Strategy become sub-tabs within the Knowledge Base page. All existing URLs continue to resolve (via redirects or direct handling).

Before: five equal-weight nav items with no hierarchy. After: four items reflecting the actual workflow priority (proposals > backlog > reference material).

## Acceptance Criteria

1. `navLinks` array in `dashboardPage()` updated to: Home (`/`), Proposals (`/proposals`), Backlog (`/backlog`), Knowledge Base (`/kb`).
2. New `/kb` route renders a Knowledge Base page with sub-tabs: Research, Competitors, Strategy.
3. Sub-tabs render the same content as current `/research`, `/strategy` pages.
4. `/kb` route uses server-side tab activation via query parameter: `/kb?tab=research`, `/kb?tab=competitors`, `/kb?tab=strategy`. Default tab (no param) is Research. No client-side hash routing — consistent with the server-rendered pattern used everywhere else in the dashboard.
4a. Existing URLs `/research`, `/strategy` redirect to `/kb?tab=research`, `/kb?tab=strategy` respectively. `/competitors` redirects to `/kb?tab=competitors`. Old URLs continue to work via HTTP 302 redirects.
5. Competitor detail pages (`/competitors/{slug}`) continue to work.
6. Research topic pages (`/research/{slug}`) continue to work.
7. Active nav highlighting: Knowledge Base nav item highlighted when URL is `/kb`, `/research`, `/research/{slug}`, `/competitors`, or `/competitors/{slug}`. Proposals nav item highlighted on `/proposals` and `/proposals/{slug}`. Home highlighted on `/`. Backlog highlighted on `/backlog` and `/backlog/{slug}`.

## User Flows

```mermaid
graph TD
    A[User clicks Knowledge Base in nav] --> B[/kb page loads]
    B --> C[Default sub-tab: Research]
    C --> D{User clicks sub-tab}
    D -->|Research| E[Research content - same as current /research]
    D -->|Competitors| F[Competitor list + profiles]
    D -->|Strategy| G[Strategy content - same as current /strategy]
    E --> H{User clicks research topic}
    H --> I[/research/topic-slug - still works]
    F --> J{User clicks competitor}
    J --> K[/competitors/slug - still works]
    %% Source: pm/research/dashboard-proposal-centric/findings.md — Finding 5: hierarchical nav beats flat tabs
```

## Wireframes

[Wireframe preview](pm/backlog/wireframes/dashboard-proposal-hero.html) — see Screen 3a, Knowledge Base with sub-tabs.

## Competitor Context

Productboard's current dashboard uses flat peer-level navigation across Initiatives, Features, Insights, and Roadmap — users report disorientation when switching contexts between these equally-weighted sections. PM currently replicates this antipattern with Home, Research, Strategy, Backlog as equal peers. The four-item hierarchy with KB as a reference shelf implements the "working area vs. knowledge shelf" mental model that dashboard UX research identifies as optimal (Finding 5). Table stakes UX hygiene, but required infrastructure before the proposal gallery can be properly surfaced.

## Technical Feasibility

**Build-on:** `dashboardPage()` nav generation is a simple array swap (server.js line 720-725). Existing `.tabs` CSS (lines 500-508) provides sub-tab UI. All content handlers (`handleResearchPage`, `handleStrategyPage`, `handleCompetitorDetail`) remain unchanged.

**Build-new:** `handleKnowledgeBasePage()` that wraps existing content handlers under a tabbed interface. Redirect logic for old URLs.

**Risk:** Low. The content and handlers are unchanged — only the navigation wrapper changes. Old URL redirects prevent external link breakage.

## Research Links

- [Dashboard Proposal-Centric Redesign](pm/research/dashboard-proposal-centric/findings.md)

## Notes

- This is table stakes, not a differentiator. Keep implementation simple.
- The `.tabs` CSS component already exists and matches the wireframe sub-tab pattern.

## Dependencies

- None — can be implemented independently. However, should ship before or alongside PM-028 so the Proposals nav item has a destination.
