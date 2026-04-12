# API Analysis Methodology

A competitor's API is the most honest representation of their product architecture. It shows what they actually model, what they consider first-class, and how mature their integration story is. This guide covers how to find it, what to extract, and how to interpret findings.

---

## Finding the API Documentation

Check these locations in order:

1. **Footer links.** Most products link to developer docs in the footer under "Developers," "API," or "Integrations."
2. **Common paths:** `{domain}/docs`, `{domain}/api`, `{domain}/developers`, `{domain}/developer`
3. **Developer subdomains:** `developer.{domain}`, `developers.{domain}`, `api.{domain}`
4. **Help center search:** Search "API" or "integration" in their help center. Often surfaces undocumented or less-promoted API access.
5. **GitHub:** Search `"{Company Name}" API` or look for an official org at `github.com/{company}`. Public SDKs and client libraries often link back to full API docs.
6. **Status page:** `status.{domain}` sometimes reveals infrastructure details (microservices, API gateway providers).
7. **Postman / Swagger Hub:** Search the company name. Public API collections are sometimes published there even when docs are sparse.

If no public API documentation exists, note "No public API" and document any evidence of partner-only or private API access.

---

## What to Extract

### Auth Model

The auth model reveals how seriously they treat integrations and what trust model they operate under.

| Auth Type | What It Signals |
|---|---|
| API key only | Simple integration story; common in early-stage or SMB tools |
| OAuth 2.0 | Mature integration story; supports user-delegated access |
| JWT | Often internal-facing or newer architecture |
| Session cookie | Not built for integration; web-scraping territory |
| Multiple supported | Mature platform; wide integration use cases |

Note: scope granularity matters. "Read-only API key" and "full-access API key" are meaningfully different security postures.

### Core Entity Model

List the primary objects the API exposes. These are not endpoints — they are the nouns of the product's data model.

For each entity, note:
- Name and what it represents in the product domain
- Key fields (especially IDs, foreign keys, timestamps)
- Whether it is a first-class resource (full CRUD) or a sub-resource (only accessible through a parent)

Example for a workforce management tool:
- `Organization` — top-level tenant
- `Location` / `Site` — physical place
- `Shift` — scheduled work block
- `Employee` / `Worker` — person entity
- `Timesheet` — time tracking record
- `Report` — generated output

What is absent is as revealing as what is present. If there is no `Shift` object in a scheduling tool's API, shifts are not first-class.

### Endpoint Coverage

For each entity, note which operations are available:

| Entity | List | Get | Create | Update | Delete | Bulk |
|---|---|---|---|---|---|---|
| ...    | Y    | Y   | Y      | N      | N      | N    |

Partial CRUD (read-only API, no write access) signals the API is an afterthought — a data export tool rather than an integration surface.

Bulk operations signal operational maturity. Products used at scale need bulk endpoints; their absence is a known pain point in large accounts.

### Webhooks

Webhooks reveal what the product considers "events" and how they think about real-time integration.

Extract:
- Supported event types (list all named events)
- Payload structure (what data is included vs. requiring a follow-up GET)
- Delivery mechanism: HTTP POST to registered URL vs. message queue (SQS, Pub/Sub)
- Retry behavior: Does it retry on failure? How many times? Exponential backoff?
- Security: HMAC signature verification, shared secret, or nothing?

Absence of webhooks means integrations are polling-only — a meaningful architectural constraint for real-time use cases.

### Rate Limits

Note:
- Requests per second / per minute / per hour / per day
- Whether limits are per API key, per organization, or per endpoint
- Header names that communicate current limit state (`X-RateLimit-Remaining`, etc.)
- Upgrade path if limits are tiered by plan

High rate limits signal infrastructure investment. Very low limits (e.g., 100 req/day) signal the API is not meant for serious integrations.

### SDK Availability

| Language | Official SDK | Community SDK | Notes |
|---|---|---|---|
| JavaScript / TypeScript | Y/N | Y/N | |
| Python | Y/N | Y/N | |
| Ruby | Y/N | Y/N | |
| PHP | Y/N | Y/N | |
| Go | Y/N | Y/N | |

Official SDKs signal committed investment in the integration ecosystem. Community SDKs (no official SDK) signal demand without supply — a potential pain point for integration partners.

### Native Integrations and Marketplace

- List named integrations (Zapier, Slack, Salesforce, etc.)
- Note if there is an app marketplace or integration directory
- Check if they are listed in Zapier / Make / Workato — this reveals integration popularity signals

---

## What the API Surface Reveals

### Product Architecture Maturity

| Signal | Interpretation |
|---|---|
| Full CRUD on all major entities | Platform-ready; built for integration from early on |
| Read-only API | Integration was an afterthought; data exits but does not enter |
| No public API | Integration story is entirely native; ecosystem play is absent |
| Rich webhook event catalog | Event-driven architecture; real-time integration possible |
| No webhooks | Polling-dependent integrations; real-time use cases are blocked |
| GraphQL endpoint | Flexible query model; often signals modern architecture rewrite |
| REST + versioned URLs | Stable; committed to backward compatibility |
| Unversioned API | Brittle; integrations break without warning on product changes |

### Data Model Decisions

The entities exposed reveal product philosophy. Compare their entity model to yours:

- Do they model the same nouns you do?
- Do they segment entities the same way (e.g., "Site" vs. "Location" vs. "Property")?
- What is the top-level tenant object? (Organization, Account, Company, Workspace — each reflects a different go-to-market assumption)
- Are time-related concepts first-class objects, or attributes on other objects?

### Integration Ecosystem Signal

A mature integration ecosystem (Zapier, native CRM/HRIS connectors, public marketplace) signals:
- They have PMF with customers who have complex tech stacks
- They are harder to displace (switching costs from integrations)
- Their API has been battle-tested at scale

An absent ecosystem signals:
- Early stage or narrow ICP (customers who do not need integrations)
- Integration as a growth unlock — an area where a competitor could be built around

---

## Structuring Findings in api.md

```markdown
---
type: competitor-api
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
api_available: true/false
sources:
  - url: {docs URL}
    accessed: YYYY-MM-DD
---

# {Company Name} — API

## API Availability
Public / Partner-only / Undocumented / None
{If none: brief note on any evidence of internal or partner API usage.}

## Auth Model
{Auth type(s) supported. Scope granularity. Security posture notes.}

## Core Entity Model
| Entity | Description | CRUD Coverage |
|---|---|---|
| ... | ... | R / RW / Full |

## Endpoint Coverage
{Summary of major resource groups. Note bulk endpoints if present. Note read-only vs. write access.}

## Webhooks
{Supported event types. Delivery mechanism. Retry behavior. Signature security.}
If absent: "No webhook support documented."

## Rate Limits
{Known limits, header names, tier differences.}
If undocumented: "Rate limits not publicly documented."

## SDKs and Integrations
{Official SDKs by language. Native integrations list. Marketplace presence.}

## Architectural Signals
{Inferences from the API surface: maturity, data model choices, integration ecosystem health, notable gaps.}
Label inferences explicitly: "Inference: ..."
```

---

## Common Pitfalls

- **Confusing marketing integrations with real API coverage.** "Integrates with Salesforce" on a features page may mean a native sync built by their team, not an API a customer can use. Verify in docs.
- **Missing sub-resources.** Some entities only appear as nested endpoints (e.g., `/shifts/{id}/breaks`). Browse the full endpoint list, not just the top-level resources.
- **Treating SDK presence as API completeness.** An SDK wraps whatever the API exposes. Check the underlying API for gaps the SDK may paper over.
- **Ignoring changelog for API changes.** The API changelog (if public) reveals where they are actively investing and what has been deprecated. A stable API with no changes may signal abandonment.
- **Assuming private = none.** Some products have undocumented internal APIs that are in active use by integration partners. Look for third-party integration documentation (e.g., Zapier app pages) that may reference API capabilities not in public docs.
