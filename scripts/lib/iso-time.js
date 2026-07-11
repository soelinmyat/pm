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

module.exports = { isRfc3339DateTime };
