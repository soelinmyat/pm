---
title: "PM for OpenCode V2"
created: 2026-10-06
updated: 2026-10-06
---

# PM for OpenCode V2

OpenCode 2.0.24 or later stable V2 releases can run PM's interactive product and development workflows. Use the native plugin, not only Codex fallback skill symlinks: skill discovery alone does not install commands, personas, or the push gate.

## Install

Use Node 20+ with Git and an authenticated `gh` for delivery. Start OpenCode from a shell where those executables are on `PATH`. PM never sources shell startup files or searches for credentials.

Clone PM into a stable directory. The adapter uses Node built-ins and does not install a second OpenCode runtime:

```sh
git clone https://github.com/soelinmyat/pm ~/.local/share/pm-opencode
node ~/.local/share/pm-opencode/scripts/opencode-install.js --config ~/.config/opencode/opencode.json
```

Choose the config path explicitly. Use `<project>/.opencode/opencode.json` instead for a project-local installation. Respect `XDG_CONFIG_HOME` if configured. The installer merges only PM's plugin entry and seven `pm:*` persona definitions; it preserves existing providers, MCP servers, models, commands, permissions and unrelated agents. It refuses conflicting PM definitions rather than overwriting customizations. Repeating an unchanged installation is idempotent.

Installer processes serialize with an owned lock; a competing install stops with a retry message. The installer checks the current file bytes again immediately before publication and aborts if an intervening edit is observed. Close other configuration editors while installing: an unrelated writer that does not honor the lock can still race the final check/rename. Object-key ordering is not a customization; actual value changes and permission-array order remain conflicts.

Input and rendered merged configurations are capped at 1 MiB. An oversized merged result is rejected before writing, leaving existing settings unchanged and readable on retry.

For JSONC, first print the configuration fragment and merge its `plugins` and `agents` entries manually into the existing file. Do not create a competing JSON config beside it:

```sh
node ~/.local/share/pm-opencode/scripts/opencode-install.js --print
```

If the tool shell cannot find Node, supply an explicit executable:

```sh
node ~/.local/share/pm-opencode/scripts/opencode-install.js --config ~/.config/opencode/opencode.json --node /absolute/path/to/node
```

This binds PM's gate subprocess to that executable and adds its directory to the tool shell's `PATH`. It does not change your shell configuration or locate `gh` automatically. Restart OpenCode after installation or source updates; do not restart someone else's active service merely to update PM.

## Verify and use

From the consuming project, check native registrations:

```sh
opencode api get /api/plugin
opencode api get /api/skill
opencode api get /api/command
opencode api get /api/agent
```

Confirm plugin `pm` is active, skill `pm-dev` points to this installation, command `pm:dev` exists, and `pm:staff-engineer` is a subagent. Existing `~/.agents/skills/pm-*` aliases are not removed; the native plugin supplies the current definitions for those IDs. Do not register multiple PM plugin copies. The system context and tool environment bind `PM_PLUGIN_ROOT` and the legacy `CLAUDE_PLUGIN_ROOT` to the loaded source.

Use `/pm:think`, `/pm:research`, `/pm:groom`, `/pm:dev`, or `/pm:ship`. Explicit skill mentions such as `@pm-think` also work. Commands preserve task text and attachments and load the owning skill rather than starting an unrelated workflow. Product decisions and external actions retain their ordinary approval boundaries.

Native OpenCode `subagent` calls provide fresh contexts. Use installed `pm:*` persona IDs or pass the persona overlay to a general subagent. Models inherit the host unless explicitly configured; do not reuse Claude's short model aliases. Non-developer personas deny edit tools and ask before shell commands; shell approval must remain scoped to read-only review. Persona registration does not authorize a worker to push, merge, or update trackers.

## Safety and limitations

| Capability | Support |
| --- | --- |
| Product skills, slash commands, persona subagents | Native V2 |
| Interactive Dev/Review/Ship | `inline-current`, with canonical evidence and delivery gates |
| Shell push gate | Canonical `hooks/push-gate`; deny decisions and subprocess errors stop execution |
| UI certification | Existing PM capture helpers and real app/browser/simulator evidence; a generic browser screenshot is not a replacement |
| Headless OpenCode Dev workers and unattended OpenCode Loop | Unsupported; existing adapter checks remain fail-closed |
| Claude lifecycle telemetry and automatic KB pull/push hooks | Not installed; use explicit PM sync workflows |

`opencode run --format json` is not a schema-validated worker-result interface. Do not label OpenCode as Codex, select it through a custom Loop executable, or use `--auto` to bypass missing worker capabilities. Existing Codex/Claude adapters remain available only through their own capability preflight and scoped authorization.

The push gate retains PM's cooperating-agent threat model and its out-of-scope rules. It is not a sandbox against deliberate command obfuscation, direct network APIs, or a human's terminal. No Git hook, global permission grants, credentials, provider changes, or automatic publication are installed.

Update the source with a clean fast-forward pull, then reconcile any changed PM persona definitions before restarting. To uninstall, remove only the exact PM plugin entry and the generated `pm:*` agents you have confirmed are unchanged. Preserve customized definitions and other plugins.
