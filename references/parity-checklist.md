# Runtime Parity Checklist

Use this checklist when reviewing PRs that modify skills. Each item verifies that the skill works correctly on both Claude and Codex runtimes.

## Frontmatter

- [ ] SKILL.md has a `runtime:` block in YAML frontmatter
- [ ] `runtime.requires` is an array of strings from the allowlist (`delegation`)
- [ ] `runtime.agents` is a non-negative integer matching typical dispatch count
- [ ] `runtime.guarantee` is a non-empty string describing the output contract
- [ ] `runtime.degradation` is `"inline"` or `"none"`

## Dispatch

- [ ] No `Agent tool:` syntax anywhere in SKILL.md body
- [ ] No `Agent({...})` syntax in SKILL.md body or prompt template files
- [ ] Agent dispatch references `agent-runtime.md` for execution mechanics
- [ ] Dispatch intent uses `pm:*` labels from agent-runtime.md

## Output

- [ ] Inline path (no delegation) produces structurally equivalent output to delegation path
- [ ] Delegation is additive — improves speed or independence, does not change output structure
- [ ] Variable agent counts are documented in the `guarantee` string

## Prevention

- [ ] Build passes: `node scripts/generate-platform-files.js --check`
- [ ] No forbidden syntax in skills/ directory (enforced by build-time guard)
- [ ] New skills follow the Codex-first authoring rule from `agent-runtime.md`
