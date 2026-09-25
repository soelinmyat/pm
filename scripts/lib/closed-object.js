"use strict";

// Closed-object validators shared by the raw-audit normalizers.
function exactObjectWithOptional(value, requiredFields, optionalFields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  const missing = requiredFields.find(
    (field) => !Object.prototype.hasOwnProperty.call(value, field)
  );
  if (unknown) throw new Error(`${label}.${unknown} is an unknown field`);
  if (missing) throw new Error(`${label}.${missing} is required`);
}

function exactObject(value, fields, label) {
  exactObjectWithOptional(value, fields, [], label);
}

module.exports = { exactObject, exactObjectWithOptional };
