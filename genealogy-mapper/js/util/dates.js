// Lenient parsing for genealogy date strings ("12 JAN 1850", "ABT 1850", "1850-1855",
// a bare year, or a blank) - we only ever need a sortable/comparable year out of these,
// never a full calendar date, so this deliberately doesn't try to be a real date parser.

const QUALIFIER_RE = /\b(ABT|ABOUT|APPROX|EST|ESTIMATED|CAL|CALCULATED|BEF|BEFORE|AFT|AFTER|BET|BETWEEN|CIRCA|C\.?)\b/i;
const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/;

export function parseFuzzyDate(input) {
  const raw = input == null ? '' : String(input).trim();
  if (!raw) return { raw: '', year: null, approx: false };
  const approx = QUALIFIER_RE.test(raw) || /~|\?/.test(raw);
  const match = raw.match(YEAR_RE);
  const year = match ? parseInt(match[1], 10) : null;
  return { raw, year, approx };
}

export const KM_TO_MILES = 0.621371;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
