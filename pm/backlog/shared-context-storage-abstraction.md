---
type: backlog-issue
id: "PM-069"
title: "Storage abstraction layer for server.js"
outcome: "Dashboard works identically against local files or the cloud hub, and pages load without blocking the server"
status: drafted
parent: "shared-context"
children: []
labels:
  - "infrastructure"
  - "refactor"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

The 80+ direct `fs.readFileSync`/`existsSync`/`readdirSync`/`statSync` calls in `scripts/server.js` go through an async storage interface. Local filesystem is the default implementation. S3 can be swapped in without touching any handler code.

## Acceptance Criteria

1. A `StorageProvider` interface exists with methods: `readFile(path)`, `writeFile(path, content)`, `listDir(path, { withTypes: true })` (returns entry name, type file/directory, and mtime), `exists(path)`, `stat(path)` (returns size, mtime, isDirectory), `deleteFile(path)`, `mkdirp(path)`.
2. A `LocalStorageProvider` implementation wraps async `fs/promises` calls, preserving `{ withFileTypes: true }` and `mtimeMs` behavior.
3. All dashboard route handlers use the provider, not direct `fs.*Sync` calls.
4. Zero sync `fs` calls remain in handler code paths. Startup-time static asset reads (frame-template.html, helper.js) and companion-mode screen file reads are excluded — they remain local-only and are not abstracted.
5. `createDashboardServer(pmDir)` accepts an optional `storageProvider` parameter.
6. Existing dashboard tests pass with the local provider.
7. A new test verifies the interface contract with a mock provider.

## Technical Feasibility

**Build-on:** `createDashboardServer(pmDir)` factory at line 3715 already takes a directory path. The abstraction extends this pattern.

**Risk:** Converting sync → async cascades through the rendering pipeline. `parseFrontmatter()`, `inlineMarkdown()`, and all template rendering currently assume synchronous data. Each handler needs async/await conversion.

**Estimate:** M-sized. Mechanical but pervasive — ~80 call sites across 4,134 lines.

## Research Links

- [Shared Context Research — EM Review](pm/research/shared-context/findings.md)

## Notes

- This is foundational — PM-070, PM-071, PM-076 all depend on it.
- Do not introduce external dependencies. Use Node.js built-in `fs/promises`.
- Consider splitting server.js as part of this refactor (EM flagged it as a maintainability risk at 4,134 lines).
