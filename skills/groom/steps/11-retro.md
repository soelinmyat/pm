---
name: Retro
order: 11
description: Extract durable product/process learnings and archive the canonical session
phase: retro
applies_to: [quick, standard, full, agent]
required_evidence: [retro]
result_schema: groom-phase-result-v1
---

## Goal

Preserve reusable learnings and close the Groom audit without deleting evidence needed for resume or downstream verification.

## How

Extract only generalizable learnings from scope churn, evidence gaps, review remediations, approval revisions, citation failures, or capability downgrades. Follow `references/memory-cap.md` and knowledge-writeback rules when a consumer PM workspace exists. Keep product decisions in evidence/decision artifacts and process lessons in memory.

Record a strict retro result. The runner marks the session complete and archives it under the immutable run ID; do not delete canonical audit state manually.

## Done-when

Required learnings validate, the runner reports `status: complete`, the approved proposal remains independently verifiable, and the user receives the RFC command as the next action.

**Next action:** report the approved proposal paths and offer `pm:rfc {slug}`.
