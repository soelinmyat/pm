# Test Layer Routing — Principles

Principles for inside-out TDD across any stack. Project-specific test commands and patterns come from AGENTS.md.

## Inside-Out TDD Order

Always build from the inside out:

1. **Domain logic / models** — pure business rules, no I/O
2. **Backend integration** — API endpoints, database queries, auth
3. **Contract sync** — regenerate API specs, update frontend mocks (if project uses contract tooling)
4. **Frontend components** — isolated component tests with mocked API
5. **E2E flows** — full user journeys through the running app

Each layer's tests must pass before proceeding to the next.

## Platform → Test Layer Matrix

| Platform | Layer 1 | Layer 2 | Layer 3 | Layer 4 |
|----------|---------|---------|---------|---------|
| **Backend only** | Unit/integration tests | API contract gen (if applicable) | — | — |
| **Web + Backend** | Backend integration | Contract gate | Frontend component tests | Web E2E (user flows) |
| **Mobile + Backend** | Backend integration | Contract gate (if applicable) | Component tests (RNTL etc.) | Mobile E2E (Maestro, Detox, etc.) |
| **Web + Mobile + Backend** | Backend first, then Web, then Mobile (sequential) | | | |
| **Web frontend only** | Verify mocks/handlers | Component tests | Web E2E (user flows) | — |
| **Mobile only** | Component tests | Mobile E2E (user flows) | — | — |

## Contract Sync Gate

If the project uses API contract tooling (OpenAPI, GraphQL codegen, tRPC, etc.):

1. **Regenerate the API spec** using the project's codegen command (from AGENTS.md)
2. **Update frontend mocks/handlers** to match the new spec
3. **Run contract smoke test** to validate mocks against spec

If the spec file has uncommitted changes after regeneration, it was stale. Commit the updated spec before proceeding.

Projects without contract tooling skip this gate. Mobile apps that use hand-written types validated at integration test time also skip.

## Test Layer Principles

### Backend Tests
- Test behavior through the public API, not internal implementation
- Use integration/request tests for API endpoints
- Test auth, authorization, and edge cases at the integration layer
- Unit test complex business logic in isolation

### Frontend Component Tests
- Use the project's component testing setup (Vitest + Testing Library, Jest + RTL, etc.)
- Mock API calls using the project's mock layer (MSW, nock, etc.)
- Test user interactions: clicks, form fills, navigation
- Verify error states, loading states, empty states

### E2E Tests

**When to write E2E:**
- CRUD flow (create -> list -> detail -> edit -> delete)
- Multi-step journey (onboarding, checkout, multi-screen workflow)
- Auth-dependent behavior (role-based visibility, login/logout)
- Navigation-heavy flows

**When to skip E2E:**
- Purely visual change (spacing, colors)
- Internal refactor (no behavior change)
- Backend-only (no UI)
- Component-only change already covered by component tests

### Mobile E2E (Maestro / Detox / etc.)
- Test against real simulator/emulator, not mocked environments
- Include app launch verification as a smoke test
- Screenshot at key states for design critique integration
- Read AGENTS.md for mobile E2E framework, commands, and flow locations

## Verification Commands

Read AGENTS.md for the project's specific verification commands. Common patterns:

| Layer | Common commands |
|-------|----------------|
| Backend unit/integration | `bundle exec rails test`, `pytest`, `go test ./...` |
| API contract gen | Project-specific codegen command |
| Contract smoke | Project-specific smoke test |
| Frontend component | `pnpm test`, `npm test`, `yarn test` |
| Web E2E | `pnpm e2e`, `npx playwright test` |
| Mobile E2E smoke | Project-specific smoke command |
| Mobile E2E full | Project-specific E2E command |
| Type check | `pnpm typecheck`, `tsc --noEmit`, `mypy` |
