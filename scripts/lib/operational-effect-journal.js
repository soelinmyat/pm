"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { writeJsonAtomic } = require("./atomic-file.js");
const { bindEffectReceipt } = require("./workflow-runtime/effect-receipt.js");
const { isObject, stableStringify } = require("./workflow-runtime/records.js");

const SCHEMA_VERSION = 1;
const EFFECT_ID = /^effect_[a-f0-9]{64}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 25;

function requireObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function effectIdentity(input) {
  return {
    workflow: requireText(input.workflow, "effect workflow"),
    effect: requireText(input.effect, "effect name"),
    authority_action: requireText(input.authorityAction, "effect authority action"),
    target: structuredClone(input.target),
    intent: structuredClone(input.intent),
  };
}

function createEffectPlan(input) {
  requireObject(input, "effect input");
  requireObject(input.target, "effect target");
  requireObject(input.intent, "effect intent");
  requireObject(input.precondition, "effect precondition");
  requireObject(input.recovery, "effect recovery");
  requireText(input.recovery.code, "effect recovery code");
  requireText(input.recovery.command, "effect recovery command");
  const identity = effectIdentity(input);
  const digest = crypto.createHash("sha256").update(stableStringify(identity)).digest("hex");
  return {
    effect_id: `effect_${digest}`,
    idempotency_key: `sha256:${digest}`,
    ...identity,
    precondition: structuredClone(input.precondition),
  };
}

function effectJournalPath(pmStateDir, effectId) {
  requireText(pmStateDir, "PM state directory");
  if (!EFFECT_ID.test(effectId)) throw new TypeError("invalid operational effect id");
  return path.join(path.resolve(pmStateDir), "effects", `${effectId}.json`);
}

function readJournal(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("operational effect journal must be a regular file");
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  requireObject(value, "operational effect journal");
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new Error("unsupported operational effect journal schema");
  }
  if (!EFFECT_ID.test(value.effect_id || "")) throw new Error("invalid journal effect id");
  if (!Array.isArray(value.attempts)) throw new Error("effect journal attempts must be an array");
  return value;
}

function persist(filePath, value) {
  value.updated_at = new Date().toISOString();
  writeJsonAtomic(filePath, value, { fileMode: 0o600, directoryMode: 0o700 });
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLockOwner(lockPath) {
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return isObject(owner) ? owner : null;
  } catch {
    return null;
  }
}

function lockCanBeReclaimed(lockPath, owner) {
  if (owner && Number.isSafeInteger(Number(owner.pid))) {
    return !processIsAlive(Number(owner.pid));
  }
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return Date.now() - stat.mtimeMs > 30000;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function acquireEffectLock(journalPath, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS) {
  const lockPath = `${journalPath}.lock`;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`
      );
      return { fd, lockPath };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLockOwner(lockPath);
      if (lockCanBeReclaimed(lockPath, owner)) {
        try {
          fs.unlinkSync(lockPath);
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }
}

function releaseEffectLock(lock) {
  if (!lock) return;
  let failure = null;
  try {
    fs.closeSync(lock.fd);
  } catch (error) {
    failure = error;
  }
  try {
    fs.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT" && !failure) failure = error;
  }
  if (failure) throw failure;
}

function observationReceipt(plan, observation, attempt, authorityActions, observedAt) {
  if (!isObject(observation) || observation.state !== "verified") return null;
  requireObject(observation.receipt, "verified effect observation receipt");
  return bindEffectReceipt({
    effect: plan.effect,
    target: plan.target,
    authorityActions,
    attempt,
    receipt: observation.receipt,
    observation: { target: plan.target, receipt: observation.receipt },
    observedAt,
  });
}

function publicResult(journal, journalPath, extra = {}) {
  return {
    effect_id: journal.effect_id,
    state: journal.state,
    journal_path: journalPath,
    verified_receipt: journal.verified_receipt,
    recovery: journal.recovery,
    ...extra,
  };
}

function finishVerified(journal, plan, observation, authorityActions, journalPath, options = {}) {
  const attemptNumber = options.attempt || journal.attempts.length || 1;
  const receipt = observationReceipt(
    plan,
    observation,
    attemptNumber,
    authorityActions,
    options.observedAt
  );
  journal.state = "verified";
  journal.precondition = structuredClone(plan.precondition);
  journal.verified_receipt = receipt;
  const attempt = journal.attempts.find((item) => item.attempt === attemptNumber);
  if (attempt) {
    attempt.state = "verified";
    attempt.completed_at = options.observedAt || new Date().toISOString();
    attempt.error = null;
  }
  persist(journalPath, journal);
  return publicResult(journal, journalPath, options.resultFlags);
}

function ambiguousResult(journal, observation, journalPath) {
  journal.state = "ambiguous";
  journal.last_observation = {
    state: "ambiguous",
    reason: String(observation?.reason || "target state could not be verified").slice(0, 1000),
  };
  persist(journalPath, journal);
  return publicResult(journal, journalPath);
}

function newJournal(plan, recovery, now) {
  return {
    schema_version: SCHEMA_VERSION,
    ...structuredClone(plan),
    state: "planned",
    attempts: [],
    verified_receipt: null,
    recovery: structuredClone(recovery),
    last_observation: null,
    created_at: now,
    updated_at: now,
  };
}

function runClaimedOperationalEffect(input, plan, journalPath, authorityActions) {
  const now = input.now || new Date().toISOString();
  let journal = readJournal(journalPath);
  if (journal && journal.effect_id !== plan.effect_id) {
    throw new Error("operational effect journal identity mismatch");
  }
  if (!journal) journal = newJournal(plan, input.recovery, now);
  journal.precondition = structuredClone(plan.precondition);

  if (journal.state === "verified") {
    const observation = input.observe({ plan, journal, recovery: true });
    if (observation?.state === "verified") {
      return finishVerified(journal, plan, observation, authorityActions, journalPath, {
        attempt: journal.verified_receipt?.attempt || journal.attempts.length || 1,
        resultFlags: { replayed: true },
      });
    }
    journal.state = "planned";
    journal.verified_receipt = null;
  }

  if (journal.state === "attempting" || journal.state === "ambiguous") {
    const observation = input.observe({ plan, journal, recovery: true });
    if (observation?.state === "verified") {
      return finishVerified(journal, plan, observation, authorityActions, journalPath, {
        attempt: journal.attempts.at(-1)?.attempt || 1,
        resultFlags: { recovered: true },
      });
    }
    if (observation?.state !== "absent" || observation.safe_to_retry !== true) {
      return ambiguousResult(journal, observation, journalPath);
    }
  }

  const attemptNumber = journal.attempts.length + 1;
  journal.state = "attempting";
  journal.attempts.push({
    attempt: attemptNumber,
    state: "attempting",
    started_at: now,
    completed_at: null,
    error: null,
  });
  persist(journalPath, journal);

  let mutation;
  try {
    mutation = input.mutate({ plan, journal, attempt: attemptNumber });
  } catch (error) {
    const observation = input.observe({ plan, journal, error, recovery: true });
    if (observation?.state === "verified") {
      return finishVerified(journal, plan, observation, authorityActions, journalPath, {
        attempt: attemptNumber,
        resultFlags: { recovered: true },
      });
    }
    const attempt = journal.attempts.at(-1);
    attempt.state = "ambiguous";
    attempt.completed_at = new Date().toISOString();
    attempt.error = String(error?.message || error).slice(0, 1000);
    return ambiguousResult(journal, observation || { reason: attempt.error }, journalPath);
  }

  if (mutation?.blocked === true) {
    const attempt = journal.attempts.at(-1);
    attempt.state = "blocked";
    attempt.completed_at = new Date().toISOString();
    attempt.error = String(mutation.reason || "effect precondition blocked mutation").slice(
      0,
      1000
    );
    journal.state = "blocked";
    if (mutation.recovery) journal.recovery = structuredClone(mutation.recovery);
    persist(journalPath, journal);
    return publicResult(journal, journalPath);
  }

  const observation = input.observe({ plan, journal, mutation, recovery: false });
  if (observation?.state !== "verified") {
    const attempt = journal.attempts.at(-1);
    attempt.state = observation?.state === "absent" ? "blocked" : "ambiguous";
    attempt.completed_at = new Date().toISOString();
    attempt.error = String(observation?.reason || "effect outcome was not verified").slice(0, 1000);
    journal.state = attempt.state;
    if (observation?.recovery) journal.recovery = structuredClone(observation.recovery);
    persist(journalPath, journal);
    return publicResult(journal, journalPath);
  }
  if (
    isObject(mutation?.receipt) &&
    stableStringify(mutation.receipt) !== stableStringify(observation.receipt)
  ) {
    throw new Error("effect mutation receipt does not match observed target state");
  }
  return finishVerified(journal, plan, observation, authorityActions, journalPath, {
    attempt: attemptNumber,
  });
}

function runOperationalEffect(input) {
  const plan = createEffectPlan(input);
  const journalPath = effectJournalPath(input.pmStateDir, plan.effect_id);
  const authorityActions = Array.isArray(input.authorityActions)
    ? [...new Set(input.authorityActions)]
    : [];
  if (!authorityActions.includes(plan.authority_action)) {
    return {
      effect_id: plan.effect_id,
      state: "blocked",
      journal_path: journalPath,
      verified_receipt: null,
      recovery: {
        code: "authority-required",
        command: input.recovery.command,
        reason: `Explicit ${plan.authority_action} authority is required.`,
      },
    };
  }
  if (typeof input.observe !== "function" || typeof input.mutate !== "function") {
    throw new TypeError("operational effect requires observe and mutate callbacks");
  }

  const lock = acquireEffectLock(journalPath, input.lockTimeoutMs);
  if (!lock) {
    const journal = readJournal(journalPath);
    return {
      effect_id: plan.effect_id,
      state: "blocked",
      journal_path: journalPath,
      verified_receipt: journal?.verified_receipt || null,
      recovery: {
        code: "effect-in-progress",
        command: input.recovery.command,
        reason: "Another process still owns this effect. Retry after that attempt finishes.",
      },
    };
  }
  try {
    return runClaimedOperationalEffect(input, plan, journalPath, authorityActions);
  } finally {
    releaseEffectLock(lock);
  }
}

module.exports = {
  SCHEMA_VERSION,
  acquireEffectLock,
  createEffectPlan,
  effectJournalPath,
  readJournal,
  runOperationalEffect,
};
