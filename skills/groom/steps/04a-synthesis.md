---
name: Synthesis (agent)
order: 4.1
description: Dispatch @synthesizer (thin orchestrator fanning out to 3 sub-personas), Iron Law gate, scope-lock checkpoint. Replaces 02+03+04 for agent tier.
applies_to: [agent]
---

### Step 04a: Synthesis (agent tier)

This step replaces three co-pilot steps for the agent path: `02-strategy-check.md`, `03-research.md`, and `04-scope.md`. The synthesizer reads strategy, memory, evidence, and codebase context itself and emits a unified YAML synthesis.

**What this step owns:**
- Dispatch `@synthesizer` agent (which fans out to 3 sub-personas in parallel)
- Validate Iron Law gate (research cited + every cited path passes `fs.exists`)
- Mechanical Q2 ambiguity gate (re-dispatch `@persona-jtbd-deriver` if both signals fire)
- Persist synthesis output to session state
- Present scope-lock checkpoint to user
- Handle redirect back to synthesis (capped at 3 redirects per checkpoint)

**Reading list (orchestrator side):**
- `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/synthesizer-agent.md` — orchestrator + 3 sub-persona contracts
- `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` — agent dispatch infrastructure

---

#### Phase A: Dispatch @synthesizer

Read these from session state (set by `01a-intake-agent.md`):

- `topic`
- `slug`
- `kb_freshness`
- `codebase_available`, `codebase_context`
- `brief_answers.q1` (if set)

Dispatch the `@synthesizer` agent with the input contract from `synthesizer-agent.md`:

```yaml
topic: "{topic}"
slug: "{slug}"
runtime: claude
pm_dir: "{pm_dir}"
source_dir: "{source_dir}"
codebase_available: bool
codebase_context: "{...}"
brief_answers: {q1: "...", q2: null}
kb_paths:
  strategy: "{pm_dir}/strategy.md"
  memory: "{pm_dir}/memory.md"
  hot_insights: "{pm_dir}/insights/.hot.md"
  competitors_index: "{pm_dir}/evidence/competitors/index.md"
  research_index: "{pm_dir}/evidence/research/index.md"
```

The synthesizer fans out to 3 sub-personas in parallel:
- `@persona-jtbd-deriver` — reads strategy + memory + evidence; returns `jtbd`, `personas`, `use_cases`
- `@scope-deriver` — reads research + codebase context; returns `in_scope`, `out_of_scope`, `ten_x_filter_result`
- `@risk-identifier` — reads memory + scope output; returns `risks`

The orchestrator aggregates the 3 sub-outputs, runs Iron Law check, runs ambiguity score, returns unified YAML per `synthesizer-agent.md` §"Output contract".

---

#### Phase B: Iron Law gate (orchestrator-side validation)

The synthesizer self-reports `iron_law_check.research_cited`. **Trust but verify.** The orchestrator re-validates:

1. Read `iron_law_check.research_files` from synthesizer output.
2. For each path: run `fs.exists`. Collect any failures into `iron_law_check.missing_paths`.
3. If `iron_law_check.research_cited == false` OR `missing_paths` is non-empty: **halt**.

Halt directive:

> "Synthesis halted: Iron Law violation. {N} of {M} cited research files do not exist on disk: {missing_paths}. Run `/pm:research {topic}` to add the missing references, then resume."

Set `iron_law_check.fs_exists_checked: true` in state regardless of pass/fail (records that the orchestrator did its job).

---

#### Phase C: Q2 ambiguity gate

If the synthesizer's `ambiguity_score` block satisfies BOTH:

- `candidate_jtbds >= 2`
- `no_clear_primary == true`

…then ask Q2 of the user (per `01a-intake-agent.md` Phase D):

> "Synthesis surfaced {N} plausible JTBDs:
>
> 1. {candidate 1 — one sentence}
> 2. {candidate 2 — one sentence}
> {...}
>
> Which one fits this initiative best? (Or describe a different framing.)"

Increment `questions_asked` in state. Capture the answer to `brief_answers.q2`.

**Re-dispatch is scoped:** pass the user's Q2 answer to `@persona-jtbd-deriver` only. Do NOT re-dispatch `@scope-deriver` or `@risk-identifier` — their outputs are reused. The persona-jtbd sub-persona returns an updated `jtbd` block with the disambiguation reflected.

If either signal is false: skip Q2.

---

#### Phase D: Persist synthesis to state

Write the synthesizer's unified YAML output to the session state file under a `synthesis:` block:

```yaml
synthesis:
  jtbd: {...}
  personas: {...}
  use_cases: [...]
  in_scope: [...]
  out_of_scope: [...]
  ten_x_filter_result: "..."
  risks: [...]
  iron_law_check: {...}
  ambiguity_score: {...}
  synthesis_notes: "{required, non-null}"
```

Mirror citations into the top-level `source_citations:` block (already in state schema) for proposal rendering.

Advance `phase: scope-lock`.

---

#### Phase E: Checkpoint 1 — Scope-lock

Present the synthesis to the user. Format compact, scannable, with citations inline:

```
═══════ Scope-lock checkpoint ═══════

JTBD: {jtbd.primary}
       [source: {jtbd.source.file}#L{line}]

Personas:
  Primary:   {personas.primary.name} — {personas.primary.description}
             [source: {primary.source.file}]
  Secondary: {personas.secondary[0].name}
             [source: ...]

Use cases ({N}):
  1. {use_cases[0].text}
     [source: ...]
  …

Scope:
  IN ({M}):  {in_scope items}
  OUT ({P}): {out_of_scope items}
  10x:       {ten_x_filter_result}

Risks ({Q}): {risks summary}

Synthesis notes: {synthesis_notes}

═══════════════════════════════════════
Approve, redirect (re-synthesize), or abort?
```

Wait for user response. Three valid outcomes:

| Outcome | Action |
|---|---|
| **Approve** | Append to `checkpoints[]` with `outcome: approve`. Advance to `05a-scope-review-agent.md`. |
| **Redirect** | Increment `redirects.scope_lock`. If `redirects.scope_lock <= 3`: re-dispatch synthesis (Phase A); the user's redirect comment becomes additional `brief_answers` context. If `redirects.scope_lock > 3`: escalate. |
| **Abort** | Append to `checkpoints[]` with `outcome: abort`. Stop session. State file preserved for resume. |

**Redirect cap escalation directive:**

> "Scope has been redirected 3 times. The synthesizer cannot converge on what you want. Options:
> (a) Switch to `--tier standard` for guided question-by-question scoping.
> (b) Refine the topic and start fresh with `/pm:groom {new-topic} --tier agent`.
> (c) Tell me explicitly what to fix — I'll override the synthesizer with your text."

---

#### Done-when

- `@synthesizer` dispatched and returned valid unified YAML
- Iron Law gate passed (research cited + all cited paths exist on disk)
- Q2 asked if both ambiguity signals fired (else skipped)
- `synthesis:` block + `source_citations:` block written to state
- Scope-lock checkpoint approved by user
- `phase: scope-review`

---

#### Red flags — self-check

- **"The synthesizer's `iron_law_check.research_cited: true` is enough — skip fs.exists."** No. Self-report is not verification. Run the filesystem check every time.
- **"Q2 ambiguity is borderline; I'll just pick one and move on."** No. The decision rule is mechanical. If both signals fire, ask. If either is false, skip.
- **"User redirected once with a one-line comment; let me re-synthesize from scratch."** No. The user's redirect comment is incremental context — fold it into the next dispatch's `brief_answers`, don't discard prior synthesis.
- **"Synthesis output is good enough; skip checkpoint."** No. Scope-lock is the user's only chance to redirect before drafting. Always present it.
