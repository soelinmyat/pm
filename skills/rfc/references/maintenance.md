---
created: 2026-10-06
updated: 2026-10-06
---

# In-scope RFC maintenance

The initial RFC is explicitly approved or derives technical details under the verified original product approval/grant. Product intent and behavioral contracts remain fixed. Routine file ownership, implementation approach, test-command and test-hook corrections within that intent do not need another human approval. Preserve the original human decision; record the maintenance reason, actual changes and current technical verification.

## Boundary

Compare the proposed change with the approved proposal, RFC and source before calling it maintenance. All three existing technical lenses assess whether product behavior, scope and significant risk remain unchanged, citing the relevant constraints in `maintenance_scope: { preserved: true, rationale: "..." }`. A field called `approach` can still introduce a material product or security change. Block that change and obtain the user's decision; do not relabel it mechanical. Uncertainty about a material boundary is a decision, not automatic permission.

The machine contract permits appended `owns` paths and corrected `approach`, `verification_commands` and `test_hooks` on declared existing issues. It preserves issue identities/dependencies, ACs, design context and the other sidecar fields. Ownership may overlap for shared files, but running work must remain isolated. Review must reject weakened verification, unrelated owned paths, or changes to user-visible behavior, permissions, data retention, interfaces or significant migration/operational risk. The protected-field comparison and current technical review remain required.

Examples:

- Existing saved-report rename also updates its serializer; add that path and correct the focused test command, preserving the same permission checks and outcomes. Continue without asking again.
- Extract a helper or correct an API implementation example to satisfy the already approved contract; update the issue's current approach and verify the original outcomes. No new product decision is implied.
- Let another role rename reports, change 409 conflict handling, or introduce destructive retention behavior: obtain a product/risk decision and revise the approved design. These are material even if the patch is small.

## Current caller path

1. Before changing artifacts, finish or release affected running Dev units under their existing contracts. Then open a new run with `rfc-session amend --completed <latest archived session> --source-dir <source> --issues <n[,n]> --reason <why> --json`. New CLI amendments default to `kind: maintenance`; prior completed runs stay immutable. Historical `--kind owns-only` runs retain their exact-hash human re-approval contract for compatibility.
2. Edit only the permitted current sidecar fields. `amend` writes no artifact files. Run `rfc-session render-maintenance --session <session> --json` to mirror the changes in the issue cards, update the binding and reset lifecycle to draft. The renderer preserves the original RFC, labels corrected technical details as superseding their prior values, and refuses unrelated HTML edits. Commit the HTML/sidecar pair before review.
3. Review the changed details and their affected source/verification, retaining valid prior product decisions and unaffected evidence. Record the current artifact and the three existing lens verdicts with their scope assessment. Passing maintenance review advances directly to handoff as `maintained`; do not invoke `approve` or invent a new human approval.
4. Complete the normal lifecycle/audit handoff. The v3 audit records current reviewed bytes and the prior audit lineage, retaining the original human approver/time. It explicitly means reviewed maintenance, not human approval of the new bytes. Amendments grant no external-effect authority and leave the proposal lifecycle unchanged.
5. Adopt the completed lineage through `dev-session rebind-rfc`, including the expected current sidecar hash and reason. Ownership-only additions retain existing completion evidence. Changed technical contracts invalidate only the affected completed units: preserve their earlier result in the rebind history, reopen those units for relevant implementation/verification, and leave other units alone. If maintenance already completed while an affected unit was running, record its real non-passing worker result with `dev-session work-unit --status blocked` or `--status failed`. This bounded release verifies the completed amendment lineage, preserves the old bound contract and certifies no completion. Release every affected worker, then rebind and retry; completion and new execution still reject sidecar drift. Normal current-source delivery gates still apply.

Do not edit approval audits, alter historical archives, or bypass artifact ownership, platform access controls, freshness, review or testing requirements. A fresh product design or a material change still reaches the explicit human decision boundary. Remote-native ProductMemory execution retains its own bound contract and authorized transport; local maintenance lineage cannot substitute for its live identity checks or authorize KB writes.

Maintenance can also descend from a completed `delegated` initial RFC. Keep its original product decision/grant, independently assess preserved scope as before, and publish a v5 maintained audit with exact prior lineage. The HTML remains `reviewed`, not human-approved. Rebinding verifies the live canonical product grant as well as each immutable RFC hop. Routine technical corrections still need current review; a material or uncertain change returns for the concrete product/risk decision.
