const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dispatchPath = path.join(__dirname, "..", "scripts", "dev-runtime", "dispatch.js");
const { BoundedBuffer, runStreaming } = require("../scripts/dev-runtime/dispatch");

describe("dev runtime structured dispatch", () => {
  it("bounds retained event bytes without repeated whole-tail concatenation", () => {
    const tail = new BoundedBuffer(32);
    for (let index = 0; index < 1000; index += 1) tail.append(`event-${index}\n`);
    assert.ok(tail.bytes <= 32);
    assert.match(tail.toString(), /event-999/);
  });

  it("retains the first runtime identity after more output than the tail budget", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dev-runtime-identity-"));
    try {
      const source = [
        'process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"thread-fixed"})+"\\n");',
        'const line=JSON.stringify({type:"system",message:"x".repeat(200)})+"\\n";',
        "for(let i=0;i<25000;i++) process.stdout.write(line);",
      ].join("");
      const result = await runStreaming(process.execPath, ["-e", source], {
        cwd: tmp,
        env: process.env,
        input: "",
        eventsPath: path.join(tmp, "events.jsonl"),
        stderrPath: path.join(tmp, "stderr.log"),
        logFile: path.join(tmp, "run.log"),
      });
      assert.match(result.extractionEvents, /thread-fixed/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("captures Codex JSONL identity and promotes the schema-constrained final message", () => {
    const fixture = createFixture("codex");
    try {
      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("codex-cli 0.144.0\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write(args.includes("resume") ? "exec resume --json --output-schema\\n" : "--sandbox --json --output-schema --output-last-message\\n"); process.exit(0); }',
        'const output = args[args.indexOf("--output-last-message") + 1];',
        `fs.writeFileSync(output, JSON.stringify({result_json:JSON.stringify(${JSON.stringify(validCompleted("codex", fixture.commit))})}));`,
        'process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-42" }) + "\\n");',
      ].join("\n");
      installStub(fixture.binDir, "codex", stub);
      runDispatch(fixture);

      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json"), "utf8"));
      assert.equal(result.status, "completed");
      assert.equal(runtime.resume_id, "thread-42");
      assert.equal(runtime.model, "gpt-5.6-sol");
      assert.equal(runtime.external_effects, false);
      assert.equal(
        require("node:crypto")
          .createHash("sha256")
          .update(fs.readFileSync(runtime.canonical_schema_file))
          .digest("hex"),
        runtime.canonical_schema_sha256
      );
      assert.match(fs.readFileSync(fixture.eventsFile, "utf8"), /thread\.started/);
      for (const file of [
        fixture.eventsFile,
        fixture.logFile,
        `${fixture.tmp}/run.stderr.log`,
        `${fixture.tmp}/run.canonical-schema.json`,
        `${fixture.tmp}/run.output-schema.json`,
      ]) {
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      }
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("freezes project policy once for the launcher and its runtime receipt", () => {
    const fixture = createFixture("codex");
    try {
      const policyFile = path.join(fixture.worktree, ".pm", "execution-policy.json");
      fs.mkdirSync(path.dirname(policyFile));
      const policy = {
        schema_version: 1,
        defaults: { codex: { model: "gpt-6-astra", effort: "ultra" } },
        workflows: {},
      };
      fs.writeFileSync(policyFile, JSON.stringify(policy));
      const callsFile = path.join(fixture.tmp, "policy-reads.json");
      const launchFile = path.join(fixture.tmp, "launch.json");
      const preload = path.join(fixture.tmp, "change-policy.js");
      fs.writeFileSync(
        preload,
        [
          'const fs = require("node:fs");',
          // Keep capability probes and launch hermetic even when the host PATH
          // starts with a Node version-manager shim that depends on HOME.
          `process.env.PATH = ${JSON.stringify([fixture.binDir, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter))};`,
          "const read = fs.readFileSync;",
          "let count = 0;",
          "fs.readFileSync = function(file, ...args) {",
          "  const bytes = read.call(this, file, ...args);",
          `  if (String(file) === ${JSON.stringify(policyFile)}) {`,
          `    fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(++count));`,
          `    fs.writeFileSync(file, ${JSON.stringify(JSON.stringify({ ...policy, defaults: { codex: { model: "gpt-5.6-sol", effort: "low" } } }))});`,
          "  }",
          "  return bytes;",
          "};",
        ].join("\n")
      );
      installStub(
        fixture.binDir,
        "codex",
        [
          `#!${process.execPath}`,
          'const fs = require("node:fs");',
          "const args = process.argv.slice(2);",
          'if (args.includes("--version")) { process.stdout.write("codex-cli 0.144.0\\n"); process.exit(0); }',
          'if (args.includes("--help")) { process.stdout.write("--sandbox --json --output-schema --output-last-message\\n"); process.exit(0); }',
          `fs.writeFileSync(${JSON.stringify(launchFile)}, JSON.stringify(args));`,
          'const output = args[args.indexOf("--output-last-message") + 1];',
          `fs.writeFileSync(output, JSON.stringify({result_json:JSON.stringify(${JSON.stringify(validCompleted("codex", fixture.commit))})}));`,
          'process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "policy-thread" }) + "\\n");',
        ].join("\n")
      );
      runDispatch(fixture, {
        HOME: fixture.tmp,
        XDG_CONFIG_HOME: path.join(fixture.tmp, "config"),
        PM_EXECUTION_POLICY_FILE: "",
        PM_DEV_MODEL: "",
        PM_DEV_EFFORT: "",
        PM_DEV_CODEX_MODEL: "",
        PM_DEV_CODEX_REASONING_EFFORT: "",
        NODE_OPTIONS: `--require=${preload}`,
      });
      const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json"), "utf8"));
      const args = JSON.parse(fs.readFileSync(launchFile, "utf8"));
      assert.equal(runtime.profile, "codex-astra");
      assert.equal(runtime.model, "gpt-6-astra");
      assert.equal(runtime.effort, "ultra");
      assert.equal(args[args.indexOf("--model") + 1], runtime.model);
      assert.ok(args.includes(`model_reasoning_effort="${runtime.effort}"`));
      assert.equal(args[args.indexOf("--sandbox") + 1], runtime.sandbox);
      assert.equal(runtime.external_effects, false);
      assert.equal(JSON.parse(fs.readFileSync(callsFile, "utf8")), 1);
      assert.equal(
        JSON.parse(fs.readFileSync(policyFile, "utf8")).defaults.codex.model,
        "gpt-5.6-sol"
      );
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  for (const directResult of [false, true])
    it(`resumes the recorded model with direct result ${directResult} after policy changes and preserves evidence on rejection`, () => {
      const fixture = createFixture("codex");
      try {
        const policyFile = path.join(fixture.worktree, ".pm", "execution-policy.json");
        fs.mkdirSync(path.dirname(policyFile));
        const setPolicy = (model) =>
          fs.writeFileSync(
            policyFile,
            JSON.stringify({
              schema_version: 1,
              defaults: { codex: { model, effort: "high" } },
              workflows: {},
            })
          );
        setPolicy("gpt-6-astra");
        const launchFile = path.join(fixture.tmp, "resume-launch.json");
        installStub(
          fixture.binDir,
          "codex",
          [
            `#!${process.execPath}`,
            'const fs = require("node:fs"); const args = process.argv.slice(2);',
            'if (args.includes("--version")) { console.log("codex-cli 0.144.0"); process.exit(0); }',
            'if (args.includes("--help")) { console.log("exec resume --sandbox --json --output-schema --output-last-message"); process.exit(0); }',
            `fs.writeFileSync(${JSON.stringify(launchFile)}, JSON.stringify(args));`,
            `fs.writeFileSync(${directResult ? JSON.stringify(fixture.resultFile) : 'args[args.indexOf("--output-last-message") + 1]'}, JSON.stringify(${JSON.stringify(directResult ? validCompleted("codex", fixture.commit) : { result_json: JSON.stringify(validCompleted("codex", fixture.commit)) })}));`,
            'console.log(JSON.stringify({ type: "thread.started", thread_id: "retained-worker" }));',
          ].join("\n")
        );
        runDispatch(fixture);
        setPolicy("gpt-5.6-sol");
        runDispatch(fixture, {}, ["--resume-id", "retained-worker"]);
        const runtimePath = path.join(fixture.tmp, "runtime.json");
        const runtime = JSON.parse(fs.readFileSync(runtimePath));
        const args = JSON.parse(fs.readFileSync(launchFile));
        assert.equal(runtime.profile, "codex-astra");
        assert.equal(args[args.indexOf("--model") + 1], "gpt-6-astra");
        const previous = fs.readFileSync(fixture.resultFile);
        assert.throws(
          () => runDispatch(fixture, {}, ["--resume-id", "wrong-worker"]),
          /recorded runtime/
        );
        assert.deepEqual(fs.readFileSync(fixture.resultFile), previous);
        assert.throws(
          () =>
            runDispatch(fixture, {}, [
              "--resume-id",
              "retained-worker",
              "--profile",
              "codex-workhorse",
            ]),
          /recorded runtime/
        );
        fs.rmSync(runtimePath);
        assert.throws(
          () => runDispatch(fixture, {}, ["--resume-id", "retained-worker"]),
          /recorded runtime/
        );
        assert.deepEqual(fs.readFileSync(fixture.resultFile), previous);
      } finally {
        fs.rmSync(fixture.tmp, { recursive: true, force: true });
      }
    });

  it("rejects invalid prompt, worktree, and ownership inputs before launching a model", () => {
    const fixture = createFixture("codex");
    try {
      const result = spawnSync(
        process.execPath,
        [
          dispatchPath,
          "--runtime",
          "codex",
          "--worktree",
          fixture.worktree,
          "--prompt-file",
          fixture.tmp,
          "--result-file",
          fixture.resultFile,
          "--log-file",
          fixture.logFile,
          "--work-unit-id",
          "unit-1",
          "--owns-json",
          '["../escape"]',
        ],
        { encoding: "utf8" }
      );
      assert.equal(result.status, 2);
      assert.match(result.stderr, /prompt file is not a regular file/);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("promotes Claude stream-json structured output without an agent file write", () => {
    const fixture = createFixture("claude");
    try {
      const stub = [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("2.1.207\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write("--json-schema stream-json --resume --permission-mode auto\\n"); process.exit(0); }',
        'process.stdout.write(JSON.stringify({ type: "system", session_id: "session-9" }) + "\\n");',
        `process.stdout.write(JSON.stringify({ type: "result", session_id: "session-9", structured_output: ${JSON.stringify(validCompleted("claude", fixture.commit))} }) + "\\n");`,
      ].join("\n");
      installStub(fixture.binDir, "claude", stub);
      runDispatch(fixture);

      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json"), "utf8"));
      assert.equal(result.status, "completed");
      assert.equal(runtime.resume_id, "session-9");
      assert.equal(runtime.model, "claude-opus-4-8");
      assert.equal(runtime.effort, "xhigh");
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("turns an agent-written malformed legacy result into a blocked result", () => {
    const fixture = createFixture("claude");
    try {
      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("2.1.207\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write("--json-schema stream-json --resume --permission-mode auto\\n"); process.exit(0); }',
        `fs.writeFileSync(${JSON.stringify(fixture.resultFile)}, '{"status":"completed"}');`,
      ].join("\n");
      installStub(fixture.binDir, "claude", stub);
      runDispatch(fixture);
      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      assert.equal(result.status, "blocked");
      assert.match(result.reason, /invalid result.*schema_version/);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });
  it("generates a provider-compatible schema and unwraps a canonically validated result", () => {
    const fixture = createFixture("codex");
    try {
      installStub(
        fixture.binDir,
        "codex",
        codexStub([
          'const schema = JSON.parse(fs.readFileSync(args[args.indexOf("--output-schema")+1], "utf8"));',
          'if (schema.type !== "object" || schema.allOf || schema.additionalProperties !== false || JSON.stringify(schema.required)!==JSON.stringify(["result_json"])) { console.error("Invalid schema: unsupported root"); process.exit(1); }',
          `fs.writeFileSync(args[args.indexOf("--output-last-message")+1], JSON.stringify({result_json: JSON.stringify(${JSON.stringify(validCompleted("codex", fixture.commit))})}));`,
        ])
      );
      runDispatch(fixture);
      const result = JSON.parse(fs.readFileSync(fixture.resultFile));
      assert.equal(result.status, "completed");
      assert.equal(result.work_unit_id, "unit-1");
      assert.equal(Object.hasOwn(result, "result_json"), false);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  for (const [code, status, expected] of [
    ["invalid_json_schema", 400, /output schema.*reject/i],
    ["invalid_request_error", 400, /request.*reject/i],
    ["rate_limit_exceeded", 429, /usage.*limit/i],
    ["insufficient_quota", 429, /usage.*limit/i],
  ]) {
    it(`classifies actual provider ${code} independently from telemetry`, () => {
      const fixture = createFixture("codex");
      try {
        const error = {
          type: "error",
          error: {
            code,
            message:
              code === "invalid_json_schema"
                ? "Invalid schema for response_format: allOf is unsupported"
                : "Request failed",
          },
          status,
        };
        installStub(
          fixture.binDir,
          "codex",
          codexStub([
            'console.error("INFO feature.plan_limits.enabled=false rate_limits_snapshot=null quota=null");',
            `console.log(JSON.stringify({type:"turn.failed",error:{message:${JSON.stringify(JSON.stringify(error))}}}));`,
            "process.exitCode=1;",
          ])
        );
        runDispatch(fixture);
        const result = JSON.parse(fs.readFileSync(fixture.resultFile));
        const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json")));
        assert.equal(result.status, "blocked");
        assert.match(result.reason, expected);
        if (status === 400) assert.doesNotMatch(result.reason, /usage.*limit|wait for reset/i);
        assert.equal(runtime.resume_id, "schema-thread");
        assert.equal(runtime.exit_status, 1);
      } finally {
        fs.rmSync(fixture.tmp, { recursive: true, force: true });
      }
    });
  }

  it("resolves generated schema and last-message paths across worker cwd changes", () => {
    const fixture = createFixture("codex");
    try {
      fixture.launchCwd = fixture.tmp;
      fixture.logFile = "relative-run.log";
      installStub(
        fixture.binDir,
        "codex",
        codexStub([
          'JSON.parse(fs.readFileSync(args[args.indexOf("--output-schema")+1],"utf8"));',
          `fs.writeFileSync(args[args.indexOf("--output-last-message")+1],JSON.stringify({result_json:JSON.stringify(${JSON.stringify(validCompleted("codex", fixture.commit))})}));`,
        ])
      );
      runDispatch(fixture);
      assert.equal(JSON.parse(fs.readFileSync(fixture.resultFile)).status, "completed");
      assert.equal(fs.existsSync(path.join(fixture.tmp, "relative-run.last-message.json")), true);
      assert.equal(
        fs.existsSync(path.join(fixture.worktree, "relative-run.last-message.json")),
        false
      );
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("retains a deterministic provider rejection despite a prior last-message artifact", () => {
    const fixture = createFixture("codex");
    try {
      fs.writeFileSync(
        path.join(fixture.tmp, "run.last-message.json"),
        JSON.stringify({ result_json: JSON.stringify(validCompleted("codex", fixture.commit)) })
      );
      installStub(
        fixture.binDir,
        "codex",
        codexStub([
          'console.log(JSON.stringify({type:"turn.failed",error:{message:JSON.stringify({error:{code:"invalid_json_schema",message:"Invalid schema"},status:400})}}));',
          "process.exitCode=1;",
        ])
      );
      runDispatch(fixture);
      const result = JSON.parse(fs.readFileSync(fixture.resultFile));
      assert.equal(result.status, "blocked");
      assert.match(result.reason, /output schema.*reject/i);
      assert.ok(fs.existsSync(path.join(fixture.tmp, "run.last-message.json")));
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("does not invent a quota blocker from telemetry when no provider error exists", () => {
    const fixture = createFixture("codex");
    try {
      installStub(
        fixture.binDir,
        "codex",
        codexStub([
          'console.error("INFO plan limits disabled; quota=unknown; rate_limit_remaining=null");',
          "process.exitCode=1;",
        ])
      );
      assert.throws(() => runDispatch(fixture), /without a valid structured result/);
      assert.equal(fs.existsSync(fixture.resultFile), false);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  for (const [label, mutate] of [
    [
      "noninteger evidence",
      (r) => {
        r.evidence[0].exit_code = "0";
      },
    ],
    [
      "failed evidence",
      (r) => {
        r.evidence[0].exit_code = 1;
      },
    ],
    [
      "wrong work unit",
      (r) => {
        r.work_unit_id = "foreign-unit";
      },
    ],
    [
      "wrong commit",
      (r) => {
        r.commit = "a".repeat(40);
      },
    ],
    [
      "unknown top-level field",
      (r) => {
        r.extra = true;
      },
    ],
    [
      "null optional reason",
      (r) => {
        r.reason = null;
      },
    ],
    [
      "mismatching blocker",
      (r) => {
        r.status = "blocked";
        r.reason = "one";
        r.blocker = { reason: "two" };
      },
    ],
  ]) {
    it(`rejects transported ${label} through canonical checks`, () => {
      const fixture = createFixture("codex");
      try {
        const result = validCompleted("codex", fixture.commit);
        mutate(result);
        installStub(
          fixture.binDir,
          "codex",
          codexStub([
            `fs.writeFileSync(args[args.indexOf("--output-last-message")+1],JSON.stringify({result_json:JSON.stringify(${JSON.stringify(result)})}));`,
          ])
        );
        assert.throws(() => runDispatch(fixture), /without a valid structured result/);
        assert.equal(fs.existsSync(fixture.resultFile), false);
        assert.match(fs.readFileSync(fixture.logFile, "utf8"), /schema-thread/);
      } finally {
        fs.rmSync(fixture.tmp, { recursive: true, force: true });
      }
    });
  }
});

function createFixture(runtime) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dev-runtime-${runtime}-`));
  const worktree = path.join(tmp, "worktree");
  const binDir = path.join(tmp, "bin");
  fs.mkdirSync(worktree);
  fs.mkdirSync(binDir);
  execFileSync("git", ["init", "-q", worktree]);
  execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
  fs.mkdirSync(path.join(worktree, "src"));
  fs.writeFileSync(path.join(worktree, "src", "unit.js"), "module.exports = 1;\n");
  execFileSync("git", ["-C", worktree, "add", "src/unit.js"]);
  execFileSync("git", ["-C", worktree, "commit", "-qm", "worker change"]);
  const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const promptFile = path.join(tmp, "prompt.txt");
  fs.writeFileSync(promptFile, "Implement the bounded unit.\n");
  const logFile = path.join(tmp, "run.log");
  return {
    runtime,
    tmp,
    worktree,
    binDir,
    promptFile,
    resultFile: path.join(tmp, "result.json"),
    logFile,
    eventsFile: path.join(tmp, "run.events.jsonl"),
    commit,
  };
}

function validCompleted(provider, commit = "abc123") {
  return {
    schema_version: 1,
    work_unit_id: "unit-1",
    status: "completed",
    summary: "green",
    commit,
    files_changed: 1,
    evidence: [{ kind: "test", exit_code: 0 }],
    blocker: null,
    runtime: { provider },
  };
}

function installStub(binDir, name, body) {
  const file = path.join(binDir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function runDispatch(fixture, environment = {}, extraArgs = []) {
  execFileSync(
    process.execPath,
    [
      dispatchPath,
      "--runtime",
      fixture.runtime,
      "--worktree",
      fixture.worktree,
      "--prompt-file",
      fixture.promptFile,
      "--result-file",
      fixture.resultFile,
      "--log-file",
      fixture.logFile,
      "--work-unit-id",
      "unit-1",
      "--owns-json",
      '["src/**"]',
      ...extraArgs,
    ],
    {
      cwd: fixture.launchCwd,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(fixture.tmp, "config"),
        PM_EXECUTION_POLICY_FILE: "",
        ...environment,
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      },
    }
  );
}

function codexStub(lines) {
  return [
    `#!${process.execPath}`,
    'const fs=require("node:fs"); const args=process.argv.slice(2);',
    'if(args.includes("--version")){console.log("codex-cli 0.167.0-alpha.4.1");process.exit(0);}',
    'if(args.includes("--help")){console.log("exec resume --sandbox --json --output-schema --output-last-message");process.exit(0);}',
    'console.log(JSON.stringify({type:"thread.started",thread_id:"schema-thread"}));',
    ...lines,
  ].join("\n");
}
