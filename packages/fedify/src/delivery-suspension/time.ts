// Private exact XSD 1.1 dateTime arithmetic. No floating point or Temporal range.
export interface ExactDateTime {
  readonly seconds: bigint;
  readonly fraction: string;
}

// A resource limit on the complete lexical value, not a precision restriction.
export const MAX_TIMESTAMP_LENGTH = 4096;

function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

function leap(year: bigint): boolean {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}

export function parseExactDateTime(raw: string): ExactDateTime | null {
  if (raw.length > MAX_TIMESTAMP_LENGTH) return null;
  const match =
    /^(-?)([0-9]{4,})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(
      raw,
    );
  if (match === null || (match[2].length > 4 && match[2][0] === "0"))
    return null;
  const year = BigInt(match[1] + match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  const fraction = (match[8] ?? "").replace(/0+$/, "");
  if (month < 1 || month > 12 || hour > 24 || minute > 59 || second > 59)
    return null;
  if (hour === 24 && (minute !== 0 || second !== 0 || fraction !== ""))
    return null;
  const monthDays = [
    31,
    leap(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > monthDays[month - 1]) return null;
  const zone = match[9];
  const zoneHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0))
    return null;
  const offset = (zoneHour * 60 + zoneMinute) * (zone[0] === "-" ? -1 : 1);
  // Count days from astronomical year zero; floor division is essential in BCE.
  let days =
    365n * year +
    floorDivide(year + 3n, 4n) -
    floorDivide(year + 99n, 100n) +
    floorDivide(year + 399n, 400n);
  for (let m = 1; m < month; m++) days += BigInt(monthDays[m - 1]);
  days += BigInt(day - 1);
  return {
    seconds:
      days * 86400n + BigInt(hour * 3600 + minute * 60 + second - offset * 60),
    fraction,
  };
}

export function compareExactDateTimes(
  a: ExactDateTime,
  b: ExactDateTime,
): -1 | 0 | 1 {
  if (a.seconds < b.seconds) return -1;
  if (a.seconds > b.seconds) return 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(length, "0");
  const bf = b.fraction.padEnd(length, "0");
  return af < bf ? -1 : af > bf ? 1 : 0;
}
