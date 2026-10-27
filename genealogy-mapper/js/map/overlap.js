// Finds where people from DIFFERENT lines might actually have crossed paths: close
// together geographically (default 30 miles - roughly "same town or parish, or a
// short trip between two neighboring ones") AND with overlapping presence intervals
// (see model/presence.js - which already accounts for
// the fact that we don't know exactly when someone moved between two recorded places).
// This is a research lead pointing at a likely error in one of the paper trails, not a
// claim that two records are the same person - two distinct, correctly-researched
// ancestries shouldn't produce a DNA match at all, so a crossed path here is a candidate
// place to go look for the misattribution.
//
// Groups aren't just pairs: if three (or more) people from different lines are all
// possibly in the same place at the same time, that's reported as one group spanning
// all of them, not three separate overlapping pairs - see findTimeOverlapGroups below.

import { haversineKm, KM_TO_MILES } from '../util/dates.js';
import { presenceIntervals, inferredPresenceIntervals } from '../model/presence.js';
import { buildIndices } from '../model/graph.js';

const DEFAULT_DISTANCE_MILES = 30;
// Clustering itself works in km (haversineKm's own unit) - this is just that same 30
// miles expressed in km, not a separate/different radius.
const DEFAULT_DISTANCE_KM = DEFAULT_DISTANCE_MILES / KM_TO_MILES;
const DEFAULT_MAX_RESULTS = 60;

// Single-linkage clustering (below) joins two records if they're close, INCLUDING by a
// chain of other close records - "possibly the same town" is genuinely transitive over
// one short hop, but a long enough chain of short hops can still walk a cluster clean
// across a whole densely-settled region (many generations of several lines all having
// stayed within the same cluster of neighboring New England towns, say), even though
// the two ends of that chain are nowhere near each other. Confirmed 2026-08-28: real
// data produced single "clusters" of 75-118 people this way once enough of a tree was
// actually geocoded for chains that long to exist - not a meaningful "might have
// crossed paths" lead at that size, and expensive to even finish processing (a group's
// own gold connecting lines are drawn one per PAIR of members, so a 118-person false
// merge alone is ~6,900 lines - across the handful of chains this size that turned up,
// that added up to the low hundreds of thousands, and was the actual cause of a
// multi-second page freeze on load). Capped here, before the expensive per-cluster time
// search below ever runs on one - a real single-town cluster this large would be
// extraordinary; this exists to catch the chaining failure mode, not to limit genuine
// findings.
const MAX_CLUSTER_SIZE = 40;

// Union-find over every geocoded presence record in the tree: two records join the
// same spatial cluster if they're within maxDistanceKm of one another (directly, or by
// a chain of other nearby records) - single-linkage, which is the right shape here
// since "possibly the same town" is naturally transitive over short hops.
//
// Comparing every record against every other one (a plain double loop) was fine back
// when almost nothing in a tree was actually geocoded yet, but stops being fine the
// moment most of it is: a few thousand real waypoints means a few million haversine
// calls, on every refresh() - this is exactly what froze the tab the first time the
// sample data loaded with its (now fully populated) place cache, going from "mostly
// ungeocoded" to "nearly everything has real coordinates" for the first time. So
// records are bucketed into a coarse lat/lng grid first, sized so any two points within
// maxDistanceKm always land in the same cell or a neighboring one - only those get an
// actual haversine check, not every pair in the whole tree.
function clusterBySpace(records, maxDistanceKm) {
  const parent = records.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // 1 degree of latitude is ~111km everywhere, so that conversion is exact regardless
  // of where on Earth a record is. Longitude isn't - 1 degree of longitude shrinks
  // toward the poles (it's ~111km*cos(latitude)) - so the longitude cell uses a fixed,
  // conservative stand-in for cos(latitude) (0.26, i.e. good up to ~75° - well past
  // where any real genealogical record is likely to be) rather than the true value at
  // each point, so cells stay UNDERSIZED (never oversized) in the worst case. Undersized
  // cells just mean checking a few more neighboring cells than strictly necessary - a
  // small efficiency cost; oversized ones could silently miss a real match, which
  // would actually be wrong, not just slower.
  const latCellDeg = Math.max(0.05, maxDistanceKm / 111);
  const lngCellDeg = Math.max(0.05, maxDistanceKm / (111 * 0.26));
  const cellOf = (rec) => `${Math.floor(rec.lat / latCellDeg)}:${Math.floor(rec.lng / lngCellDeg)}`;
  const grid = new Map();
  records.forEach((rec, i) => {
    const key = cellOf(rec);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });

  for (let i = 0; i < records.length; i++) {
    const latCell = Math.floor(records[i].lat / latCellDeg);
    const lngCell = Math.floor(records[i].lng / lngCellDeg);
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const bucket = grid.get(`${latCell + dLat}:${lngCell + dLng}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue; // each unordered pair only needs checking once
          if (haversineKm(records[i].lat, records[i].lng, records[j].lat, records[j].lng) <= maxDistanceKm) {
            union(i, j);
          }
        }
      }
    }
  }
  const groups = new Map();
  records.forEach((rec, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(rec);
  });
  return [...groups.values()];
}

function maxPairwiseDistanceKm(records) {
  let max = 0;
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      max = Math.max(max, haversineKm(records[i].lat, records[i].lng, records[j].lat, records[j].lng));
    }
  }
  return max;
}

// Within one spatial cluster, sweeps through every start/end year to find each stable
// stretch of time where a set of >=2 people (from >=2 different lines) are ALL
// simultaneously present - a true mutual overlap, not just a chain of pairwise ones.
// Adjacent stretches with the exact same set of people are merged into one continuous
// window, so a steady multi-year overlap reports as a single group instead of being
// sliced up at every waypoint boundary that happens to fall inside it.
function findTimeOverlapGroups(records) {
  const breakpoints = [...new Set(records.flatMap((r) => [r.startYear, r.endYear]))].sort((a, b) => a - b);
  const groups = [];
  let prevKey = null;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd = breakpoints[i + 1];
    if (segStart === segEnd) continue;
    const mid = (segStart + segEnd) / 2;
    const active = records.filter((r) => r.startYear <= mid && r.endYear >= mid);

    const byPerson = new Map();
    for (const r of active) if (!byPerson.has(r.personId)) byPerson.set(r.personId, r);
    const members = [...byPerson.values()];
    const lineageIds = [...new Set(members.map((r) => r.lineageId))];

    if (members.length < 2 || lineageIds.length < 2) {
      prevKey = null;
      continue;
    }

    const key = members
      .map((r) => r.personId)
      .sort()
      .join('|');
    const last = groups[groups.length - 1];
    if (key === prevKey && last) {
      last.endYear = segEnd;
    } else {
      // "City-level" only when EVERY member's matched place is itself city-precision -
      // a group built from someone's "Missouri" and someone else's "Missouri" isn't a
      // real lead the way two people both landing on the same town is, even though
      // they clustered together spatially (both geocoded to the state's centroid).
      const isCityLevel = members.every((m) => m.precision === 'city');
      groups.push({ startYear: segStart, endYear: segEnd, members, lineageIds, distanceKm: maxPairwiseDistanceKm(members), isCityLevel });
      prevKey = key;
    }
  }
  return groups;
}

export function findPossibleOverlaps(tree, { maxDistanceKm = DEFAULT_DISTANCE_KM, maxResults = DEFAULT_MAX_RESULTS, excludeLineageIds = null } = {}) {
  const indices = buildIndices(tree);
  const records = [];
  for (const person of Object.values(tree.people)) {
    if (!person.lineageId) continue;
    // A family tree someone has opted out of the overlap search for (too big, or just
    // not relevant right now) is skipped entirely here, not merely hidden from the
    // results list - so it also can't slow down or clutter another family tree's matches.
    if (excludeLineageIds && excludeLineageIds.has(person.lineageId)) continue;
    for (const interval of presenceIntervals(person)) {
      records.push({ ...interval, personId: person.id, lineageId: person.lineageId });
    }
    // Only reached when the person has no waypoints of their own - see
    // inferredPresenceIntervals. Downgraded to 'broad' precision regardless of the
    // source record's own precision: an inference is a weaker claim than a direct
    // record even when that record was itself a tight city match.
    for (const interval of inferredPresenceIntervals(tree, indices, person)) {
      records.push({ ...interval, precision: 'broad', personId: person.id, lineageId: person.lineageId });
    }
  }
  if (records.length < 2) return [];

  const groups = clusterBySpace(records, maxDistanceKm)
    .filter((cluster) => cluster.length >= 2 && cluster.length <= MAX_CLUSTER_SIZE)
    .flatMap((cluster) => findTimeOverlapGroups(cluster));

  groups.sort((a, b) => b.lineageIds.length - a.lineageIds.length || a.distanceKm - b.distanceKm || b.startYear - a.startYear);
  return groups.slice(0, maxResults);
}
