"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonl } = require("./transcript.js");
const TOKEN_FIELDS = {
  input_tokens: "input_tokens",
  output_tokens: "output_tokens",
  reasoning_tokens: "reasoning_tokens",
  cached_input_tokens: "cached_input_tokens",
  cache_creation_input_tokens: "cache_creation_input_tokens",
};
const unavailable = (reason) => ({ value: null, reason });
const measured = (value, source) => ({ value, source });
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function collectEfficiency({ rawTranscript, adapter, durationMs, captureComplete = true }) {
  const duration = nonnegative(durationMs)
    ? measured(durationMs, "adapter-progress")
    : unavailable("duration-not-reported");
  let raw;
  try {
    raw = String(rawTranscript || "")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    raw = null;
  }
  const complete = captureComplete && raw && raw.length > 0;
  const tokens = Object.fromEntries(
    Object.keys(TOKEN_FIELDS).map((key) => [key, unavailable("provider-category-not-reported")])
  );
  // Codex reports usage once per completed turn; Claude result usage is already
  // cumulative. Do not count assistant-message usage again or estimate tokens.
  const terminals = complete
    ? raw.filter((event) =>
        adapter === "codex"
          ? event.type === "turn.completed"
          : adapter === "claude" && event.type === "result"
      )
    : [];
  const usageRows =
    adapter === "claude"
      ? terminals.slice(-1).map((event) => event.usage || {})
      : terminals.map((event) => event.usage || {});
  for (const field of Object.keys(tokens)) {
    const values = usageRows.map((usage) => {
      if (field === "cached_input_tokens")
        return (
          usage.cached_input_tokens ??
          usage.cache_read_input_tokens ??
          usage.input_tokens_details?.cached_tokens
        );
      if (field === "reasoning_tokens")
        return usage.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens;
      return usage[field];
    });
    if (values.length && values.every((value) => Number.isInteger(value) && value >= 0))
      tokens[field] = measured(
        values.reduce((a, b) => a + b, 0),
        `${adapter}-terminal-usage`
      );
    else if (!complete) tokens[field] = unavailable("transcript-missing-malformed-or-incomplete");
  }
  const parsed = !complete
    ? { status: "indeterminate", events: [] }
    : adapter === "claude"
      ? {
          status: "pass",
          events: require("./adapters/claude.js")._private.normalizeClaudeStream(rawTranscript),
        }
      : adapter === "codex"
        ? parseJsonl(rawTranscript)
        : { status: "indeterminate", events: [] };
  const toolEvents = [];
  const seenIds = new Set();
  for (const event of parsed.events) {
    if (event.type !== "tool") continue;
    const rawEvent = event.raw || {};
    const id =
      rawEvent.item?.id || rawEvent.tool_use_id || (rawEvent.type === "tool_use" && rawEvent.id);
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    toolEvents.push(event);
  }
  const observable = parsed.status === "pass";
  const counter = (value) =>
    observable
      ? measured(value, "normalized-transcript-observed-events")
      : unavailable("transcript-missing-malformed-or-incomplete");
  const counts = new Map();
  let repeated = 0;
  let requests = 0;
  for (const event of toolEvents) {
    if (/request_user_input|askuserquestion/i.test(event.name)) requests += 1;
    // Exact signatures are observable repeats, not proof that work was wasteful.
    if (
      event.tool_class === "read-file" ||
      (event.tool_class === "run-command" &&
        /(?:\b(?:cat|rg|test|pytest)\b|npm (?:run )?(?:test|check|validate))/i.test(event.command))
    ) {
      const signature = JSON.stringify([event.name, event.command]);
      if (counts.has(signature)) repeated += 1;
      counts.set(signature, true);
    }
  }
  const billed =
    adapter === "claude" && terminals.length === 1 && nonnegative(terminals[0].total_cost_usd)
      ? measured(terminals[0].total_cost_usd, "claude-result.total_cost_usd")
      : unavailable("provider-billed-cost-not-reported");
  return {
    schema_version: 1,
    duration_ms: duration,
    tokens,
    observed_tool_calls: counter(toolEvents.length),
    observed_input_requests: counter(requests),
    exact_repeated_reads_or_checks: counter(repeated),
    unnecessary_questions: unavailable("requires-independent-semantic-annotation"),
    human_acceptance: unavailable("not-observed-by-harness"),
    billed_cost_usd: billed,
  };
}

function captureEfficiency(runDir, adapter, progress) {
  const transcript = path.join(runDir, "metadata", "transcript.raw.jsonl");
  return collectEfficiency({
    rawTranscript: fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : null,
    adapter,
    durationMs: progress.duration_ms,
    captureComplete:
      !progress.stdoutOverflow && !progress.captureOverflow && progress.status === "complete",
  });
}

function summarizeEfficiency(candidates) {
  const successful = candidates.filter((item) => item.behavioral.status === "pass");
  const sum = (items, accessor) => {
    const values = items.map(accessor);
    return values.length && values.every(nonnegative) ? values.reduce((a, b) => a + b, 0) : null;
  };
  const totalDuration = sum(candidates, (item) => item.runtime.duration_ms);
  const totalCost = sum(candidates, (item) => item.runtime.efficiency?.billed_cost_usd?.value);
  const perSuccess = (value, absent) =>
    successful.length === 0
      ? unavailable("no-behaviorally-successful-outcomes")
      : value === null
        ? unavailable(absent)
        : measured(value / successful.length, "all-attempts-divided-by-behavioral-passes");
  const metricSummary = (accessor) => {
    const values = candidates
      .map(accessor)
      .filter(nonnegative)
      .sort((a, b) => a - b);
    const quantile = (p) =>
      values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
    return {
      observed_runs: values.length,
      unavailable_runs: candidates.length - values.length,
      median: quantile(0.5),
      p90: quantile(0.9),
      maximum: values.length ? values[values.length - 1] : null,
      reason: values.length ? null : "measurement-not-available",
    };
  };
  return {
    attempts: candidates.length,
    behavioral_successes: successful.length,
    failures: candidates.filter((item) => item.behavioral.status === "fail").length,
    uncertain: candidates.filter((item) => !["pass", "fail"].includes(item.behavioral.status))
      .length,
    success_definition:
      "behavioral-pass; independent quality scores and human acceptance are separate",
    elapsed_ms_per_behavioral_success: perSuccess(totalDuration, "duration-unavailable"),
    billed_usd_per_behavioral_success: perSuccess(
      totalCost,
      "billed-cost-unavailable-for-some-attempts"
    ),
    cost_per_human_accepted_outcome: unavailable("human-acceptance-not-observed"),
    successful_duration_ms: metricSummary((item) =>
      item.behavioral.status === "pass" ? item.runtime.duration_ms : null
    ),
    tokens: Object.fromEntries(
      Object.keys(TOKEN_FIELDS).map((field) => [
        field,
        metricSummary((item) => item.runtime.efficiency?.tokens?.[field]?.value),
      ])
    ),
    observed_tool_calls: metricSummary(
      (item) => item.runtime.efficiency?.observed_tool_calls?.value
    ),
    observed_input_requests: metricSummary(
      (item) => item.runtime.efficiency?.observed_input_requests?.value
    ),
    exact_repeated_reads_or_checks: metricSummary(
      (item) => item.runtime.efficiency?.exact_repeated_reads_or_checks?.value
    ),
  };
}
module.exports = { collectEfficiency, captureEfficiency, summarizeEfficiency };
