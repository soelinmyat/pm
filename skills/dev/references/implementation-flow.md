# Implementation Flow

Shared implementation-phase guidance for inline and delegated Dev workers. Phase routing, quality gates, integration, delivery, and cleanup remain owned by the root Dev session.

**Context:** Step 05 (Implementation) uses this file for one assigned work unit or for root-owned inline work. A delegated worker may inspect, edit, test, and make its scoped commit. It never integrates another unit, runs aggregate gates, pushes, creates a PR, merges, updates trackers, or cleans the root worktree.

## Agent Scope

The dispatching brief in Step 05 always specifies scope. This note is a cross-check:

| Mode | Worker scope | Root scope |
|------|---|---|
| Inline | Setup, implementation, targeted tests, scoped commit | Integration, aggregate verification, quality gates, delivery, retro |
| Delegated work unit | Assigned paths, contract, tests, structured result | Result validation, integration, aggregate verification, quality gates, delivery, retro |

After implementation and scoped evidence, **stop** and return the structured work-unit result. Root asks the session runner for the next phase.

---

## Root-owned lifecycle context

```
Setup -> Implement -> Design Critique (if routed) ->
  QA (if UI, iterates on Fail) ->
  Review (M/L/XL) or Code Scan (XS/S) -> Verification -> Gate Check -> Push + PR ->
  Merge -> Cleanup -> Done

```

Workers own only Setup and Implement in this diagram.

## Git Hygiene (HARD RULES)

These apply to every commit:
- NEVER use `git add -A` or `git add .` — always stage specific files by name
- NEVER commit to {DEFAULT_BRANCH} — verify you're on the correct branch: `git branch --show-current`
- NEVER commit without running tests first
- Commit often, commit small — one logical change per commit
- If you see untracked files you didn't create, leave them alone
- Before your first commit, verify: `git rev-parse --show-toplevel` matches your worktree path

---

## Step 1: Setup

```bash
cd {CWD}  # worktree path
git branch --show-current  # verify correct branch
```

Install dependencies using the project's install command (read from AGENTS.md, or infer: `pnpm install` if pnpm-lock.yaml exists, `npm install` if package-lock.json, `yarn` if yarn.lock, `bundle install` if Gemfile, `pip install` if requirements.txt).

**Worktree environment prep:** Read AGENTS.md for workspace setup commands. Common patterns:

| Pattern | Detection | Action |
|---------|-----------|--------|
| Dependency install | `package.json` exists, `node_modules` missing | `pnpm install` / `npm install` / `yarn` |
| Dependency install | `Gemfile` exists, gems missing | `bundle install` |
| Code generation | AGENTS.md lists codegen commands | Run them (API specs, types, schemas) |
| Shared package build | Monorepo with shared packages | Build shared packages before consuming apps |
| Database setup | AGENTS.md lists DB commands | Run migrations if needed |

If AGENTS.md doesn't specify workspace setup, fall back to: install dependencies + run the project's test command once.

Verify clean baseline: run the project test command (from AGENTS.md or convention detection). Classify a failure from its observed diagnostic: environment/setup, pre-existing defect, or task regression. Repair only within authorized ownership; report unrelated baseline defects and missing infrastructure rather than silently expanding a single-issue task. Never call a command with zero discovered tests a clean baseline.

---

## Step 2: Implement

### Affected-surface detection (first step)

Route by the boundaries changed and the behavior affected, not mutually exclusive directory labels. Record source evidence for each affected surface: backend/domain/API, web, mobile, shared contract/types, jobs/data, and configuration. Backend plus web or mobile is full-stack work; web plus mobile is a multi-client change. A backend-only diff can still affect existing clients.

Exercise the relevant unit/domain checks, changed boundary integration checks, and user journey checks for each affected surface. Do not let a frontend label bypass changed backend logic, authorization, migration, or API tests. Do not infer that no UI files changed means no user-visible behavior changed. Keep the current canonical UI-platform enum for routing; describe additional affected boundaries in intake/implementation evidence rather than inventing schema fields.

Examples:
- Leave endpoint + web approval form: backend date/permission rules, contract compatibility, web validation and entry → approve → return journey.
- Shared serializer used by web/mobile: producer tests and both consumers' relevant integration/empty/optional-state cases.
- Visual-only spacing adjustment: supported viewport/rendered assessment and repository-required checks; do not invent a business-logic RED test.

### Contract Sync Gate (hard gate when project uses API contracts)

**Routed by changed contracts and their consumers.** Inspect boundary impact even when the work is described as backend-only.

**Detection:** Read AGENTS.md for contract sync tooling. Common patterns:
- OpenAPI/Swagger (rswag, swagger-codegen, etc.)
- GraphQL codegen
- tRPC (type-safe by default, may not need explicit sync)
- Manual types (no contract gate, validated at integration test time)

| Change | Contract verification |
|--------|-----------------------|
| Producer/API/schema changes with tooling | Regenerate/check the producer contract and verify compatibility with affected existing consumers, even without frontend edits |
| Web/mobile consumer changes with tooling | Verify generated types and relevant fixtures/mocks against the producer contract; exercise the changed integration |
| No contract tooling | Verify the actual producer/consumer boundary with meaningful integration tests; lack of codegen is not a compatibility exemption |
| No contract behavior affected | Explain why the boundary is unchanged and retain applicable repository checks |

Use AGENTS.md commands. When schemas change, update generated artifacts and mocks with schema-valid optional/error variants; two agreeing mocks cannot prove a real boundary. Confirm request/response semantics, authorization, nullability, version compatibility and deploy-window behavior. Required boundary verification unavailable → report blocked/limited coverage under the dispatch contract, never call an unexecuted contract check passed.

### Component Pattern Scan (UI tasks only)

Before creating any new UI component (drawer, modal, dialog, sheet, card, panel, dropdown, popover, form layout, list/table), scan the codebase for existing instances of the same pattern:

```bash
# Example: about to build a drawer
grep -rl "drawer\|Drawer\|Sheet" apps/{app}/src/components/ apps/{app}/src/features/ --include="*.tsx" | head -20
```

**If an existing component fits the semantic task and supported behavior:** Reuse it. Verify the actual comparable screen rather than matching the component name alone. If the component is unsuitable, explain the concrete behavior/accessibility/maintenance mismatch and choose the smallest coherent adaptation; existing code is not automatically a quality standard.

**If no existing component exists but you need multiple instances in this task:** Build the first instance as a reusable, prop-driven component in the appropriate components directory. Then import and configure it for each use case. Never copy-paste a component and tweak it.

**If you're building across multiple tasks in a multi-task RFC:** Check what earlier tasks already built. Reuse their components. Extend it when the added behavior remains coherent; avoid boolean-prop combinations that mix unrelated responsibilities. A separate component can be justified by different semantics or lifecycle.

Log the scan result in `.pm/dev-sessions/{slug}/session.json`:
```
- Pattern scan: Reusing existing Drawer from src/components/ui/Drawer.tsx
  OR
- Pattern scan: No existing drawer. Creating shared Drawer component first.
  OR
- Pattern scan: Skipped (no new UI components)
```

### Write code

1. Read the plan file **end-to-end before writing code**. Plans may contain a "Revised" or "Updated" section that supersedes earlier code blocks. If instructions contradict, verify which revision is explicitly approved and current; a later timestamp alone does not establish authority. Surface unresolved differences that materially change behavior. When in doubt, check for epic review fix annotations (e.g., "Epic review fix:").
2. Follow `subagent-dev.md` (in this directory) for independent tasks
3. Follow `tdd.md` (in this directory) for each feature
4. Commit after each logical group of changes

### TDD Evidence Gate

For behavior-changing code, keep the failing and final passing test output as artifacts, record the implementation phase result with its passing `test` evidence at current HEAD, then run `node "$PM_PLUGIN_ROOT/scripts/dev-session.js" gate --session <absolute session.json> --name tdd`. The command derives the row from that recorded evidence, validates it with `dev-gate-check.js`, and refuses to write when the evidence is missing or stale. Never hand-edit `gates.json`.

Docs-only, config-only, generated-only, or lockfile-only changes may record `tdd: skipped` with `--status skipped --reason "<concrete reason>"`; the command rejects a skip the gate checker would reject. A missing `tdd` row blocks the pre-push gate checker.

#### Sub-agent parallelism budget

Dispatch one agent per independent problem domain. Let them work concurrently.

- Default max: **3 concurrent agents**
- Use **1 agent** when tasks touch shared files or shared state
- Do NOT parallelize when tasks have implicit dependencies (shared DB state, import chains, config files)
- Expand beyond 3 only when file ownership is clearly disjoint
- Every agent prompt must include: explicit cwd, target files, and done criteria
- **Don't use** when failures are related (fix one might fix others), need full system state, or agents would interfere
- After agents return: review summaries, check for conflicts, run full suite, spot check for systematic errors

See `test-layers.md` (same directory) for general test layer routing principles. Note that `test-layers.md` provides universal testing principles, while the RFC's **Execution Contract** gives the default handoff and the **Test Strategy** section gives the feature-specific testing plan — which layers to exercise, what infrastructure is needed, and the verification commands. Implementation agents should read the Execution Contract first, then the Test Strategy contract from the RFC (validated by the gate in `02-intake.md`) as the authoritative testing plan for the current feature.

### E2E Decision

**Web E2E (Playwright):**
- **Write E2E:** CRUD flow, multi-step journey, auth-dependent behavior, changed discoverability/navigation or recovery affecting task completion
- **Skip E2E:** Visual-only changes with no interaction/navigation effect, internal refactor covered at relevant boundaries, backend-only with no affected client journey

**Mobile E2E (Maestro or project-specific):**
- **Write E2E:** CRUD flow, multi-step journey, auth flows, navigation-heavy flows
- **Skip E2E:** Purely visual change, internal refactor, backend-only, component-only change covered by component tests

Read AGENTS.md for E2E test locations, commands, and prerequisites.

---

## Handoff to root

Return a structured `completed`, `blocked`, or `failed` result as defined by `worker-contract.md`. Do not return `merged`. Root validates and integrates every unit, runs aggregate tests, and follows the current phase-local contracts:

- `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/06-design-critique.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/07-qa.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/08-review.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/09-ship.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/10-retro.md`

---

## Debugging

When tests fail or unexpected behavior occurs during implementation, read `debugging.md` in this directory and follow its systematic debugging process.
