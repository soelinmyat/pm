# API Analysis Methodology

A competitor's public API documents an external integration contract. It shows which resources and operations are available to a documented audience and plan; it does not reveal the complete internal architecture, product maturity, or product-market fit. Separate documented capability, observed behavior, and hypotheses throughout this analysis.

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

If the search finds no public documentation, note "Public API documentation not found in the searched locations" and name those locations. Distinguish verified absence from undiscovered, partner-only, plan-gated, or private access.

---

## What to Extract

### Auth Model

Record the documented authentication mechanism, supported audience, scopes, revocation, and restrictions. Evaluate whether it supports the integration job; the mechanism alone does not establish maturity or security quality.

| Mechanism | What to verify |
|---|---|
| API key | Scope boundaries, storage guidance, rotation and revocation |
| OAuth 2.0 | Delegated access, grant types, consent, scopes and token lifecycle |
| JWT | How tokens are issued and validated; JWT is a token format, not an alternative to OAuth |
| Session cookie | Whether supported programmatic use is documented and authorized |
| Multiple mechanisms | Which audience and use case each mechanism supports |

Note: scope granularity matters. "Read-only API key" and "full-access API key" are meaningfully different security postures.

### Core Entity Model

List the primary objects the API exposes. These are not endpoints — they are the nouns of the documented external resource model. Do not equate it with the internal database model.

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

If no `Shift` resource is documented, record that scheduling integrations may lack a documented shift operation. Check nested resources, plan restrictions and alternate APIs before concluding it is absent. Do not infer that the product internally lacks a first-class shift model.

### Endpoint Coverage

For each entity, note which operations are available:

| Entity | List | Get | Create | Update | Delete | Bulk |
|---|---|---|---|---|---|---|
| ...    | Y    | Y   | Y      | N      | N      | N    |

Read-only access limits the documented integration jobs; it may be an intentional security, audience, or product boundary. Identify the blocked job rather than claiming the API was an afterthought.

Assess throughput against a concrete job and workload. Bulk operations may help, but queues, batching, pagination or other documented mechanisms may also suffice. Customer pain and scale require evidence beyond endpoint shape.

### Webhooks

Webhooks reveal what the product considers "events" and how they think about real-time integration.

Extract:
- Supported event types (list all named events)
- Payload structure (what data is included vs. requiring a follow-up GET)
- Delivery mechanism: HTTP POST to registered URL vs. message queue (SQS, Pub/Sub)
- Retry behavior: Does it retry on failure? How many times? Exponential backoff?
- Security: HMAC signature verification, shared secret, or nothing?

When no webhook support is documented, check streaming, subscriptions, event exports and native integrations. State the latency or coverage limitation for the documented integration route; absence of webhooks does not prove the internal architecture is polling-only.

### Rate Limits

Note:
- Requests per second / per minute / per hour / per day
- Whether limits are per API key, per organization, or per endpoint
- Header names that communicate current limit state (`X-RateLimit-Remaining`, etc.)
- Upgrade path if limits are tiered by plan

Calculate whether documented limits support the named workload and recovery/retry needs. Do not infer infrastructure investment or seriousness from a rate-limit number alone.

### SDK Availability

| Language | Official SDK | Community SDK | Notes |
|---|---|---|---|
| JavaScript / TypeScript | Y/N | Y/N | |
| Python | Y/N | Y/N | |
| Ruby | Y/N | Y/N | |
| PHP | Y/N | Y/N | |
| Go | Y/N | Y/N | |

Record maintenance dates, supported API versions and coverage. An official SDK does not prove scale or reliability; a community SDK is evidence of that project, not representative customer demand.

### Native Integrations and Marketplace

- List named integrations (Zapier, Slack, Salesforce, etc.)
- Note if there is an app marketplace or integration directory
- Check if they are listed in Zapier / Make / Workato — this reveals integration popularity signals

---

## Interpreting the Documented Surface

Use the smallest claim the source supports:

| Observation | Supported conclusion | Unverified inference |
|---|---|---|
| Read/write operations documented | These operations are available under the stated access conditions | Built for integration from inception |
| Webhook catalog and retry policy documented | Named events and delivery behavior are promised | Internally event-driven architecture or proven reliability |
| GraphQL or REST endpoint | This query/interface style is exposed | Modern rewrite, maturity or backward compatibility |
| Versioned URLs | Version selection is explicit | Changes cannot break clients |
| Marketplace integrations listed | Named connectors are offered | Product-market fit, customer adoption or battle-tested scale |

Compare resource vocabulary and documented operations with the user's integration job. Test meaningful limitations such as inability to update an approved shift or consume deletions; avoid judging architecture from naming alone. Switching-cost, ecosystem demand, and customer-outcome claims require independent adoption or customer evidence. Unknowns remain unknown, with a proposed check only when the answer could change the decision.

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
{Documented external contract, workload-specific constraints, and explicitly bounded hypotheses. Include alternative explanations and what would confirm a consequential hypothesis.}
Label inferences explicitly: "Inference: ..."
```

---

## Common Pitfalls

- **Confusing marketing integrations with real API coverage.** "Integrates with Salesforce" on a features page may mean a native sync built by their team, not an API a customer can use. Verify in docs.
- **Missing sub-resources.** Some entities only appear as nested endpoints (e.g., `/shifts/{id}/breaks`). Browse the full endpoint list, not just the top-level resources.
- **Treating SDK presence as API completeness.** An SDK wraps whatever the API exposes. Check the underlying API for gaps the SDK may paper over.
- **Ignoring changelog for API changes.** The API changelog (if public) reveals where they are actively investing and what has been deprecated. No recent changelog entries establish only that no changes were found there; stability, unpublished changes and abandonment require different evidence.
- **Assuming private = none.** Some products have undocumented internal APIs that are in active use by integration partners. Look for third-party integration documentation (e.g., Zapier app pages) that may reference API capabilities not in public docs.
