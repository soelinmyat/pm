---
name: RFC Review
order: 6
description: Senior engineer review of RFC — architecture, test strategy, complexity (M/L/XL)
---

## RFC Review (M/L/XL)

Senior engineers challenge the RFC — architecture decisions, test strategy, and complexity. This is the last human-interactive gate. After this passes, agents implement.

### The 3 standard RFC reviewers

Dispatch these reviewer intents using `agent-runtime.md`. In Claude or Codex-with-delegation, run them in parallel. In Codex without delegation, run the same briefs inline.

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

When `task_count > 1`, also dispatch cross-cutting reviewers. Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/cross-cutting-review-prompts.md` for the prompts. Scale by task count:

| Tasks with code work | Cross-cutting reviewers | Standard reviewers |
|---|---|---|
| 1 | None | 3 (adversarial, test, staff) |
| 2 | 1 combined (architect + integration + scope) | 3 (adversarial, test, staff) |
| 3+ | 3 parallel (architect, integration, scope) | 3 (adversarial, test, staff) |

Cross-cutting reviewers return compact JSON verdicts. Merge their findings with the standard reviewer findings.

### Handling findings

1. Merge all reviewer outputs. Deduplicate.
2. Fix all **Blocking issues** in the RFC (orchestrator edits directly). Non-blocking items are advisory.
3. If blocking issues were fixed, re-dispatch reviewers on the updated RFC (max 2 iterations).
4. Commit RFC updates.
5. Update RFC frontmatter to `status: approved`.
6. Update the proposal status to `planned` in `{pm_dir}/backlog/{slug}.md`.
7. **Resolve open questions.** Collect all questions from reviewers and any open questions in the RFC's Risks section. For each:
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

    > "RFC approved. Continue implementation now, or stop and resume later?"

    - **(a) Continue now** → Update `.pm/dev-sessions/{slug}.md` with `RFC review: passed (commit <sha>)` and `Continuous execution: authorized`. Proceed to Implementation.
    - **(b) Stop and resume later** → Do these in order:
      1. Update `{pm_dir}/backlog/{slug}.md` frontmatter: set `status: planned`, `updated: {today}`.
      2. Delete the session file: `rm .pm/dev-sessions/{slug}.md`
         (No need to set `completed_at` first — the file is being deleted.
         The backlog status and RFC are the durable artifacts.)
      3. Print:
         ```
         Session complete. RFC approved, ready to build.
         - RFC: {pm_dir}/backlog/rfcs/{slug}.html
         - Backlog: {pm_dir}/backlog/{slug}.md (status: planned)
         - Resume: run /dev {slug} to start implementation.
         ```
      **Stop here. Do not proceed to Implementation.**
