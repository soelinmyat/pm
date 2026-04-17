# Review (moved)

The review gate is now the top-level `pm:review` skill.

**Canonical source:** `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`

Ship, dev, and all other callers invoke `pm:review` directly. The full workflow (phases 0–5, agent briefs, tiered findings, auto-fix, commit) lives in the skill file — do not duplicate it here.
