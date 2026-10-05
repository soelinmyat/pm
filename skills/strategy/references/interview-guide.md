# Strategy Interview Guide

Reference for pm:strategy. Ask questions one at a time. Start with Essentials.
Reuse answers already confirmed in source material. Cover the decisions below with the minimum forcing questions; terse answers do not justify inventing priorities, alternatives or success measures. Depth follows relevance and user interest rather than answer length.

If `{pm_dir}/insights/business/landscape.md` exists, substitute named competitors and segments into
questions marked [use landscape data].

---

## Essentials (always ask these)

Cover these decision areas using existing confirmed answers or concise questions. Do not ask a question whose answer is already available.

**1. What do you build?**
> "Describe the product in one or two sentences — what it does, not what it aspires to."

Weak answer: "A platform for operations teams."
Strong answer: "A mobile-first work order system for contract cleaning companies
  managing 20-200 sites."

---

**2. Who is it for?**
> "Who is the primary user? What's their job title, company type, and rough size?"

Probe if vague: "Is the buyer the same person as the daily user? If not, who are each?"

Weak answer: "SMBs."
Strong answer: "Ops managers at contract cleaning firms with 10-50 field workers.
  Buyer is the owner or ops director. Daily user is the site supervisor."

---

**3. What problem does it solve?**
> "What's the pain before they use your product? What breaks, slows down, or gets dropped?"

Probe if vague: "What do they use today instead? Spreadsheets, WhatsApp, a legacy tool?"

Weak answer: "Inefficiency."
Strong answer: "Supervisors track completed jobs in WhatsApp threads. Nothing is
  auditable. Clients dispute invoices and there's no proof of work."

---

**4. Why now?**
> "What makes this the right time to build this? Market shift, tech unlock, regulation, or
> something else?"

This question surfaces urgency and investor/customer narrative. Accept a brief answer.

Weak answer: "The market is growing."
Strong answer: "Facilities management software has historically been desktop-only
  and enterprise-priced. Mobile-first Android devices hit price parity with paper
  clipboards in 2023. Field teams can now carry the system."

---

**5. What are you NOT doing?**
> "Which adjacent outcomes are you choosing not to pursue, and why?"

This is the hardest question for most founders. Push for specificity.
Vague non-goals are noise. Sharp non-goals are strategy.

Weak answer: "We're not enterprise."
Strong answer:
- "No payroll integration — too deep, too slow, kills our deployment speed."
- "No iOS-first — our workers are Android, and iOS parity would double QA cost."
- "No built-in scheduling — we integrate with existing rostering tools rather than
  replace them. That's a different product."

---

## Minimum decision questions

After framing the audience/problem, check whether the supplied context supports these choices. Ask only the smallest unanswered forcing question; the purpose is a defensible choice, not a longer interview.

- **Priority and opportunity cost:** "Which outcome matters first this phase, and what are we postponing to pursue it?" Ground the ranking in observed pain, strategy constraints, or a clearly labeled assumption. A short answer can support one priority; do not manufacture three.
- **Selectable alternative:** "What credible alternative could we choose instead, including staying with the current approach, and why does this direction win?" Name its sacrifice and the condition that would make it preferable.
- **Success and reversal:** "What observable result would tell us this choice is working, and what would make us change course?" Use a baseline/target/time horizon where known; otherwise record the unknown and a concrete way to calibrate it. Do not invent impact numbers.

Example: "Prioritize supervisor proof-of-work capture before payroll integration because two current customers report invoice disputes. Compare adding timestamped evidence to their existing WhatsApp workflow with replacing the work-order system. Measure completed jobs with usable evidence and dispute-resolution time; broader demand and current baselines remain unverified. Reconsider if supervisors cannot capture evidence during their normal job."

---

## Depth Questions (follow user energy)

Use a Depth question when its answer could change the choice or the user wants further exploration. Do not ask all of them or infer strategic depth from answer length.

**Competitive positioning** [use landscape data if available]
> "How do you stack up against [Competitor A] and [Competitor B]?
> Where do you win, and where do you intentionally not compete?"

If no landscape data:
> "Who are your top 2-3 competitors? For each: why do customers choose you over them,
> and why do customers choose them over you?"

---

**Market sizing**
> "How big is the addressable market? Is this a niche-and-dominate play or a
> land-and-expand into a larger category?"

Accept qualitative framing if the user doesn't have numbers.

---

**Go-to-market motion**
> "Do you have a geographic focus or are you going global from day one?"

> "How will customers find you? Product-led (self-serve), sales-led, partnership-driven, or a combination?"

GTM is a strategic decision that shapes what you build first. For 0-to-1 products, probe geographic beachhead and acquisition motion. This question should be promoted to Essentials for early-stage products.

---

**Pricing philosophy**
> "What's the pricing model? Per seat, per location, usage-based, flat?"

> "Are you price-competing or premium-positioning? What justifies the price?"

---

**Success metrics**
> "How will you know this strategy is working 12 months from now?
> Which early behavior and eventual outcome should improve? Include retention or revenue when relevant, and distinguish those lagging outcomes from leading indicators."

Weak answer: "Revenue growth, somehow."
Strong answer: "Leading: supervisors capture usable proof on their first work order. Outcomes: fewer invoice disputes and higher 60-day retention. Baselines and targets are not yet known; establish them with the two pilot customers before claiming improvement."

---

**Risk factors**
> "What's the most likely way this strategy fails? What are you doing about it?"

This surfaces self-awareness and de-risking steps. Accept honest short answers.

---

## Using Landscape Data

When `{pm_dir}/insights/business/landscape.md` exists, before starting the interview:
1. Read the file.
2. Note: named competitors, market segments, pricing ranges, key buyer personas.
3. Substitute into questions. Examples:
   - Instead of "Who are your competitors?" ask "The landscape shows Swept, Janitorial
     Manager, and Aspire as the main players. How do you position against them?"
   - Instead of "What market are you in?" ask "The landscape segments this as
     field-service-management vs. cleaning-specific. Which are you targeting?"

This makes the interview faster and the answers more precise.

---

## Closing the Interview

After Essentials (and any Depth questions), say:

Summarize the actual choice, rejected alternative, priority, success signal and largest uncertainty. When these are already confirmed, write `{pm_dir}/strategy.md`; when a consequential choice remains unsupported, ask the one question that resolves it or retain it as an explicit provisional decision. Do not turn optional depth into required ceremony.
