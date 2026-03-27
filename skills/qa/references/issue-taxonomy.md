# QA Issue Taxonomy

Reference for the 7 issue categories and 4 severity levels used by pm:qa.

---

## Categories

| # | Category        | Weight | What it covers                                                                 |
|---|-----------------|--------|--------------------------------------------------------------------------------|
| 1 | Console         | 15%    | JS errors, unhandled rejections, failed network requests, deprecation warnings |
| 2 | Links           | 10%    | Broken links, incorrect hrefs, missing navigation, dead ends                   |
| 3 | Visual          | 10%    | Layout breaks, overflow, z-index issues, responsive breakage, alignment        |
| 4 | Functional      | 20%    | Non-working features, forms, buttons, incorrect behavior                       |
| 5 | UX              | 15%    | Confusing flows, missing feedback, poor errors, cognitive overload             |
| 6 | Performance     | 10%    | Slow loads, jank, unnecessary re-renders, large payloads                       |
| 7 | Accessibility   | 15%    | Missing alt text, keyboard nav, color contrast, screen reader, focus mgmt      |

Weights sum to **100%**. Each category starts at **100 points**.

---

## Severity Levels

| Severity | Point Deduction |
|----------|-----------------|
| Critical | -25             |
| High     | -15             |
| Medium   | -8              |
| Low      | -3              |

Each finding deducts from its category's score. Category scores floor at 0.

---

## Category Detail

### 1. Console (15%)

| Severity | Example                                                        |
|----------|----------------------------------------------------------------|
| Critical | Unhandled exception that crashes the page                      |
| High     | Failed API call with no error handling visible to user         |
| Medium   | Console warning that indicates a bug (e.g., React key warning) |
| Low      | Deprecation warning, minor console noise                       |

### 2. Links (10%)

| Severity | Example                                     |
|----------|---------------------------------------------|
| Critical | Primary navigation broken (user stranded)   |
| High     | Broken link in core flow                    |
| Medium   | Broken link in secondary flow               |
| Low      | Link goes to wrong anchor, minor href issue |

### 3. Visual (10%)

| Severity | Example                                                              |
|----------|----------------------------------------------------------------------|
| Critical | Page unusable (content hidden behind elements, completely broken layout) |
| High     | Significant layout break on a primary viewport                       |
| Medium   | Minor alignment issue, content overflow on one viewport              |
| Low      | 1-2px misalignment, subtle spacing inconsistency                     |

### 4. Functional (20%)

| Severity | Example                                                         |
|----------|-----------------------------------------------------------------|
| Critical | Core feature completely non-functional, data loss possible      |
| High     | Feature works but produces wrong result, or fails silently      |
| Medium   | Feature works but with unexpected behavior in edge case         |
| Low      | Feature works but could be confusing (unclear feedback)         |

### 5. UX (15%)

| Severity | Example                                                                      |
|----------|------------------------------------------------------------------------------|
| Critical | User can complete an action that causes irreversible harm with no confirmation |
| High     | User gets stuck in flow with no way out, or essential feedback missing        |
| Medium   | Unclear labeling, confusing flow order, missing loading states                |
| Low      | Minor wording improvement, could be slightly clearer                         |

### 6. Performance (10%)

| Severity | Example                                                         |
|----------|-----------------------------------------------------------------|
| Critical | Page takes >10s to load or is completely unresponsive           |
| High     | Core interaction takes >3s with no loading indicator            |
| Medium   | Noticeable jank on scroll/animation, slow secondary page        |
| Low      | Slightly slow transition, could be optimized                    |

### 7. Accessibility (15%)

| Severity | Example                                                                    |
|----------|----------------------------------------------------------------------------|
| Critical | Core flow completely inaccessible (can't be used without mouse)            |
| High     | Important interactive element not keyboard-accessible, missing form labels |
| Medium   | Images without alt text, insufficient color contrast on non-critical text  |
| Low      | Minor focus order improvement, decorative image without empty alt          |

---

## Scoring

```
category_score = max(0, 100 - sum(deductions))
health_score   = sum(category_score * category_weight)
```

Final health score is the weighted average of all 7 category scores.

---

## Verdict Thresholds

| Verdict              | Conditions                                    |
|----------------------|-----------------------------------------------|
| **Pass**             | health >= 80, no critical, no high            |
| **Pass with concerns** | health >= 60, no critical, <= 2 high       |
| **Fail**             | health < 60, or any critical, or > 2 high     |
| **Blocked**          | Unable to test (environment issue)            |
