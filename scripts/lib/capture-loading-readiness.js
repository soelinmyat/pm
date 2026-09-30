"use strict";

function isReadOnlyDataRequest(request) {
  return (
    request &&
    ["GET", "HEAD"].includes(request.method) &&
    ["Fetch", "XHR"].includes(request.resource_type)
  );
}

// Loading may retain data reads, but never unfinished documents/assets, writes,
// unknown requests or sockets. Callers still enforce quiet time and origin policy.
function pendingRequestsReady(state, pendingIds, records) {
  return (
    pendingIds.size === 0 ||
    (state === "loading" && [...pendingIds].every((id) => isReadOnlyDataRequest(records.get(id))))
  );
}

function validatePendingAtCapture(pending, requests, state) {
  if (pending === undefined) return; // Existing settled capture bundles remain valid.
  if (
    !Array.isArray(pending) ||
    pending.length > 2000 ||
    pending.some(
      (id, index) => !Number.isSafeInteger(id) || id <= 0 || (index && id <= pending[index - 1])
    )
  )
    throw new Error("pending_at_capture must contain bounded, sorted unique request sequences");
  if (pending.length && state !== "loading")
    throw new Error("pending_at_capture is only permitted for loading captures");
  for (const id of pending) {
    if (!isReadOnlyDataRequest(requests.find((request) => request.sequence === id)))
      throw new Error("pending_at_capture must reference observed read-only Fetch/XHR requests");
  }
}

module.exports = { pendingRequestsReady, validatePendingAtCapture };
