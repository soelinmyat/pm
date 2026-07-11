const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { detectCapabilities, requireCapabilities } = require("../scripts/dev-runtime/capabilities");

describe("dev runtime capability detection", () => {
  it("detects current Codex structured output, JSONL, containment, and resume", () => {
    const capabilities = detectCapabilities("codex", {
      help: "--sandbox --json --output-schema --output-last-message",
      resumeHelp: "codex exec resume --json --output-schema",
      version: "codex-cli 0.144.0-alpha.4",
    });
    assert.equal(capabilities.structuredOutput, true);
    assert.equal(capabilities.eventStream, true);
    assert.equal(capabilities.resume, true);
    assert.equal(capabilities.safePermissions, true);
  });

  it("fails closed instead of silently downgrading required capabilities", () => {
    const oldClaude = detectCapabilities("claude", {
      help: "--model --print",
      resumeHelp: "",
      version: "1.0.0",
    });
    assert.throws(
      () => requireCapabilities(oldClaude, ["structuredOutput", "eventStream", "safePermissions"]),
      /missing required capabilities/
    );
  });
});
