---
type: backlog-issue
id: "PM-077"
title: "Billing: Stripe integration"
outcome: "Team and Scale tiers enforced — projects with 2+ members require a paid subscription"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "billing"
  - "monetization"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

Projects with more than 1 member require a paid subscription. Stripe handles payment processing. The pricing story: small teams get deliberately low pricing ($10/mo for 5), larger teams pay $100/mo for 20.

## Acceptance Criteria

1. Three tiers enforced: Solo (free, 1 member), Team ($10/mo, up to 5), Scale ($100/mo, up to 20).
2. Stripe Checkout session created when user tries to add 2nd member without subscription.
3. Stripe webhook handles: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
4. Subscription state stored in Postgres `billing_subscriptions` table.
5. Seat count checked on `pm invite` / `pm join` — reject if at tier limit.
6. Graceful degradation: if subscription lapses, existing members retain read access but cannot push. New members blocked.
7. `pm billing` shows current plan, seat usage, next billing date.
8. No annual pricing at launch. Monthly only.

## Technical Feasibility

**Build-new:** Stripe product/price creation, Checkout integration, webhook handler, subscription state management, seat enforcement middleware.

**Risk:** Billing edge cases (failed payments, mid-cycle upgrades, refunds) are complex. Use Stripe's hosted Checkout and Customer Portal to minimize custom UI.

## Notes

- Depends on PM-075 (team sharing — need multi-user before billing makes sense).
- Build last — early adopters provide more signal than early revenue (EM review).
- Consider a generous trial period (30 days free for teams) to reduce friction.
