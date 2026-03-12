# Strategy Interview Guide

Reference for pm:strategy. Ask questions one at a time. Start with Essentials.
Move to Depth based on user energy — expansive answers invite follow-ups,
terse answers mean move on.

If `pm/landscape.md` exists, substitute named competitors and segments into
questions marked [use landscape data].

---

## Essentials (always ask these)

These five questions are the minimum viable strategy interview. Cover all of them.

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
> "Name at least three things this product explicitly won't do, and briefly why."

This is the hardest question for most founders. Push for specificity.
Vague non-goals are noise. Sharp non-goals are strategy.

Weak answer: "We're not enterprise."
Strong answer:
- "No payroll integration — too deep, too slow, kills our deployment speed."
- "No iOS-first — our workers are Android, and iOS parity would double QA cost."
- "No built-in scheduling — we integrate with existing rostering tools rather than
  replace them. That's a different product."

---

## Depth Questions (follow user energy)

Ask these if the user's Essentials answers were detailed, or if they explicitly
want to go deeper. Do not ask all of them — pick the most relevant 2-3.

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
> "How do customers find you today? What's the primary acquisition channel?"

> "Is your GTM product-led (self-serve trial), sales-led, or partnership-driven?"

---

**Pricing philosophy**
> "What's the pricing model? Per seat, per location, usage-based, flat?"

> "Are you price-competing or premium-positioning? What justifies the price?"

---

**Success metrics**
> "How will you know this strategy is working 12 months from now?
> Pick 2-3 leading indicators, not just revenue."

Weak answer: "Revenue growth."
Strong answer: "Time-to-first-completed-work-order under 10 minutes. 60-day
  retention above 80%. Net Revenue Retention above 110%."

---

**Risk factors**
> "What's the most likely way this strategy fails? What are you doing about it?"

This surfaces self-awareness and de-risking steps. Accept honest short answers.

---

## Using Landscape Data

When `pm/landscape.md` exists, before starting the interview:
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

> "That's enough to write a solid strategy doc. Anything you want to add before I draft it?"

Then write `pm/strategy.md` without further questions.
