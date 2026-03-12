---
type: topic-research
topic: Custom Instructions for AI Tools
created: 2026-03-13
updated: 2026-03-13
source_origin: external
sources:
  - url: https://medium.com/data-science-collective/the-complete-guide-to-ai-agent-memory-files-claude-md-agents-md-and-beyond-49ea0df5c5a9
    accessed: 2026-03-13
  - url: https://openai.com/index/custom-instructions-for-chatgpt/
    accessed: 2026-03-13
  - url: https://openai.com/index/the-instruction-hierarchy/
    accessed: 2026-03-13
  - url: https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions
    accessed: 2026-03-13
  - url: https://docs.github.com/en/copilot/tutorials/use-custom-instructions
    accessed: 2026-03-13
  - url: https://code.claude.com/docs/en/plugins
    accessed: 2026-03-13
  - url: https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6
    accessed: 2026-03-13
  - url: https://www.agentrulegen.com/guides/how-to-write-ai-coding-rules
    accessed: 2026-03-13
  - url: https://www.chatprd.ai/
    accessed: 2026-03-13
  - url: https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-instructions
    accessed: 2026-03-13
---

# Custom Instructions for AI Tools

## Summary

Custom instructions have become a universal pattern across AI tools — from ChatGPT's two-field system to Claude Code's CLAUDE.md files to Cursor's .cursorrules. The pattern works: persistent user context injected into every interaction eliminates repetitive prompting and produces more relevant output. For PM, this is proven territory with a clear implementation path — the only design decisions are format, scope (personal vs shared), and how to handle conflicts with skill-level hard gates.

## Findings

1. **The custom instructions pattern is now universal across AI tools.** Every major AI coding assistant has adopted project-level instruction files: Claude Code uses CLAUDE.md, Cursor uses .cursor/rules/, GitHub Copilot uses .github/copilot-instructions.md, Windsurf uses .windsurf/rules, Google Jules uses JULIUS.md. AGENTS.md emerged in mid-2025 as a cross-tool standard maintained by the Linux Foundation's Agentic AI Foundation. The pattern is so established that dedicated editors exist (ClaudeMDEditor.com).

2. **ChatGPT pioneered the two-field pattern.** OpenAI's custom instructions use two fields: "What would you like ChatGPT to know about you?" (context) and "How would you like ChatGPT to respond?" (behavior). Each has a 1,500-character limit. These are injected as system prompts into every conversation. This two-part structure (context + preferences) is the simplest proven model.

3. **Instruction hierarchy is a solved problem.** OpenAI published research on instruction hierarchy (2024): Root > System > Developer > User > Guidelines. Claude Code follows a similar pattern: user instructions (CLAUDE.md) > superpowers skills > default system prompt. The key principle: higher-authority instructions override lower ones, but user-level instructions should never override safety or core tool behavior. For PM, this means: skill hard gates (e.g., strategy check in groom) should not be overridable by user instructions.

4. **File-based instructions outperform UI-based settings for developer tools.** CLAUDE.md, .cursorrules, and AGENTS.md are all plain files in the repo — version-controlled, shareable, diffable. ChatGPT's UI-based custom instructions work for consumers but lack these properties. PM's audience is developers and small squads who already manage CLAUDE.md files. A markdown file in `.pm/` is the natural format.

5. **No PM competitor offers customizable instructions.** PM Skills Marketplace produces generic framework output with no customization. ChatPRD has "Projects" with saved context but it's cloud-only and locked behind Pro+. Productboard Spark has organizational memory but not user-editable instruction files. This is a genuine gap — PM would be the first editor-native PM tool with local, free, user-editable instructions.

6. **Instruction quality degrades beyond ~1,000 lines.** GitHub Copilot docs recommend keeping instruction files under 1,000 lines. OpenAI's research shows models struggle with contradictory or overly complex instructions — they either try to do both, pick the "safer" interpretation, or silently ignore the harder instruction. Best practices: use headings, bullet points, short imperatives. Avoid narrative paragraphs and contradictions.

7. **The personal vs. shared split is already solved.** Claude Code has three tiers: user-level (~/.claude/), project-level (.claude/), and directory-level. Cursor has global rules and project rules. ChatGPT has account-level custom instructions. The pattern is clear: personal preferences (gitignored) + shared team conventions (committed). PM should support both: `.pm/instructions.md` (gitignored, personal) and `pm/instructions.md` (committed, shared), with personal overriding shared on conflict.

## Strategic Relevance

Directly supports **Priority 2: Quality of groomed output.** Custom instructions front-load team-specific context (terminology, frameworks, writing style, competitors to track) so every skill produces more relevant output without the user repeating themselves. This is also a differentiator — no competitor in the PM space offers local, file-based instruction customization.

## Implications

- **Implementation is low-risk.** The pattern is proven across dozens of tools. PM can follow the CLAUDE.md model: a markdown file read at skill invocation, injected as additional context. No new runtime, no parser, no UI.
- **Two files, clear hierarchy.** `pm/instructions.md` (shared, committed) + `.pm/instructions.md` (personal, gitignored). Personal overrides shared. Both override nothing in skill hard gates.
- **Hard gates must be protected.** Strategy check in groom, research-before-scoping — these are non-negotiable skill behaviors. Instructions should guide tone, format, and preferences, not disable safety gates.
- **Content structure should follow the two-field pattern.** Context (who are you, what's your product, what terminology) + Preferences (output format, writing style, review depth). Keep it simple — users already know this pattern from ChatGPT.

## Open Questions

1. Should instructions be structured (YAML frontmatter + sections) or freeform markdown? Freeform is simpler but harder to parse for specific overrides.
2. Should PM validate instructions on read and warn about potential conflicts with skill behavior?
3. How should instructions interact with strategy.md? If instructions say "our ICP is enterprise" but strategy.md says "SMB," which wins?
4. Should there be a `pm instructions init` command that scaffolds the file with a template?

## Source References

- [The Complete Guide to AI Agent Memory Files](https://medium.com/data-science-collective/the-complete-guide-to-ai-agent-memory-files-claude-md-agents-md-and-beyond-49ea0df5c5a9) — accessed 2026-03-13
- [Custom Instructions for ChatGPT](https://openai.com/index/custom-instructions-for-chatgpt/) — accessed 2026-03-13
- [The Instruction Hierarchy (OpenAI)](https://openai.com/index/the-instruction-hierarchy/) — accessed 2026-03-13
- [ChatGPT Custom Instructions Help](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions) — accessed 2026-03-13
- [GitHub Copilot Custom Instructions](https://docs.github.com/en/copilot/tutorials/use-custom-instructions) — accessed 2026-03-13
- [Claude Code Plugins Docs](https://code.claude.com/docs/en/plugins) — accessed 2026-03-13
- [AI Agent Rule Files (devalias gist)](https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6) — accessed 2026-03-13
- [How to Write AI Coding Rules](https://www.agentrulegen.com/guides/how-to-write-ai-coding-rules) — accessed 2026-03-13
- [ChatPRD](https://www.chatprd.ai/) — accessed 2026-03-13
- [Microsoft Copilot Agent Instructions](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-instructions) — accessed 2026-03-13
