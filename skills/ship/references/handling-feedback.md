# Handling Review Feedback

Loaded when code review feedback is received — from human reviewers, Claude review, or external reviewers on a PR.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

---

## The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Forbidden Responses

**NEVER:**
- "You're absolutely right!" — performative
- "Great point!" / "Excellent feedback!" — performative
- "Let me implement that now" — before verification
- "Thanks for catching that!" — actions speak, just fix it

**INSTEAD:**
- Restate the technical requirement
- Ask clarifying questions if anything is unclear
- Push back with technical reasoning if wrong
- Just start working (actions > words)

## Handling Unclear Feedback

If ANY item is unclear, STOP — do not implement anything yet. Ask for clarification on unclear items first.

Items may be related. Partial understanding = wrong implementation.

```
Example:
  Reviewer says "Fix 1-6"
  You understand 1,2,3,6. Unclear on 4,5.

  WRONG: Implement 1,2,3,6 now, ask about 4,5 later
  RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Source-Specific Handling

### From human partner
- Trusted — implement after understanding
- Still ask if scope unclear
- No performative agreement
- Skip to action or technical acknowledgment

### From external reviewers (Claude review, Codex, human reviewers on PR)

Before implementing, check:
1. Technically correct for THIS codebase?
2. Breaks existing functionality?
3. Reason for current implementation?
4. Works on all platforms/versions?
5. Does reviewer understand full context?

If suggestion seems wrong: push back with technical reasoning.
If can't easily verify: say so and ask for direction.
If conflicts with prior architectural decisions: stop and discuss with user first.

## YAGNI Check

If reviewer suggests "implementing properly":
- Grep codebase for actual usage
- If unused: suggest removing (YAGNI)
- If used: implement properly

## Implementation Order

For multi-item feedback:
1. Clarify anything unclear FIRST
2. Then implement in this order:
   - Blocking issues (breaks, security)
   - Simple fixes (typos, imports)
   - Complex fixes (refactoring, logic)
3. Test each fix individually
4. Verify no regressions

## When To Push Back

Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Legacy/compatibility reasons exist
- Conflicts with architectural decisions documented in AGENTS.md or CLAUDE.md

How: technical reasoning, specific questions, reference working tests/code.

## Acknowledging Correct Feedback

```
GOOD: "Fixed. [Brief description of what changed]"
GOOD: "Good catch - [specific issue]. Fixed in [location]."
GOOD: [Just fix it and show in the code]

BAD: "You're absolutely right!"
BAD: "Thanks for catching that!"
BAD: ANY gratitude expression — actions speak
```

## GitHub Thread Replies

When replying to inline review comments on GitHub, reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.
