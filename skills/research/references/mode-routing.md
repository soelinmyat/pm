# Mode Routing Logic

## Routing Table

| Argument | Mode |
|---|---|
| `landscape` | Landscape Mode |
| `competitors` | Competitor Mode |
| _(no arg, no `{pm_dir}/insights/business/landscape.md`)_ | Landscape Mode (first-time default) |
| _(no arg, `{pm_dir}/insights/business/landscape.md` exists)_ | Present menu |
| anything else | Topic Mode (argument is the topic name) |

## Menu (no argument, landscape exists)

When no argument is given and `{pm_dir}/insights/business/landscape.md` exists, present:

> "What would you like to research?
> (a) Update landscape overview
> (b) Profile competitors
> (c) Research a specific topic"

Wait for user selection before proceeding.
