# Linear Operations — Shared Resilience Patterns

Shared contract for all Linear API interactions. Skills that call Linear MCP tools reference this file for retry, verification, and rollback behavior.

---

## User Confirmation Gate

<HARD-RULE>
ALWAYS ask the user before creating or closing Linear issues. Display what you intend to do and wait for confirmation. Never silently create, update, or close issues.
</HARD-RULE>

---

## Retry Pattern

All Linear API calls must use this retry pattern. The LLM does not have try/catch, so retry is instruction-driven.

**For any Linear MCP call:**

1. Make the call.
2. If the call returns an error (timeout, 429 rate limit, 500/502/503, authentication failure):
   - Log: `Linear API error: {error}. Retrying (attempt {N}/3).`
   - Wait briefly (no sleep — just proceed to retry).
   - Retry up to **3 total attempts**.
3. If all 3 attempts fail:
   - Log: `Linear API failed after 3 attempts: {error}. Continuing without Linear update.`
   - **Do NOT block the workflow.** Local backlog is the source of truth; Linear is supplementary.
   - Record the failure in the session state file under `## Linear Sync`:
     ```
     - Linear sync failed: {operation} on {issue_id} — {error}
     ```
   - The user can retry manually or via `/pm:sync` later.

**Authentication failures** (401, 403): Do not retry. Report immediately:
> "Linear authentication failed. Check your API key or MCP server configuration."

---

## Verification Pattern

After any state-changing Linear call (`save_issue`, `save_comment`), verify the result:

```
# After save_issue to change state:
get_issue({ id: "{ISSUE_ID}" })
# Confirm the returned state matches what you set.
# If it doesn't match after the call succeeded, retry once.
```

Verification is mandatory for:
- Issue state transitions (In Progress, Done)
- Parent issue closure (must verify all children are Done first)

Verification is optional for:
- Comments (fire-and-forget is acceptable)
- Description enrichment (idempotent — can re-run later)

---

## Multi-Issue Creation (RFC → Linear)

When creating a parent issue + N child issues (e.g., RFC approval):

### Sequence

1. **Create parent issue.** Verify it was created (check returned ID).
2. **Create children sequentially.** For each child:
   - Call `save_issue({ ..., parentId: "{parent_id}" })`
   - Record the returned child ID immediately in the session state
3. **If a child creation fails:**
   - Log which children were created successfully (by ID)
   - Log which child failed and why
   - **Do NOT delete the parent or successfully-created children** — partial state is better than no state
   - Report to user: "Created parent {ID} and {N} of {TOTAL} child issues. Child {M} failed: {error}. You can create the remaining issues manually in Linear."
4. **After all children created:** Update session state with all Linear IDs.

### Idempotency on Resume

If the session is resumed and some children already exist:
- List children: `list_issues({ parentId: "{parent_id}" })`
- Compare against RFC issue list
- Only create missing children
- Never duplicate — check titles or sequence numbers before creating

---

## Multi-Issue Closure (Ship → Done)

When closing a parent issue + N child issues (e.g., after merge):

### Sequence

1. **Close all children first.**
   - `list_issues({ parentId: "{ISSUE_ID}" })` to get current children
   - For each child: `save_issue({ id: "{CHILD_ID}", state: "Done" })`
   - Use the retry pattern above for each call
2. **Verify all children are Done.**
   - `list_issues({ parentId: "{ISSUE_ID}" })` again
   - Check each child's state
   - If any child is still open after retries:
     > "Child {CHILD_ID} is still {state} — not closing parent. Close it manually, or should I try again?"
     Wait for user input.
3. **Close parent** (only after all children confirmed Done):
   - `save_issue({ id: "{ISSUE_ID}", state: "Done" })`
   - Verify: `get_issue({ id: "{ISSUE_ID}" })` — confirm state is Done
4. **If parent closure fails:** Retry per pattern. If still fails after 3 attempts, report:
   > "All children are Done but parent {ISSUE_ID} failed to close: {error}. Close it manually in Linear."

### Never

- Never close a parent without verifying children are Done
- Never silently skip closure — always log the outcome
- Never delete issues to "clean up" — partial state is recoverable; deleted state is not

---

## Status Update Timeline

| Event | Linear Operation | Mandatory |
|-------|-----------------|-----------|
| Intake (task starts) | Set issue to "In Progress" | Yes (if Linear configured) |
| RFC written (M/L/XL) | Comment: "RFC written: {summary}" | No (nice-to-have) |
| PR opened | Comment: "PR opened: #{number}" | No (nice-to-have) |
| PR merged | Close children, then parent (see above) | Yes |
| Retro complete (M/L/XL) | Comment: learnings summary | No (nice-to-have) |

Comments are fire-and-forget (no verification needed). State transitions must be verified.

---

## Rate Limiting

Linear's API has rate limits. When making multiple calls in sequence (e.g., closing N children):
- Proceed sequentially, not in parallel
- If you receive a 429 (Too Many Requests), wait and retry per the retry pattern
- For large batches (10+ issues), log progress: "Closing child {N}/{TOTAL}..."
