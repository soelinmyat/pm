"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  loadWorkflow,
  loadPhaseStep,
  buildPrompt,
  buildPhasePrompt,
  selectWorkflowStep,
  loadPersonas,
} = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "step-loader-test-"));
}

/**
 * Create a temp project layout and return paths.
 * projectRoot/
 *   pm/             <- pmDir
 *   .pm/
 *     config.json
 *     workflows/{command}/{step}.md
 *     personas/{name}.md
 *
 * pluginRoot/
 *   skills/{command}/steps/{step}.md
 *   personas/{name}.md
 */
function scaffold(opts = {}) {
  const projectRoot = makeTmpDir();
  const pluginRoot = makeTmpDir();
  const pmDir = path.join(projectRoot, "pm");
  fs.mkdirSync(pmDir, { recursive: true });

  // Write default step files in plugin
  if (opts.defaultSteps) {
    for (const [cmd, steps] of Object.entries(opts.defaultSteps)) {
      const dir = path.join(pluginRoot, "skills", cmd, "steps");
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(steps)) {
        fs.writeFileSync(path.join(dir, name), content);
      }
    }
  }

  // Write user override step files
  if (opts.userSteps) {
    for (const [cmd, steps] of Object.entries(opts.userSteps)) {
      const dir = path.join(projectRoot, ".pm", "workflows", cmd);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(steps)) {
        fs.writeFileSync(path.join(dir, name), content);
      }
    }
  }

  // Write default persona files in plugin
  if (opts.defaultPersonas) {
    const dir = path.join(pluginRoot, "agents");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(opts.defaultPersonas)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
  }

  // Write user persona overrides
  if (opts.userPersonas) {
    const dir = path.join(projectRoot, ".pm", "personas");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(opts.userPersonas)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
  }

  // Write config
  if (opts.config) {
    const configDir = path.join(projectRoot, ".pm");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(opts.config, null, 2));
  }

  return {
    projectRoot,
    pluginRoot,
    pmDir,
    cleanup() {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    },
  };
}

function stepFile(name, order, description, body) {
  return `---\nname: ${name}\norder: ${order}\ndescription: ${description}\n---\n\n${body}\n`;
}

function phaseStepFile(name, order, phase, body) {
  return `---
name: ${name}
order: ${order}
description: ${name} phase
phase: ${phase}
requires:
  - ${phase}-contract.md
gates:
  - ${phase}-gate
result_schema: phase-result-v1
---

${body}
`;
}

function personaFile(name, description, body) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// loadWorkflow tests
// ---------------------------------------------------------------------------

test("loadWorkflow: loads default steps sorted by order", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "02-implement.md": stepFile("Implement", 2, "Write the code", "Write code here."),
        "01-plan.md": stepFile("Plan", 1, "Plan the work", "Plan your approach."),
        "03-review.md": stepFile("Review", 3, "Review the code", "Review carefully."),
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].name, "Plan");
    assert.equal(steps[0].order, 1);
    assert.equal(steps[0].source, "default");
    assert.equal(steps[0].enabled, true);
    assert.equal(steps[1].name, "Implement");
    assert.equal(steps[1].order, 2);
    assert.equal(steps[2].name, "Review");
    assert.equal(steps[2].order, 3);
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: exposes optional phase metadata without changing legacy fields", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "05-implementation.md": phaseStepFile(
          "Implementation",
          5,
          "implementation",
          "Implement now."
        ),
      },
    },
  });

  try {
    const [step] = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(step.phase, "implementation");
    assert.deepEqual(step.requires, ["implementation-contract.md"]);
    assert.deepEqual(step.gates, ["implementation-gate"]);
    assert.equal(step.resultSchema, "phase-result-v1");
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: user override replaces same-named default step", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-plan.md": stepFile("Plan", 1, "Default plan", "Default plan body."),
      },
    },
    userSteps: {
      dev: {
        "01-plan.md": stepFile("Custom Plan", 1, "User plan", "User plan body."),
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].name, "Custom Plan");
    assert.ok(steps[0].body.includes("User plan body."));
    assert.ok(!steps[0].body.includes("Default plan body."));
    assert.equal(steps[0].source, "user");
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: user overrides cannot weaken bundled phase contracts", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "05-implementation.md": `---
name: Implementation
order: 5
phase: implementation
gates: [tdd]
required_capabilities: [local-write]
required_evidence: [test]
allowed_modes: [inline, delegated]
requires_commit: true
---
Default body.
`,
      },
    },
    userSteps: {
      dev: {
        "05-implementation.md": `---
name: Custom implementation
order: 5
phase: implementation
gates: [cosmetic]
required_capabilities: [custom-tool]
required_evidence: [note]
allowed_modes: [inline, headless]
requires_commit: false
---
Custom body.
`,
      },
    },
  });
  try {
    const [step] = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.deepEqual(step.gates, ["tdd", "cosmetic"]);
    assert.deepEqual(step.requiredCapabilities, ["local-write", "custom-tool"]);
    assert.deepEqual(step.requiredEvidence, ["test", "note"]);
    assert.deepEqual(step.allowedModes, ["inline"]);
    assert.equal(step.requiresCommit, true);
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: a legacy filename overrides the uniquely matching phase", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "08-review.md": phaseStepFile("Review", 8, "review", "New default review."),
      },
    },
    userSteps: {
      dev: {
        "07-review.md": stepFile(
          "Legacy override",
          7,
          "Pre-v2 override without phase metadata",
          "Legacy custom review."
        ),
      },
    },
  });
  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].phase, "review");
    assert.equal(steps[0].source, "user");
    assert.match(steps[0].body, /Legacy custom review/);
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: exact override wins deterministically over a legacy alias", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "08-review.md": phaseStepFile("Review", 8, "review", "Bundled review."),
      },
    },
    userSteps: {
      dev: {
        "07-review.md": stepFile("Legacy review", 7, "Legacy", "Legacy override."),
        "08-review.md": stepFile("Exact review", 8, "Exact", "Exact override."),
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].stem, "08-review");
    assert.ok(steps[0].body.includes("Exact override."));
    assert.ok(!steps[0].body.includes("Legacy override."));
  } finally {
    env.cleanup();
  }
});

test("loadPhaseStep: user body override inherits default phase contract metadata", () => {
  const env = scaffold({
    defaultSteps: {
      rfc: {
        "04-approval.md": [
          "---",
          "name: Approval",
          "order: 4",
          "phase: approval",
          "allowed_modes:",
          "  - inline",
          "result_schema: explicit-approval-command",
          "---",
          "Default body.",
        ].join("\n"),
      },
    },
    userSteps: { rfc: { "04-approval.md": stepFile("Custom", 4, "Custom", "Custom body.") } },
  });
  try {
    const step = loadPhaseStep("rfc", "approval", path.dirname(env.pmDir), env.pluginRoot);
    assert.equal(step.source, "user");
    assert.equal(step.phase, "approval");
    assert.deepEqual(step.allowedModes, ["inline"]);
    assert.equal(step.resultSchema, "explicit-approval-command");
    assert.match(step.body, /Custom body/);
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: resolves @persona references from default personas", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-review.md": stepFile("Review", 1, "Review", "Review as @staff-engineer and @tester."),
      },
    },
    defaultPersonas: {
      "staff-engineer.md": personaFile(
        "Staff Engineer",
        "Senior eng",
        "I review code for maintainability."
      ),
      "tester.md": personaFile("Tester", "QA specialist", "I test edge cases."),
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.ok(steps[0].body.includes("I review code for maintainability."));
    assert.ok(steps[0].body.includes("I test edge cases."));
    assert.ok(!steps[0].body.includes("@staff-engineer"));
    assert.ok(!steps[0].body.includes("@tester"));
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: user persona overrides default persona", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-review.md": stepFile("Review", 1, "Review", "Review as @developer."),
      },
    },
    defaultPersonas: {
      "developer.md": personaFile("Developer", "Default dev", "Default developer content."),
    },
    userPersonas: {
      "developer.md": personaFile("Developer", "Custom dev", "Custom developer content."),
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.ok(steps[0].body.includes("Custom developer content."));
    assert.ok(!steps[0].body.includes("Default developer content."));
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: unresolved @persona left as-is with warning", () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-review.md": stepFile("Review", 1, "Review", "Review as @nonexistent-persona."),
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.ok(steps[0].body.includes("@nonexistent-persona"));
    assert.ok(warnings.some((w) => w.includes("nonexistent-persona")));
  } finally {
    console.warn = origWarn;
    env.cleanup();
  }
});

test("loadWorkflow: disabled steps via config", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-plan.md": stepFile("Plan", 1, "Plan", "Plan body."),
        "02-implement.md": stepFile("Implement", 2, "Implement", "Implement body."),
      },
    },
    config: {
      workflows: {
        dev: {
          steps: {
            "01-plan": { enabled: false },
          },
        },
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].name, "Plan");
    assert.equal(steps[0].enabled, false);
    assert.equal(steps[1].name, "Implement");
    assert.equal(steps[1].enabled, true);
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: missing step files returns empty array with warning", () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  const env = scaffold({});

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 0);
  } finally {
    console.warn = origWarn;
    env.cleanup();
  }
});

test("loadWorkflow: malformed frontmatter uses filename as name", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-plan.md": "No frontmatter here, just body content.",
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].name, "01-plan");
    assert.equal(steps[0].order, 1);
    assert.equal(steps[0].description, "");
    assert.ok(steps[0].body.includes("No frontmatter here"));
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: user-only step file (no default) is loaded", () => {
  const env = scaffold({
    userSteps: {
      dev: {
        "01-custom.md": stepFile("Custom Step", 1, "A user-only step", "Custom content."),
      },
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].name, "Custom Step");
    assert.equal(steps[0].source, "user");
  } finally {
    env.cleanup();
  }
});

test("loadWorkflow: @persona not replaced inside code blocks", () => {
  const env = scaffold({
    defaultSteps: {
      dev: {
        "01-review.md": stepFile(
          "Review",
          1,
          "Review",
          "Review as @developer.\n\n```\nExample: @developer is a reference\n```\n\nAlso check @developer."
        ),
      },
    },
    defaultPersonas: {
      "developer.md": personaFile("Developer", "Dev", "Dev persona content."),
    },
  });

  try {
    const steps = loadWorkflow("dev", env.pmDir, env.pluginRoot);
    // @developer outside code block should be resolved
    assert.ok(steps[0].body.includes("Dev persona content."));
    // @developer inside code block should be left as-is
    assert.ok(steps[0].body.includes("@developer is a reference"));
  } finally {
    env.cleanup();
  }
});

// ---------------------------------------------------------------------------
// buildPrompt tests
// ---------------------------------------------------------------------------

test("buildPrompt: concatenates only enabled steps", () => {
  const steps = [
    {
      name: "Plan",
      order: 1,
      description: "Plan",
      body: "Plan body.",
      enabled: true,
      source: "default",
    },
    {
      name: "Implement",
      order: 2,
      description: "Implement",
      body: "Implement body.",
      enabled: false,
      source: "default",
    },
    {
      name: "Review",
      order: 3,
      description: "Review",
      body: "Review body.",
      enabled: true,
      source: "default",
    },
  ];

  const prompt = buildPrompt(steps);
  assert.ok(prompt.includes("Plan body."));
  assert.ok(!prompt.includes("Implement body."));
  assert.ok(prompt.includes("Review body."));
});

test("buildPrompt: separates steps with markdown headings", () => {
  const steps = [
    {
      name: "Plan",
      order: 1,
      description: "Plan the work",
      body: "Plan body.",
      enabled: true,
      source: "default",
    },
    {
      name: "Review",
      order: 2,
      description: "Review the code",
      body: "Review body.",
      enabled: true,
      source: "default",
    },
  ];

  const prompt = buildPrompt(steps);
  assert.ok(prompt.includes("## Step 1: Plan"));
  assert.ok(prompt.includes("## Step 2: Review"));
});

test("buildPrompt: returns empty string for no enabled steps", () => {
  const steps = [
    {
      name: "Plan",
      order: 1,
      description: "Plan",
      body: "Plan body.",
      enabled: false,
      source: "default",
    },
  ];

  const prompt = buildPrompt(steps);
  assert.equal(prompt, "");
});

test("selectWorkflowStep: selects one enabled phase by phase, stem, or order", () => {
  const steps = [
    { stem: "02-intake", phase: "intake", order: 2, name: "Intake", enabled: true },
    {
      stem: "05-implementation",
      phase: "implementation",
      order: 5,
      name: "Implementation",
      enabled: true,
    },
  ];

  assert.equal(selectWorkflowStep(steps, { phase: "implementation" }).stem, "05-implementation");
  assert.equal(selectWorkflowStep(steps, { stem: "02-intake" }).phase, "intake");
  assert.equal(selectWorkflowStep(steps, { order: 5 }).name, "Implementation");
  assert.equal(selectWorkflowStep(steps, "implementation").order, 5);
});

test("selectWorkflowStep: ignores disabled steps and rejects ambiguous selectors", () => {
  const disabled = [
    { stem: "05-implementation", phase: "implementation", order: 5, enabled: false },
  ];
  assert.equal(selectWorkflowStep(disabled, { phase: "implementation" }), null);

  const duplicate = [
    { stem: "05-a", phase: "implementation", order: 5, enabled: true },
    { stem: "06-b", phase: "implementation", order: 6, enabled: true },
  ];
  assert.throws(
    () => selectWorkflowStep(duplicate, { phase: "implementation" }),
    /matched multiple workflow steps/
  );
});

test("buildPhasePrompt: includes only the selected phase and preserves buildPrompt behavior", () => {
  const steps = [
    {
      stem: "05-implementation",
      phase: "implementation",
      name: "Implementation",
      order: 5,
      body: "ACTIVE_IMPLEMENT_TOKEN",
      enabled: true,
    },
    {
      stem: "08-ship",
      phase: "ship",
      name: "Ship",
      order: 8,
      body: "FUTURE_SHIP_TOKEN",
      enabled: true,
    },
  ];

  const phasePrompt = buildPhasePrompt(steps, { phase: "implementation" });
  assert.match(phasePrompt, /ACTIVE_IMPLEMENT_TOKEN/);
  assert.doesNotMatch(phasePrompt, /FUTURE_SHIP_TOKEN/);

  const legacyPrompt = buildPrompt(steps);
  assert.match(legacyPrompt, /ACTIVE_IMPLEMENT_TOKEN/);
  assert.match(legacyPrompt, /FUTURE_SHIP_TOKEN/);
});

// ---------------------------------------------------------------------------
// loadPersonas tests
// ---------------------------------------------------------------------------

test("loadPersonas: loads default personas", () => {
  const env = scaffold({
    defaultPersonas: {
      "developer.md": personaFile("Developer", "Implementation specialist", "Dev body."),
      "tester.md": personaFile("Tester", "QA specialist", "Test body."),
    },
  });

  try {
    const personas = loadPersonas(env.pmDir, env.pluginRoot);
    assert.equal(personas.length, 2);
    const dev = personas.find((p) => p.name === "Developer");
    assert.ok(dev);
    assert.equal(dev.description, "Implementation specialist");
    assert.equal(dev.source, "default");
    assert.equal(dev.customized, false);
  } finally {
    env.cleanup();
  }
});

test("loadPersonas: marks user-customized personas", () => {
  const env = scaffold({
    defaultPersonas: {
      "developer.md": personaFile("Developer", "Default dev", "Default body."),
    },
    userPersonas: {
      "developer.md": personaFile("Developer", "Custom dev", "Custom body."),
    },
  });

  try {
    const personas = loadPersonas(env.pmDir, env.pluginRoot);
    assert.equal(personas.length, 1);
    assert.equal(personas[0].name, "Developer");
    assert.equal(personas[0].description, "Custom dev");
    assert.equal(personas[0].source, "user");
    assert.equal(personas[0].customized, true);
  } finally {
    env.cleanup();
  }
});

test("loadPersonas: user-only persona appears with customized=true", () => {
  const env = scaffold({
    userPersonas: {
      "custom-role.md": personaFile("Custom Role", "A custom role", "Custom role body."),
    },
  });

  try {
    const personas = loadPersonas(env.pmDir, env.pluginRoot);
    assert.equal(personas.length, 1);
    assert.equal(personas[0].name, "Custom Role");
    assert.equal(personas[0].source, "user");
    assert.equal(personas[0].customized, true);
  } finally {
    env.cleanup();
  }
});

test("loadPersonas: returns empty array when no personas exist", () => {
  const env = scaffold({});

  try {
    const personas = loadPersonas(env.pmDir, env.pluginRoot);
    assert.deepEqual(personas, []);
  } finally {
    env.cleanup();
  }
});
