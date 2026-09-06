"use strict";

const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;

function isRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match = value.match(RFC3339_DATE_TIME);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , zone, offsetHour, offsetMinute] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12) return false;
  const maxDay = new Date(Date.UTC(Number(year), monthNumber, 0)).getUTCDate();
  if (dayNumber < 1 || dayNumber > maxDay) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function compareRfc3339DateTimes(left, right) {
  if (!isRfc3339DateTime(left) || !isRfc3339DateTime(right)) {
    throw new TypeError("RFC 3339 comparison requires two valid date-times");
  }
  const leftMatch = left.match(RFC3339_DATE_TIME);
  const rightMatch = right.match(RFC3339_DATE_TIME);
  const leftWhole = Date.parse(withoutFraction(leftMatch));
  const rightWhole = Date.parse(withoutFraction(rightMatch));
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;

  const leftFraction = leftMatch[7] || "";
  const rightFraction = rightMatch[7] || "";
  const precision = Math.max(leftFraction.length, rightFraction.length);
  for (let index = 0; index < precision; index += 1) {
    const leftDigit = leftFraction[index] || "0";
    const rightDigit = rightFraction[index] || "0";
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
}

function withoutFraction(match) {
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[8]}`;
}

module.exports = { compareRfc3339DateTimes, isRfc3339DateTime };
