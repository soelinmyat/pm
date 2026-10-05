# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Legacy per-unit evidence only:** the current authoritative Review skill retains its fresh-context independence and final verdict. Review the approved outcome, repository rules, source diff and relevant tests independently before seeing implementer claims; do not let a prior compliance pass imply code quality.

```
Code quality review agent:
  Use the code-review agent defined in the dev plugin

  REPOSITORY_AND_DOMAIN_CONTEXT: [sourced applicable rules]
  FIRST_PASS: Assess source/tests independently and record observations before rationale
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  BASE_SHA: [commit before task]
  HEAD_SHA: [current commit]
  DESCRIPTION: [approved user/domain outcome]
  AFTER_FIRST_PASS: [implementer report/rationale supplied separately; verify discrepancies]
```

**In addition to standard code quality concerns, the reviewer should check:**
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did the change scatter a domain rule, obscure dependency direction, or couple unrelated responsibilities? Size and abstraction counts are cues, not defects; explain the concrete maintenance consequence and preserve cohesive exceptions.
- Would tests reject a plausible behavioral regression, or only mirror mocks/implementation? Check independent expectations, changed producer/consumer contracts and relevant permission/error/empty variants.
- Distinguish confirmed defects, supported tradeoffs, and unexamined behavior; do not invent certainty from a green suite or compliance verdict.

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment
