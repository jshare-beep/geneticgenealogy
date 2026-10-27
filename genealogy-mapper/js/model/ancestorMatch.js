// Finds pairs of people in DIFFERENT (but both currently "turned on") family trees who
// are plausibly the SAME ancestor, recorded slightly differently by each line's own
// research - the opposite question from map/overlap.js's "possible overlaps" (which
// looks for different people who happened to be in the same place at the same time).
// Here it's: "is this ONE person, spelled or dated two different ways?" Two
// independently-researched trees rarely agree on exact spelling or an exact date for
// someone genealogically old enough to predate reliable record-keeping, so this treats
// a close name as good enough (not an exact one) and a several-year date gap as normal,
// not disqualifying.

// 0-1 normalized name similarity (see nameSimilarity below) - picked so real spelling
// variants clear it ("catherine"/"katherine" scores ~0.89, "jon"/"john" ~0.75) while
// genuinely different names don't ("john"/"james" scores 0.5).
const NAME_MATCH_THRESHOLD = 0.74;
const BIRTH_YEAR_TOLERANCE = 3; // ordinary recordkeeping slop
const BIRTH_YEAR_TOLERANCE_APPROX = 8; // either side's date carries an ABT/CAL/etc. qualifier
const MAX_RESULTS = 60;

// Classic edit-distance DP, iterative with two rolling rows (not the full matrix) -
// this runs across a lot of name pairs in one search, so keeping each call's own memory
// use flat rather than growing with string length matters more here than in a one-off.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Strips accents (so "Renée" and "Rene" compare equal) and anything that isn't a
// letter/space/apostrophe/hyphen, so punctuation or a stray title never counts against
// a real match.
function normalizeName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - dist / longest : 0;
}

// null = "can't tell" (at least one side's year is unknown) - callers treat that as
// neither confirming nor disqualifying a match, since plenty of genuine genealogical
// records just don't have one. false only when both years ARE known and are too far
// apart to plausibly be the same life.
function yearsAgree(evA, evB) {
  if (evA?.year == null || evB?.year == null) return null;
  const tolerance = evA.approx || evB.approx ? BIRTH_YEAR_TOLERANCE_APPROX : BIRTH_YEAR_TOLERANCE;
  return Math.abs(evA.year - evB.year) <= tolerance;
}

// activeLineageIds: which of the tree's own family trees are "turned on" right now -
// see activeLineageIds() in main.js, the same set already used for the map's overlap
// search and for saving a comparison, reused here so "turned off" means the same thing
// everywhere in the app.
export function findOverlappingAncestors(tree, activeLineageIds) {
  const people = Object.values(tree.people).filter((p) => p.name?.trim() && activeLineageIds.has(p.lineageId));
  const matches = [];

  for (let i = 0; i < people.length; i++) {
    const a = people[i];
    for (let j = i + 1; j < people.length; j++) {
      const b = people[j];
      // Only cross-tree pairs are the point here - two records in the SAME tree are
      // already known to be distinct people (or already merged, if they're not).
      if (a.lineageId === b.lineageId) continue;

      // Cheapest possible check first: if both birth years are known and clearly
      // incompatible, skip before ever paying for the name comparison below - name
      // similarity (Levenshtein) is the expensive part of this search, and most pairs
      // in a real tree share neither name nor era.
      const birthAgree = yearsAgree(a.birth, b.birth);
      if (birthAgree === false) continue;

      const nameScore = nameSimilarity(a.name, b.name);
      if (nameScore < NAME_MATCH_THRESHOLD) continue;

      const deathAgree = yearsAgree(a.death, b.death);
      matches.push({ personAId: a.id, personBId: b.id, nameScore, birthAgree, deathAgree });
    }
  }

  // Name closeness leads; matching birth/death years is a real but smaller boost - a
  // near-exact name with dates that also agree should out-rank an equally-close name
  // where the dates are simply unknown on one side.
  matches.sort((m1, m2) => confidence(m2) - confidence(m1));
  return matches.slice(0, MAX_RESULTS);
}

function confidence(match) {
  return match.nameScore + (match.birthAgree ? 0.15 : 0) + (match.deathAgree ? 0.05 : 0);
}
