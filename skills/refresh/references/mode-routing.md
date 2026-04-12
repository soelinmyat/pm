# Mode Routing Logic

## Routing Table

| Argument | Mode |
|---|---|
| _(no arg)_ | Full audit — scan everything, present report, user picks |
| `seo` | Scoped: SEO files only (all `*/seo.md` + landscape keyword sections) |
| `landscape` | Scoped: `{pm_dir}/insights/business/landscape.md` only |
| `topics` | Scoped: all `{pm_dir}/evidence/research/*.md` |
| `consolidate` | Consolidation only — skip Phases 1-2 (staleness audit + evidence patching), jump directly to Phase 2.5. Runs overlap merge, cross-domain tunnels, orphan lint, and contradiction detection. If hot index does not exist, falls back to reading insight files directly. |
| `{domain}` | Scoped: all refreshable files within a discovered insights domain |
| `{domain}/{slug}` | Scoped: one discovered insight file or competitor folder |
| `{slug}` | Backward-compatible shorthand for `competitors/{slug}` when that competitor exists |

All paths hit the cost guardrail before executing.

## Domain Discovery

Discover available insight domains by scanning `{pm_dir}/insights/*/index.md`.

Rules:
- Treat every matching directory name as a valid domain (`business`, `competitors`, `product`, `developer-experience`, etc.).
- Do not hardcode the domain list.
- For `{domain}` scope: refresh the domain index plus refreshable markdown files directly under that domain.
- For `{domain}/{slug}` scope:
  - if `{pm_dir}/insights/{domain}/{slug}.md` exists, target that single file
  - if `{pm_dir}/insights/{domain}/{slug}/` exists, target the files within that directory
- If the argument does not resolve, show the discovered domains and any valid competitor slugs.

## Scope

**In scope:**
- `{pm_dir}/insights/business/landscape.md`
- `{pm_dir}/evidence/competitors/{slug}/profile.md|features.md|api.md|seo.md|sentiment.md`
- discovered domain indexes at `{pm_dir}/insights/*/index.md`
- `{pm_dir}/evidence/research/{topic}.md` — **origin-aware** (see origin rules reference)

**Out of scope:**
- `{pm_dir}/strategy.md` — created via interactive interview. Use `$pm-strategy` to update.
