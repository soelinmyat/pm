---
type: topic-research
topic: Coding Agent Evaluation Methods
created: 2026-04-02
updated: 2026-04-02
source_origin: external
sources:
  - url: https://aider.chat/docs/leaderboards/
    accessed: 2026-04-02
  - url: https://github.com/Aider-AI/aider/tree/main/benchmark
    accessed: 2026-04-02
  - url: https://github.com/OpenHands/benchmarks
    accessed: 2026-04-02
  - url: https://www.swebench.com/
    accessed: 2026-04-02
  - url: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
    accessed: 2026-04-02
  - url: https://cursor.com/blog/cursorbench
    accessed: 2026-04-02
  - url: https://cognition.ai/blog/devin-annual-performance-review-2025
    accessed: 2026-04-02
  - url: https://hal.cs.princeton.edu/swebench_verified_mini
    accessed: 2026-04-02
  - url: https://eval.moatless.ai/
    accessed: 2026-04-02
  - url: https://swe-rebench.com/
    accessed: 2026-04-02
---

# Coding Agent Evaluation Methods

## Summary

The coding agent eval landscape has consolidated around SWE-bench variants for pass rate, but leading teams (Aider, OpenHands) track cost, tokens, time, and error rates per run. SWE-bench Verified is considered contaminated as of Feb 2026; the industry is shifting to SWE-bench Pro. For fast iteration, SWE-bench Verified Mini (50 tasks) and Lite (300) remain practical.

## Findings

1. **SWE-bench Verified is contaminated.** OpenAI showed frontier models can reproduce gold patches from memory, and ~60% of unsolved problems have flawed tests. SWE-bench Pro (1,865 tasks, 4 languages by Scale AI) is the new standard for leaderboard claims.

2. **SWE-bench Lite (300) and Verified Mini (50) remain useful for iteration.** Teams use these internally for fast feedback, reserving full runs for leaderboard submissions. Verified Mini is the official fast subset at HAL Princeton.

3. **Cost tracking is table stakes.** Aider tracks total_cost, seconds_per_case, prompt/completion tokens per run. OpenHands tracks accumulated_cost per instance with a dedicated aggregation script. SWE-rebench.com ranks by cost per problem.

4. **Aider's metrics are the most comprehensive.** Beyond pass rate, they track: edit format success rate, malformed responses, syntax errors, indentation errors, lazy comments, exhausted context windows, test timeouts. This reveals WHY tasks fail, not just how many.

5. **Versioned results enable trend tracking.** Aider stores YAML with date, version, and commit hash. OpenHands pushes to an index store. Both enable time-series analysis of improvements.

6. **Cursor built a proprietary benchmark from real engineering sessions.** "Cursor Blame" traces committed code back to original agent requests for natural ground-truth pairs. CursorBench complexity has doubled across versions.

7. **Moatless EvalTools provides cloud scoring.** Upload predictions JSONL, get results in ~15 minutes. No Docker required. Alternative to running the full eval harness locally.

8. **Claude Code scores 58% on SWE-bench Pro, 80.9% on Verified.** These are the scaffold numbers (with tool use, retries, context management), not raw model pass rates.

## Implications

For the pm plugin eval:
- Use Lite or Verified Mini for fast iteration (50 tasks, ~1 hour)
- Track cost + tokens + time alongside resolve rate (Aider's pattern)
- Version results with date + plugin version + commit hash (YAML files)
- The prompt must invoke /dev to actually exercise the skill
- Biweekly runs at ~$50/run are sustainable for regression tracking

## Open Questions

- Should we eventually build a pm-specific benchmark (like CursorBench) that tests plugin-specific workflows rather than general bug fixing?
- Is SWE-bench Lite diverse enough, or should we hand-pick tasks where TDD/debugging adds measurable value?
- Should we track Aider-style "edit format success rate" to measure tool discipline?
