#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  aggregateQualityResults,
  buildBlindPacket,
  buildScorecard,
  compareQualityScorecards,
  extractCasePrompt,
  loadQualityCase,
  validateCandidate,
  validatePrivateKey,
  validateQualityScorecard,
  validateQualitySuite,
  validateRubric,
} = require("./quality.js");

function main(argv) {
  try {
    const { command, options } = parseArgs(argv);
    if (command === "capture") captureCandidate(options);
    else if (command === "packet") createPacket(options);
    else if (command === "score") createScorecard(options);
    else throw new Error(usage());
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const command = argv[0];
  if (!["capture", "packet", "score"].includes(command)) throw new Error(usage());
  const options = { artifacts: [], judgments: [], packetPaths: [] };
  const valueFlags = new Map([
    ["--root", "rootDir"],
    ["--suite", "suitePath"],
    ["--candidates", "candidatesPath"],
    ["--case", "caseId"],
    ["--key", "keyPath"],
    ["--json", "jsonPath"],
    ["--markdown", "markdownPath"],
    ["--baseline", "baselinePath"],
    ["--run", "runDir"],
    ["--profile", "profileId"],
    ["--repeat", "repeat"],
    ["--out", "outPath"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--artifact") {
      options.artifacts.push(requireValue(argv, ++index, flag));
      continue;
    }
    if (flag === "--judgment") {
      options.judgments.push(requireValue(argv, ++index, flag));
      continue;
    }
    if (flag === "--packet") {
      options.packetPaths.push(requireValue(argv, ++index, flag));
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key) throw new Error(`unknown argument ${flag}`);
    options[key] = requireValue(argv, ++index, flag);
  }
  options.rootDir = path.resolve(options.rootDir || process.cwd());
  options.suitePath = path.resolve(
    options.rootDir,
    options.suitePath || "evals/quality/suite.json"
  );
  if (command === "capture") {
    for (const field of ["runDir", "profileId", "caseId", "repeat", "outPath"]) {
      if (!options[field]) throw new Error(`capture requires --${toFlag(field)}`);
    }
    if (options.artifacts.length === 0) throw new Error("capture requires --artifact");
    options.runDir = path.resolve(options.rootDir, options.runDir);
    options.outPath = path.resolve(options.rootDir, options.outPath);
    options.repeat = Number(options.repeat);
    return { command, options };
  }
  for (const field of ["candidatesPath", "keyPath"]) {
    if (!options[field]) throw new Error(`${command} requires --${toFlag(field)}`);
    options[field] = path.resolve(options.rootDir, options[field]);
  }
  if (options.packetPaths.length === 0) throw new Error(`${command} requires --packet`);
  options.packetPaths = options.packetPaths.map((value) => path.resolve(options.rootDir, value));
  options.packetPath = options.packetPaths[0];
  if (command === "packet" && options.packetPaths.length !== 1) {
    throw new Error("packet creation accepts exactly one --packet output path");
  }
  if (command === "packet" && !options.caseId) throw new Error("packet requires --case");
  if (command === "score") {
    if (options.judgments.length === 0) throw new Error("score requires --judgment");
    if (options.packetPaths.length !== options.judgments.length) {
      throw new Error("score requires one ordered --packet for every --judgment");
    }
    if (!options.jsonPath && !options.markdownPath) {
      throw new Error("score requires --json and/or --markdown");
    }
    options.judgments = options.judgments.map((value) => path.resolve(options.rootDir, value));
    if (options.jsonPath) options.jsonPath = path.resolve(options.rootDir, options.jsonPath);
    if (options.markdownPath)
      options.markdownPath = path.resolve(options.rootDir, options.markdownPath);
    if (options.baselinePath)
      options.baselinePath = path.resolve(options.rootDir, options.baselinePath);
  }
  return { command, options };
}

function captureCandidate(options) {
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  if (options.artifacts.length > 4)
    throw new Error("capture supports at most four judge artifacts");
  const suite = readJson(options.suitePath);
  assertValid(validateQualitySuite(suite), "quality suite");
  const profile = suite.profiles.find((item) => item.id === options.profileId);
  if (!profile) throw new Error(`unknown quality profile ${options.profileId}`);
  const found = findCase(suite, options.caseId);
  const verdict = readJson(path.join(options.runDir, "verdict.json"));
  if (verdict.agent !== profile.adapter) {
    throw new Error(
      `run adapter ${verdict.agent} does not match profile adapter ${profile.adapter}`
    );
  }
  const profileIdentity = readJson(
    path.join(options.runDir, "metadata", "quality_profile_identity.json")
  );
  for (const field of ["id", "adapter", "model", "effort"]) {
    if (profileIdentity[field] !== profile[field]) {
      throw new Error(`run quality profile ${field} does not match ${options.profileId}`);
    }
  }
  const commandIdentity = readJson(
    path.join(options.runDir, "metadata", `${profile.adapter}_command.json`)
  );
  assertCommandProfile(commandIdentity.argv, profile);
  const source = readJson(path.join(options.runDir, "metadata", "source_identity.json"));
  const scenarioIdentity = readJson(
    path.join(options.runDir, "metadata", "scenario_identity.json")
  );
  const qualityIdentity = readJson(
    path.join(options.runDir, "metadata", "quality_case_identity.json")
  );
  const currentCase = loadQualityCase(options.rootDir, options.caseId);
  if (
    qualityIdentity.id !== currentCase.id ||
    qualityIdentity.workflow !== currentCase.workflow ||
    qualityIdentity.type !== currentCase.type ||
    qualityIdentity.prompt_hash !== currentCase.prompt_hash ||
    qualityIdentity.base_scenario !== currentCase.scenario_ref ||
    qualityIdentity.scenario_ref !== currentCase.scenario_ref ||
    qualityIdentity.scenario_contract_hash !== currentCase.scenario_contract_hash
  ) {
    throw new Error(`run quality-case identity does not match ${options.caseId}`);
  }
  const plugin = readJson(path.join(options.runDir, "runtime", "pm", "plugin.config.json"));
  const progress = readJson(
    path.join(options.runDir, "metadata", `${verdict.agent}_progress.json`)
  );
  const realRunDir = fs.realpathSync(options.runDir);
  let artifactBytes = 0;
  const artifacts = options.artifacts.map((artifactRef) => {
    const artifactPath = path.resolve(options.runDir, artifactRef);
    if (!inside(options.runDir, artifactPath))
      throw new Error(`artifact escapes run directory: ${artifactRef}`);
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`artifact must be a regular file: ${artifactRef}`);
    const realArtifactPath = fs.realpathSync(artifactPath);
    if (!inside(realRunDir, realArtifactPath)) {
      throw new Error(`artifact resolves outside run directory: ${artifactRef}`);
    }
    artifactBytes += stat.size;
    if (artifactBytes > 20 * 1024) {
      throw new Error("candidate judge artifacts exceed the 20 KiB combined budget");
    }
    const content = fs.readFileSync(artifactPath, "utf8");
    return {
      name: path.basename(artifactPath),
      media_type: mediaType(artifactPath),
      sha256: `sha256:${digest(content)}`,
      content,
    };
  });
  const candidate = {
    schema_version: 1,
    workflow: found.workflow.id,
    case_id: found.item.id,
    case_type: found.item.type,
    release: plugin.version,
    quality_case_hash: qualityIdentity.prompt_hash,
    source_hash: source.runtime_hash,
    behavioral: {
      status: verdict.status,
      artifact_ref: verdict.artifact_ref,
      scenario_hash: scenarioIdentity.scenario_hash,
    },
    profile: { ...profile },
    runtime: { duration_ms: progress.duration_ms, status: progress.status },
    repeat: options.repeat,
    artifacts,
  };
  assertValid(validateCandidate(candidate), "captured candidate");
  const ledger = fs.existsSync(options.outPath)
    ? readCandidateLedger(options.outPath)
    : { schema_version: 1, candidates: [] };
  if (
    ledger.candidates.some(
      (item) =>
        item.case_id === candidate.case_id &&
        item.profile.id === candidate.profile.id &&
        item.repeat === candidate.repeat
    )
  ) {
    throw new Error(
      `candidate already exists for ${candidate.case_id}/${candidate.profile.id}/repeat-${candidate.repeat}`
    );
  }
  ledger.candidates.push(candidate);
  writeJson(options.outPath, ledger, 0o600);
  process.stdout.write(
    JSON.stringify({ candidates: options.outPath, count: ledger.candidates.length }) + "\n"
  );
}

function assertCommandProfile(argv, profile) {
  if (!Array.isArray(argv)) throw new Error("run command metadata is missing argv");
  const modelFlag = profile.adapter === "codex" ? "-m" : "--model";
  const effortFlag = profile.adapter === "codex" ? "-c" : "--effort";
  const modelIndex = argv.indexOf(modelFlag);
  const effortIndex = argv.indexOf(effortFlag);
  const expectedEffort =
    profile.adapter === "codex"
      ? `model_reasoning_effort=${JSON.stringify(profile.effort)}`
      : profile.effort;
  if (modelIndex < 0 || argv[modelIndex + 1] !== profile.model) {
    throw new Error(`run command does not select profile model ${profile.model}`);
  }
  if (effortIndex < 0 || argv[effortIndex + 1] !== expectedEffort) {
    throw new Error(`run command does not select profile effort ${profile.effort}`);
  }
}

function createPacket(options) {
  const salt = process.env.PM_EVAL_BLIND_SALT;
  if (!salt) throw new Error("PM_EVAL_BLIND_SALT is required for packet creation");
  const suite = readJson(options.suitePath);
  assertValid(validateQualitySuite(suite), "quality suite");
  const rubric = readJson(path.resolve(options.rootDir, suite.rubric_ref));
  assertValid(validateRubric(rubric), "quality rubric");
  const ledger = readCandidateLedger(options.candidatesPath);
  const found = findCase(suite, options.caseId);
  const promptText = fs.readFileSync(path.resolve(options.rootDir, found.item.prompt_ref), "utf8");
  const prompt = extractCasePrompt(promptText, found.item.type);
  if (!prompt) throw new Error(`prompt section ## ${found.item.type} is empty or missing`);
  const selected = ledger.candidates.filter((item) => item.case_id === options.caseId);
  if (selected.length === 0) throw new Error(`no candidates found for case ${options.caseId}`);
  const result = buildBlindPacket({
    candidates: selected,
    rubric,
    scenario: { workflow: found.workflow.id, case_id: found.item.id, prompt },
    salt,
  });
  const packetFiles = result.judgePackets.map((packet, index) => {
    const packetPath =
      index === 0 ? options.packetPath : numberedPacketPath(options.packetPath, index + 1);
    writeJson(packetPath, packet);
    return packetPath;
  });
  writeJson(options.keyPath, result.key, 0o600);
  process.stdout.write(
    JSON.stringify({
      packet: options.packetPath,
      judge_packets: packetFiles,
      private_key: options.keyPath,
      eligible: result.packet.candidates.length,
      excluded: result.excluded.length,
    }) + "\n"
  );
}

function numberedPacketPath(filePath, number) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.judge-${number}${parsed.ext || ".json"}`);
}

function createScorecard(options) {
  const suite = readJson(options.suitePath);
  assertValid(validateQualitySuite(suite), "quality suite");
  const rubric = readJson(path.resolve(options.rootDir, suite.rubric_ref));
  assertValid(validateRubric(rubric), "quality rubric");
  const ledger = readCandidateLedger(options.candidatesPath);
  const packets = options.packetPaths.map(readJson);
  const packet = packets[0];
  const key = readJson(options.keyPath);
  const candidates = ledger.candidates.filter((item) => item.case_id === packet.scenario.case_id);
  for (const [index, view] of packets.entries()) {
    assertValid(validatePrivateKey(key, view, candidates), `private key view ${index + 1}`);
  }
  const judgments = options.judgments.map(readJson);
  const aggregate = aggregateQualityResults({
    candidates,
    packet,
    packets,
    key,
    rubric,
    judgments,
    minimumRepeats: suite.minimum_repeats,
  });
  const scorecard = buildScorecard({ candidates, aggregate });
  scorecard.packet_id = packet.packet_id;
  scorecard.workflow = packet.scenario.workflow;
  scorecard.case_id = packet.scenario.case_id;
  scorecard.releases = [...new Set(candidates.map((item) => item.release))].sort();
  scorecard.judges = judgments.map((item) => item.judge);
  scorecard.disagreement = aggregate.disagreement.map((item) => {
    const mapping = key.candidates[item.candidate];
    return {
      profile_id: mapping.profile_id,
      repeat: mapping.repeat,
      dimension: item.dimension,
      scores: item.scores,
      range: item.range,
      evaluations: item.evaluations,
    };
  });
  const identityCandidate = candidates.find((item) => item.behavioral.status === "pass");
  const found = findCase(suite, packet.scenario.case_id);
  scorecard.evaluation_identity = {
    source_hash: identityCandidate ? identityCandidate.source_hash : null,
    scenario_hash: identityCandidate ? identityCandidate.behavioral.scenario_hash : null,
    quality_case_hash: identityCandidate ? identityCandidate.quality_case_hash : null,
    rubric_hash: `sha256:${digest(JSON.stringify(rubric))}`,
    evaluation_design_hash: `sha256:${digest(
      JSON.stringify({
        minimum_repeats: suite.minimum_repeats,
        profiles: suite.profiles,
        case: found.item,
        rubric,
      })
    )}`,
  };
  if (options.baselinePath) {
    scorecard.comparison = compareQualityScorecards(readJson(options.baselinePath), scorecard);
  }
  assertValid(validateQualityScorecard(scorecard, suite, rubric), "scorecard");
  if (options.jsonPath) writeJson(options.jsonPath, scorecard);
  if (options.markdownPath) writeText(options.markdownPath, formatScorecard(scorecard));
  process.stdout.write(
    JSON.stringify({
      status: scorecard.overall_status,
      json: options.jsonPath || null,
      markdown: options.markdownPath || null,
    }) + "\n"
  );
}

function readCandidateLedger(filePath) {
  const ledger = readJson(filePath);
  if (!ledger || ledger.schema_version !== 1 || !Array.isArray(ledger.candidates)) {
    throw new Error("candidate ledger must have schema_version 1 and a candidates array");
  }
  for (const [index, item] of ledger.candidates.entries()) {
    assertValid(validateCandidate(item), `candidate ${index}`);
  }
  return ledger;
}

function findCase(suite, caseId) {
  const matches = [];
  for (const workflow of suite.workflows) {
    for (const item of workflow.cases) {
      if (item.id === caseId) matches.push({ workflow, item });
    }
  }
  if (matches.length !== 1) throw new Error(`quality case ${caseId} was not found exactly once`);
  return matches[0];
}

function formatScorecard(scorecard) {
  const lines = [
    "# PM Quality Scorecard",
    "",
    `Overall status: **${scorecard.overall_status}**`,
    "",
    "## Behavioral eligibility",
    "",
    `- Total candidates: ${scorecard.total_candidates}`,
    `- Eligible deterministic passes: ${scorecard.eligible_candidates}`,
    `- Deterministic failures: ${scorecard.behavioral_failures}`,
    `- Skipped or indeterminate: ${scorecard.behavioral_uncertain}`,
    "",
    "## Quality results",
    "",
    `Quality winner: ${scorecard.quality_winner || "none"}`,
    `Observed leader: ${scorecard.observed_leader || "none"}`,
    `Adjudication required: ${scorecard.adjudication_required ? "yes" : "no"}`,
    "",
  ];
  for (const [id, profile] of Object.entries(scorecard.profiles || {}).sort()) {
    lines.push(`### ${id}`, "");
    lines.push(`- Mean: ${formatNumber(profile.mean)}`);
    lines.push(`- Median: ${formatNumber(profile.median)}`);
    lines.push(`- Range: ${formatNumber(profile.variance && profile.variance.range)}`);
    lines.push(
      `- Standard deviation: ${formatNumber(profile.variance && profile.variance.standard_deviation)}`
    );
    lines.push(`- Repeats: ${profile.repeats}`);
    lines.push(`- Mean runtime: ${formatDuration(profile.latency && profile.latency.mean_ms)}`);
    lines.push(
      `- Variance claimable: ${profile.variance && profile.variance.claimable ? "yes" : "no"}`
    );
    for (const [dimension, result] of Object.entries(profile.dimensions || {}).sort()) {
      lines.push(
        `- ${dimension}: ${formatNumber(result.mean)} (coverage ${formatPercent(result.coverage)})`
      );
    }
    lines.push("");
  }
  lines.push("## Judge agreement", "");
  if (scorecard.judge_agreement) {
    lines.push(
      `- Exact agreement: ${formatPercent(scorecard.judge_agreement.exact_agreement_rate)}`
    );
    lines.push(
      `- Within-one agreement: ${formatPercent(scorecard.judge_agreement.within_one_agreement_rate)}`
    );
    lines.push(
      `- Adjudication-pass rate: ${formatPercent(scorecard.judge_agreement.adjudication_pass_rate)}`
    );
    lines.push(`- Flagged candidate-dimensions: ${scorecard.judge_agreement.flagged_dimensions}`);
  } else {
    lines.push("- Agreement rate: n/a");
  }
  lines.push("");
  if ((scorecard.disagreement || []).length > 0) {
    lines.push("### Adjudication queue", "");
    lines.push(
      "| Profile | Repeat | Dimension | Scores | Range | Evidence |",
      "|---|---:|---|---|---:|---|"
    );
    for (const item of scorecard.disagreement) {
      lines.push(
        `| ${item.profile_id} | ${item.repeat} | ${item.dimension} | ${item.scores.join(", ")} | ${formatNumber(item.range)} | ${formatAdjudicationEvidence(item.evaluations)} |`
      );
    }
    lines.push("");
  }
  lines.push("## Pairwise", "");
  lines.push(`- Comparisons: ${scorecard.pairwise.total}`);
  lines.push(`- Ties: ${scorecard.pairwise.ties}`);
  for (const [id, wins] of Object.entries(scorecard.pairwise.wins || {}).sort()) {
    lines.push(`- ${id} wins: ${wins}`);
  }
  lines.push("", "## Limitations", "");
  lines.push(
    "Quality scores apply only to candidates that passed deterministic workflow checks. " +
      "A scorecard with fewer than the configured repeat count does not support a variance claim."
  );
  if (scorecard.comparison) {
    lines.push("", "## Baseline comparison", "");
    if (!scorecard.comparison.comparable) {
      lines.push(`Not comparable: ${scorecard.comparison.reason}.`);
    } else {
      for (const [id, result] of Object.entries(scorecard.comparison.profiles || {}).sort()) {
        lines.push(`- ${id} mean delta: ${formatSigned(result.mean_delta)}`);
      }
      lines.push(`- Winner changed: ${scorecard.comparison.winner_changed ? "yes" : "no"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAdjudicationEvidence(evaluations) {
  return (evaluations || [])
    .map(
      (item) =>
        `${escapeTable(item.judge)} (${item.score}): ${escapeTable(item.evidence)} — ${escapeTable(item.summary)}`
    )
    .join("<br>");
}

function escapeTable(value) {
  return String(value || "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ");
}

function usage() {
  return [
    "Usage:",
    "  quality-cli.js capture --run DIR --profile ID --case ID --repeat N --artifact FILE --out FILE",
    "  quality-cli.js packet --candidates FILE --case ID --packet FILE --key FILE",
    "  quality-cli.js score --candidates FILE --packet VIEW --judgment RESULT [--packet VIEW --judgment RESULT ...] --key FILE --json FILE [--markdown FILE]",
  ].join("\n");
}

function requireValue(argv, index, flag) {
  if (!argv[index] || argv[index].startsWith("--")) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function toFlag(field) {
  return field.replace(/Path$/, "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, mode) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function writeText(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, mode === undefined ? undefined : { mode });
  if (mode !== undefined) fs.chmodSync(filePath, mode);
}

function assertValid(result, label) {
  if (!result.ok) throw new Error(`${label} invalid: ${result.issues.join("; ")}`);
}

function formatNumber(value) {
  return typeof value === "number" ? value.toFixed(3).replace(/\.000$/, "") : "n/a";
}

function formatPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(0)}%` : "n/a";
}

function formatSigned(value) {
  if (typeof value !== "number") return "n/a";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatDuration(value) {
  if (typeof value !== "number") return "n/a";
  return `${(value / 1000).toFixed(1)}s`;
}

function mediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md") return "text/markdown";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".json") return "application/json";
  if ([".txt", ".log", ".csv"].includes(extension)) return "text/plain";
  throw new Error(`unsupported text artifact extension ${extension || "(none)"}`);
}

function inside(rootDir, candidatePath) {
  const relative = path.relative(path.resolve(rootDir), candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { extractCasePrompt, formatScorecard, main, parseArgs };
