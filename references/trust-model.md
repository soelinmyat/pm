# Trust Model

PM's local checks judge whether the work is complete, current and good enough. They do not prove that the workflow's own state is authentic.

## Trusted

**Trusted.** The local user, the orchestrating agent running the PM workflow, the installed plugin and its scripts, and the session state they write under `.pm/`: `session.json`, gates, reports, the delivery contract and the release transaction.

- Local checks never try to prove that this state was not forged. A local check cannot stop the agent that runs it.
- Repository-declared commands (tests, seed, teardown, build scripts) run with the same trust as the project's own test suite. Running them is not a new boundary.

## What local checks are for

Checks catch omission (a required step skipped), stale evidence (for another commit or state), honest mistakes and drift, self-approval (builder and reviewer must be separate agents) and a low quality bar. They fail closed on each of these.

## Untrusted

**Untrusted.** Content from outside the workflow: third-party input, data and text the product processes, external systems, imported artifacts, model output used as data, and dependency or supply-chain changes. Validate it at the boundary where it is used.

## Unattended merge

The guard against a misbehaving agent is remote: GitHub branch protection with enforced required status checks, applied to administrators too, and `gh pr merge --match-head-commit`. `merge-check` reads GitHub's PR and CI state to catch stale or wrong state, not to defend against forgery.

## For reviewers

A finding whose only path is the trusted local agent forging or editing workflow state or evidence is out of scope. Do not raise it. Omission, staleness, mistakes, self-approval and untrusted external input stay in scope.
