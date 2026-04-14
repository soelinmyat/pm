---
name: RFC Review
order: 3
description: Senior engineer review of RFC — architecture, test strategy, complexity (M/L/XL)
---

## RFC Review (M/L/XL)

Senior engineers challenge the RFC — architecture decisions, test strategy, and complexity. This is the last human-interactive gate before implementation.

### The 3 standard RFC reviewers

Dispatch these reviewer intents using `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`. In Claude or Codex-with-delegation, run them in parallel. In Codex without delegation, run the same briefs inline.

**Review as @adversarial-engineer:**

```text
Review this engineering RFC for architecture soundness and risk.

**RFC to review:** {pm_dir}/backlog/rfcs/{slug}.html
**Proposal for reference:** {pm_dir}/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

**Review as @tester:**

```text
Review this engineering RFC for testing strategy and coverage.

**RFC to review:** {pm_dir}/backlog/rfcs/{slug}.html
**Proposal for reference:** {pm_dir}/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

**Review as @staff-engineer:**

```text
Review this engineering RFC for complexity and long-term maintainability.

**RFC to review:** {pm_dir}/backlog/rfcs/{slug}.html
**Proposal for reference:** {pm_dir}/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

### Cross-cutting reviewers (multi-task only)

When `task_count > 1`, also dispatch cross-cutting reviewers. Read `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/cross-cutting-reviewers.md` for the prompts. Scale by task count:

| Tasks with code work | Cross-cutting reviewers | Standard reviewers |
|---|---|---|
| 1 | None | 3 (adversarial, test, staff) |
| 2 | 1 combined (architect + integration + scope) | 3 (adversarial, test, staff) |
| 3+ | 3 parallel (architect, integration, scope) | 3 (adversarial, test, staff) |

Cross-cutting reviewers return compact JSON verdicts. Merge their findings with the standard reviewer findings.

### Handling findings

1. Merge all reviewer outputs. Deduplicate.
2. Fix all **Blocking issues** in the RFC (orchestrator edits directly).
3. Collect all **Advisory items** (non-blocking) from every reviewer. Write them into the RFC's **Advisory Notes** section. Each note includes the reviewer role tag (e.g., `@adversarial-engineer`) and the specific advice. Omit the section if no advisory items were raised.
4. If blocking issues were fixed, re-dispatch reviewers on the updated RFC (max 2 iterations).
5. Commit RFC updates.
6. Update RFC frontmatter to `status: approved`.
7. Update the proposal status to `planned` in `{pm_dir}/backlog/{slug}.md`.
8. **Resolve open questions.** Collect all questions from reviewers and any open questions in the RFC's Risks section. For each:
   - **Answer it** using the proposal (`{pm_dir}/backlog/{slug}.md`), PRD, codebase findings, and research. Most reviewer questions can be answered with context they didn't have access to.
   - **Record the answer** in the RFC's Resolved Questions section: `Q: {question} → A: {answer}`.
   - **Escalate only genuine product decisions** that cannot be derived from existing data. Mark as "Decision needed" with a recommended answer.
   - Update the Change Log section with review iterations, fixes applied, and reviewer verdicts.
   - Commit the updated RFC.
9. **Open RFC in browser.**

   The RFC is already HTML (written in RFC Generation). After resolving questions and updating the Change Log, open it directly:

   ```bash
   open {pm_dir}/backlog/rfcs/{slug}.html
   ```

   Present to the user: "RFC reviewed by {N} engineers. [N] blocking issues found and fixed. Opening RFC in browser."
10. Wait for user approval. Then ask:

    > "RFC approved. Continue to implementation, or stop and resume later?"

    - **(a) Continue now** → Print "RFC approved. Run `/pm:dev {slug}` to implement." Delete the rfc session file (`{pm_state_dir}/rfc-sessions/{slug}.md`). **Stop here.**
    - **(b) Stop and resume later** → Do these in order:
      1. Update `{pm_dir}/backlog/{slug}.md` frontmatter: set `status: planned`, `updated: {today}`.
      2. Update `{pm_state_dir}/rfc-sessions/{slug}.md`:
         - Set `Stage: approved`
         - Set `RFC path: {pm_dir}/backlog/rfcs/{slug}.html`
         - Update `Resume Instructions` → `Next action: RFC already approved. Run /pm:dev {slug} to implement.`
      3. Print:
         ```
         Session paused. RFC approved, ready to build.
         - RFC: {pm_dir}/backlog/rfcs/{slug}.html
         - Backlog: {pm_dir}/backlog/{slug}.md (status: planned)
         - Session: {pm_state_dir}/rfc-sessions/{slug}.md (stage: approved)
         - Resume: run /pm:dev {slug} to implement.
         ```
      **Stop here. Do not proceed to implementation.**
