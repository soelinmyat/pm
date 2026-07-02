---
type: plan
title: PM Live Codex Evals
created: 2026-07-02
updated: 2026-07-02
status: proposed
groom_tier: quick
proposal: proposal-3
related:
  - docs/plans/2026-07-01-pm-behavioral-evals.md
  - docs/plans/2026-07-01-pm-behavioral-evals-rfc.md
  - docs/plans/2026-07-02-pm-eval-current-score.md
---

# PM Live Codex Evals

PM should add an explicit local live-Codex adapter path for the behavioral eval
suite. Proposal 1 built the harness. Proposal 2 added current scoring. Proposal
3 lets maintainers run the sentinel suite against real `codex exec` when they
choose to provide an explicitly opted-in local runtime.

## TL;DR

- **For** - PM plugin maintainers validating workflow behavior with real Codex.
- **What** - Add an opt-in Codex adapter mode that stages PM into an isolated
  Codex home, invokes `codex exec`, captures runner-owned transcript output, and
  returns pass/fail/indeterminate rows through the existing score command.
- **Why now** - `v1.6.9` can score current results, but Codex still reports
  `skip: network-policy`. We need an explicit local opt-in path to produce real
  rows.

## Decision Brief

Approve a narrow, opt-in live adapter. Do not run live Codex by default. Do not
claim RFC-grade container containment or network allowlisting. The adapter may
run only when a maintainer explicitly enables live mode and supplies an isolated
Codex home template. Otherwise it must keep returning `skip: network-policy`.

This gives PM real behavioral measurement for trusted local maintainers without
weakening CI safety or pretending that the stricter container/proxy work is done.

## Execution Contract

| Field | Contract |
|---|---|
| **Scope** | Extend `scripts/evals/adapters/codex.js`; add Codex prompt construction; stage `runtime/pm` into isolated `CODEX_HOME` cache layout; invoke `codex exec` with bounded timeout; capture stdout/stderr and last message under runner-owned metadata; normalize JSONL events into `metadata/transcript.normalized.jsonl`; document opt-in env vars; add tests with a fake `codex` binary. |
| **Non-goals** | No public-CI live runs; no automatic use of the user's real Codex home; no mutation of installed plugin caches; no committed raw transcripts; no hosted dashboard; no LLM grader; no Docker/Podman egress proxy implementation in this proposal. |
| **Acceptance criteria** | 1. Default `npm run eval:score -- --agent codex --write /tmp/pm-codex.json` still records five `skip: network-policy` rows. 2. Live mode requires `PM_EVAL_CODEX_LIVE=1` and `PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1`; without both, the adapter skips before scenario shell starts. 3. Live mode never reads or writes the user's installed plugin cache. It stages PM under run-owned Codex and `.agents` homes. 4. Live mode can use `PM_EVAL_CODEX_HOME_TEMPLATE` only as a read-only source for allowlisted auth material; user config, plugin caches, skills, vendor links, custom rules, MCP/tool config, path-affecting settings, and PM roots from the template are rejected or stripped before launch. 5. `codex exec` runs with `--ignore-user-config` and `--ignore-rules` so copied template config cannot alter sandbox, shell env, plugin roots, tools, profiles, or model behavior. 6. The runner injects a unique marker into the staged PM runtime, verifies the marker is absent from source/template inputs, and requires fake/live Codex to produce marker-derived evidence. Missing evidence is `indeterminate: wrong-source`. 7. Unknown or missing Codex binary skips or errors before writing misleading pass/fail rows. 8. A fake-Codex test proves command construction, isolated env, transcript capture, wrong-source marker proof, and post-check execution. 9. `npm run eval:check`, `npm test`, `npm run validate:plugin`, and `node scripts/generate-platform-files.js --check` pass. |
| **Edge cases** | Missing opt-in is `skip: network-policy`; missing Codex binary is `skip: codex-cli-missing`; missing home template in live mode is `skip: codex-auth-missing`; non-zero Codex exit is `indeterminate: codex-exec-failed`; timeout is `indeterminate: codex-timeout`; empty or malformed transcript is `indeterminate`, not `pass`; raw output remains under `eval-results/`. |
| **Success metric** | A maintainer with an isolated authenticated Codex home can run one command and get real local sentinel rows, while a normal developer or CI still gets default skips. |

## Problem

The current score command is honest but not yet useful for live Codex behavior:

```bash
npm run eval:score -- --agent codex --write /tmp/pm-codex-current.json
```

Today that produces five `skip: network-policy` rows. That is safer than a fake
score, but it means PM cannot yet answer:

> "Did the latest PM workflow change improve real Codex behavior?"

The existing RFC set a high bar for live runs: container sandboxing and endpoint
allowlist proof. The current code does not implement that full containment
layer. Blocking on the full layer leaves maintainers blind. Skipping the safety
boundary would produce false confidence.

Proposal 3 takes the middle path: trusted local live runs only, behind explicit
operator opt-in, with isolated runtime staging and clear labels. It is not the
full RFC containment layer.

## Users

**Primary user:** PM plugin maintainer.

Job: run the sentinel suite against real Codex from a local maintainer machine,
using a known isolated Codex auth/template directory, then inspect current-score
output with the local-risk boundary visible.

## Scope

### 1. Explicit Live Gate

Keep Codex skipped by default.

Live execution requires both:

```bash
PM_EVAL_CODEX_LIVE=1
PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1
```

Why two variables:

- `PM_EVAL_CODEX_LIVE=1` says the maintainer intends to call Codex.
- `PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1` acknowledges this proposal does
  not yet implement the RFC's container egress proxy.

If either is absent, return `skip: network-policy`.

### 2. Isolated Codex And Agents Homes

Live mode must not use the user's installed plugin cache.

The adapter creates run-owned homes under `eval-results/runs/<id>/home` and
stages PM into both discovery layouts Codex may use:

```text
home/.codex/plugins/cache/pm/pm/<manifest-version>/
home/.agents/vendor/pm/
home/.agents/skills/pm-<skill> -> ../vendor/pm/skills/<skill>
```

If `PM_EVAL_CODEX_HOME_TEMPLATE` is set, copy allowlisted auth material into the
run-owned Codex home before staging PM. This template is a maintainer-managed,
already-authenticated Codex home. The adapter must not mutate the template.

Template import is allowlist-only:

- Copy only auth/session material needed by the CLI.
- Do not copy `config.toml`, profiles, MCP/tool config, plugin caches, `skills/`,
  `vendor/`, `.agents/`, custom rule files, symlinks, sockets, devices, or
  nested PM roots.
- Purge any PM cache path before staging the current runtime.
- Set `HOME`, `CODEX_HOME`, `XDG_*`, `PM_PLUGIN_ROOT`, and
  `CLAUDE_PLUGIN_ROOT` to run-owned paths.
- Realpath-check every PM root exposed to Codex; each must live under the run
  directory.

If live mode has no template, return `skip: codex-auth-missing`.

### 3. Wrong-Source Marker Proof

Staging is not enough. The runner must prove Codex used the staged PM runtime.

For each live run:

1. Generate a unique marker such as `pm-eval-source:<run-id>:<nonce>`.
2. Verify the marker is absent from the source checkout and Codex home template.
3. Inject the marker only into the staged PM runtime after copying.
4. Ask Codex to read the PM skill/runtime text it uses and write the marker to a
   known artifact, without revealing the marker in the prompt.
5. Verify the marker-derived artifact from the run output.

If marker evidence is missing, malformed, or appears in the wrong input before
launch, the verdict is `indeterminate: wrong-source`.

### 4. Codex Exec Invocation

Use the local CLI shape verified by `codex exec --help`:

```bash
codex exec \
  --full-auto \
  --ephemeral \
  --ignore-user-config \
  --ignore-rules \
  --skip-git-repo-check \
  --json \
  -C "$WORKDIR" \
  -o "$METADATA/last-message.txt" \
  -
```

The prompt includes:

- Scenario role, user message, stop condition, and acceptance criteria.
- Staged plugin note: PM is available through the isolated Codex home.
- Marker instruction: read the marker from the PM runtime text; the prompt does
  not reveal the marker value.
- Required artifact names when scenario checks expect artifacts.
- A warning not to read host paths, raw credentials, or `eval-results/`.

### 5. Runner-Owned Transcript Capture

The runner captures:

- Raw Codex JSONL stdout to `metadata/transcript.raw.jsonl`
- Normalized transcript JSONL to `metadata/transcript.normalized.jsonl`
- Codex stderr to `metadata/codex.stderr.log`
- Last message to `metadata/codex.last-message.txt`

Post-check helpers continue to read only the runner-owned normalized transcript.
Sandbox-writable artifacts remain untrusted.

### 6. Documentation

Update `evals/README.md` with:

- Default skip behavior.
- Live env vars.
- Isolated `PM_EVAL_CODEX_HOME_TEMPLATE` setup.
- Raw output warning.
- A clear note that Proposal 3 is local opt-in, not public-CI or full container
  network allowlisting.

## Non-Goals

- Do not run live Codex in CI.
- Do not auto-copy `~/.codex`.
- Do not mutate the installed Codex plugin cache.
- Do not claim endpoint allowlist proof.
- Do not commit live result ledgers unless intentionally sanitized and reviewed.
- Do not change PM workflow behavior in this proposal.

## Risks

| Risk | Mitigation |
|---|---|
| Maintainer mistakes local opt-in for RFC-grade containment | Require `PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1` and document the boundary. |
| Adapter uses installed plugin cache and measures the wrong PM version | Stage PM into run-owned Codex and `.agents` homes, purge PM caches from templates, realpath-check PM roots, and require marker proof. |
| Credentials leak into committed files | Keep all raw output under gitignored `eval-results/`; never commit the copied Codex home. |
| Fake transcript passes checks | Use runner-owned Codex JSONL stdout, not sandbox-created transcript artifacts. |
| Local Codex auth is missing or stale | Return `skip: codex-auth-missing` or `indeterminate: codex-exec-failed`, never `fail`. |

## Success Metrics

| Metric | Before | After |
|---|---|---|
| Default Codex safety | `skip: network-policy` | unchanged |
| Live Codex path | none | explicit local opt-in |
| Wrong-source guard | not applicable | marker-based staged PM proof |
| Testability | hard skip only | fake-Codex adapter tests cover launch and transcript capture |
| Current score | not comparable by default | real rows possible on trusted local machine |

## Next Step

Implement the opt-in adapter path. Then run:

```bash
npm run eval:score -- --agent codex --write /tmp/pm-codex-default.json
PM_EVAL_CODEX_LIVE=1 \
PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1 \
PM_EVAL_CODEX_HOME_TEMPLATE=/path/to/isolated-codex-home \
npm run eval:score -- --agent codex --write /tmp/pm-codex-live.json
```

If the live machine is not configured, the second command may still skip or
become indeterminate. That is acceptable. The new guarantee is that PM has an
explicit local path for real measurement when the maintainer environment is
ready.
