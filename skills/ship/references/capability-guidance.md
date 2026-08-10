# Delivery capability guidance

## Goal

Explain the route PM selected, use every discovered safe capability automatically, and identify unavailable optimizations without changing the consumer repository or GitHub.

## Classification

Classify each discovered capability with its concrete effect:

- **Automatic** — authenticated policy and exact adapter coverage prove the capability safe. PM uses it without prompting or consumer changes.
- **Configurable** — the repository could enable the optimization through a bounded, machine-readable policy change. Explain the effect and show the smallest setup guidance, but do not apply it.
- **Unavailable** — the host, repository, or authenticated provider cannot support the capability. Explain the effect and continue through comprehensive delivery.

Installing or updating PM automatically discovers repository-native instructions, hooks, workflows, and authenticated GitHub capabilities read-only. It chooses the safest supported route with **zero consumer edits**. Candidate publication additionally requires an explicitly authorized machine-readable candidate-publication policy. CleanLog's current contract has no such policy, so PM provides repository-native planning and guidance while retaining the existing comprehensive Review → Push → PR → CI ordering.

## Authority boundary

Guidance must never mutate the repository or GitHub. A setup change requires separate explicit authority and a new action outside delivery execution. Do not create policy, edit hooks, alter branch protection, enable merge queues, or reinterpret prose as permission.

## Comprehensive kill switch

`PM_DELIVERY_COMPREHENSIVE=1` is the single behavior kill switch. When set, skip delivery optimizations and run the existing comprehensive route. It does not disable tests, Review, verification, CI, or merge authority checks. Do not introduce per-capability bypass variables.

## Done-when

The delivery report lists automatic, configurable, and unavailable capabilities with their effects, identifies the selected route and reason, offers guidance only where configuration could help, and performs no consumer or GitHub writes.
