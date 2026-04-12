# Seed Data Conventions

## Purpose

Seed tasks are the contract between implementation and design critique. The implementing agent creates seed data during implementation. Design critique reuses the same seeds, so both see identical data. No MSW mocks, no Storybook. Real database records, real API responses.

## Location and Naming

- Path: `lib/tasks/design/seeds/{feature_slug}.rake`
- Namespace: `design:seed:{feature_slug}` / `design:teardown:{feature_slug}`
- Feature slug: kebab-case matching the branch/issue name (e.g., `sla-traffic-light`, `work-order-list`)

## Rules

1. **Idempotent.** Use `find_or_create_by!` throughout. Safe to re-run.
2. **Own account.** Create a dedicated account (e.g., "Design Review Co") so seed data doesn't pollute existing dev data.
3. **Cascade teardown.** `design:teardown:{feature}` destroys the account, cascading to all related records.
4. **Cover all visual states.** Happy path, empty state, edge cases.
5. **Seed user with known credentials.** Create a user with `design-review@example.com` / `password123` so Playwright can log in via the real login flow.
6. **Created by the implementing agent.** Part of implementation, not an afterthought. Committed alongside feature code.

## Template

```ruby
# lib/tasks/design/seeds/sla_traffic_light.rake
namespace :design do
  namespace :seed do
    desc "Seed data for SLA traffic light design review"
    task sla_traffic_light: :environment do
      account = Account.find_or_create_by!(name: "Design Review Co") do |a|
        a.sla_green_threshold_minutes = 15
        a.sla_yellow_threshold_minutes = 30
        a.sla_red_threshold_minutes = 60
      end

      location = Location.find_or_create_by!(name: "Downtown Office", account: account)
      cleaner = User.find_or_create_by!(email: "design-review@example.com") do |u|
        u.name = "Maria Gonzalez-Hernandez de la Cruz"  # long name edge case
        u.password = "password123"
      end

      # RED: task breached SLA (past due)
      Task.find_or_create_by!(title: "Deep clean conference room B", account: account) do |t|
        t.location = location
        t.due_at = 20.minutes.ago
        t.assigned_to = cleaner
        t.state = :open
      end

      # YELLOW: approaching deadline
      Task.find_or_create_by!(title: "Restock supplies in lobby", account: account) do |t|
        t.location = location
        t.due_at = 25.minutes.from_now
        t.assigned_to = cleaner
        t.state = :open
      end

      # GREEN: plenty of time
      Task.find_or_create_by!(title: "Vacuum 3rd floor offices", account: account) do |t|
        t.location = location
        t.due_at = 90.minutes.from_now
        t.assigned_to = cleaner
        t.state = :open
      end

      # NO_SLA: no due_at set
      Task.find_or_create_by!(title: "Organize storage closet", account: account) do |t|
        t.location = location
        t.due_at = nil
        t.assigned_to = cleaner
        t.state = :open
      end
    end
  end

  namespace :teardown do
    desc "Remove SLA traffic light design review data"
    task sla_traffic_light: :environment do
      Account.find_by(name: "Design Review Co")&.destroy
    end
  end
end
```

## Edge Case Checklist

Implementing agents MUST verify their seed covers every applicable item:

- [ ] Very long text (names, titles, descriptions that could overflow UI)
- [ ] Empty/zero states (no items, no data for list views)
- [ ] High volume (50+ items for list/table views to test pagination/scroll)
- [ ] All enum/status values (every state the feature can display)
- [ ] Boundary values (threshold edges, midnight dates, timezone-sensitive dates)
- [ ] Missing optional fields (no avatar, no phone, no location name)
- [ ] Multiple roles (admin view vs cleaner view if both are affected)
- [ ] International text (accented characters, RTL if supported, long German compound words)

## Running Seeds

```bash
# Seed for design review
cd apps/api && bin/rails design:seed:{feature_slug}

# Teardown after review
cd apps/api && bin/rails design:teardown:{feature_slug}
```

## When to Create

The seed task is created during implementation (in /dev), not during design critique. The implementing agent:

1. Writes feature code
2. Creates the seed task covering all visual states
3. Runs the seed, starts servers, captures screenshots
4. Visually self-checks before invoking /design-critique
