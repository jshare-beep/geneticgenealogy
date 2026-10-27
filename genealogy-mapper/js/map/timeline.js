// Derives the year range the timeline slider should span from whatever dates are
// actually in the tree, so it always starts sensible rather than defaulting to a fixed
// window that may not fit the data at all.
export function computeYearRange(tree) {
  const now = new Date().getFullYear();
  let min = null;
  let max = null;
  for (const person of Object.values(tree.people)) {
    if (person.birth.year != null) min = min == null ? person.birth.year : Math.min(min, person.birth.year);
    const end = person.death.year ?? (person.birth.year != null ? person.birth.year + 90 : null);
    if (end != null) max = max == null ? end : Math.max(max, end);
  }
  if (min == null) min = now - 200;
  if (max == null) max = now;
  return { min, max: Math.min(max, now) };
}
