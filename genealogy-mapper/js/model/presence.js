// A person's recorded places aren't snapshots at single instants - between two dated,
// geocoded waypoints (birth, a life event, death) we don't know exactly when they moved
// from one to the next. Dying somewhere isn't the moment they arrived there; a life
// event's date is when a record was made, not necessarily an arrival.
//
// So both the timeline animation and overlap detection use the same rule: a waypoint's
// place is treated as "possibly true" for the ENTIRE ambiguous gap to its neighboring
// waypoints, not just its own exact year. Concretely, a waypoint at year Y is "present"
// from the PREVIOUS waypoint's year through the NEXT waypoint's year - so during the
// gap between two waypoints, the person is counted as possibly still at the earlier
// place AND possibly already at the later one, rather than arbitrarily picking one. The
// two neighboring intervals overlap each other for exactly this reason.

const ASSUMED_MAX_LIFESPAN = 95;

// A person's life in chronological order: birth, then any other places lived (sorted by
// year - undated ones fall in after the dated ones, ahead of death), then death.
export function lifeWaypoints(person) {
  const events = (person.events || []).slice().sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
  return [
    { label: 'Born', ev: person.birth },
    ...events.map((ev) => ({ label: ev.date || (ev.year != null ? String(ev.year) : 'Lived'), ev })),
    { label: 'Died', ev: person.death },
  ];
}

// One interval per geocoded, dated waypoint, widened per the module comment above.
// Undated or ungeocoded waypoints are skipped - there's no year to anchor an interval
// to (they still render on the map, just don't participate in time-based reasoning).
export function presenceIntervals(person) {
  const points = lifeWaypoints(person).filter((wp) => wp.ev.lat != null && wp.ev.lng != null && wp.ev.year != null);
  if (!points.length) return [];

  const overallStart = person.birth.year;
  const overallEnd = person.death.year ?? (person.birth.year != null ? person.birth.year + ASSUMED_MAX_LIFESPAN : null);

  return points.map((wp, i) => {
    const startYear = Math.min(i > 0 ? points[i - 1].ev.year : overallStart ?? wp.ev.year, wp.ev.year);
    const endYear = Math.max(i < points.length - 1 ? points[i + 1].ev.year : overallEnd ?? wp.ev.year, wp.ev.year);
    // `ev` is the original event object (person.birth/death, or an entry from
    // person.events) - kept by reference so a caller that already has a waypoint from
    // lifeWaypoints() can look up its matching interval by identity.
    return { label: wp.label, place: wp.ev.place, lat: wp.ev.lat, lng: wp.ev.lng, year: wp.ev.year, precision: wp.ev.precision ?? null, startYear, endYear, ev: wp.ev };
  });
}

const UNDERAGE_CUTOFF = 18;

// A person with no records of their own (common for women in older records - they
// often survive only as "wife of" on someone else's document) still very likely lived
// wherever their household did. Borrows presence from a spouse (any recorded location
// of theirs) and from underage children (a child's own record - a census entry, a
// school record - implies the whole household, parents included, was there too, since
// a minor doesn't live apart from their family). Each borrowed waypoint keeps the
// source person's name and precision so a caller can be honest that it's inferred, not
// directly recorded - see mapView.js and map/overlap.js for how they render/weight it
// differently from a real interval.
//
// Deliberately only kicks in when the person has ZERO waypoints of their own - a
// person with even one real record isn't a case of "no data," and merging inferred
// gaps into an already-partial record is a fuzzier claim this doesn't attempt yet.
export function inferredPresenceIntervals(tree, indices, person) {
  if (presenceIntervals(person).length > 0) return [];

  const inferred = [];

  const spouseIds = indices.spouseOf.get(person.id) || [];
  for (const spouseId of spouseIds) {
    const spouse = tree.people[spouseId];
    if (!spouse) continue;
    for (const iv of presenceIntervals(spouse)) {
      inferred.push({ ...iv, isInferred: true, sourceLabel: `via ${spouse.name || 'spouse'}` });
    }
  }

  const childIds = indices.childrenOf.get(person.id) || [];
  for (const childId of childIds) {
    const child = tree.people[childId];
    if (!child || child.birth.year == null) continue;
    for (const iv of presenceIntervals(child)) {
      if (iv.year != null && iv.year - child.birth.year < UNDERAGE_CUTOFF) {
        inferred.push({ ...iv, isInferred: true, sourceLabel: `via ${child.name || 'child'} (underage)` });
      }
    }
  }

  return inferred;
}

// Coarse "alive at all" check (birth-death range, with the same assumed-lifespan
// fallback as the intervals above) - used where per-waypoint precision isn't needed.
//
// A missing birth year used to make this return true unconditionally - every year of
// recorded history, not just a plausible lifespan - because there was no year to check
// against. Combined with interpolatedPosition's "hold at the nearest known point
// outside the range" behavior below, that's exactly what put someone whose only record
// is a 1940s census parked in Washington DC on the year-1575 frame of the timeline: with
// no birth year, they read as "active" at 1575 too, and their one known point was the
// nearest thing to interpolate to. Falls back to the person's own earliest/latest DATED
// fact (death, or a life event) as a stand-in bound instead, so an unknown birth year no
// longer means "alive for all of history" - just "somewhere within one lifespan of
// whatever we do know about them."
export function isPersonActiveInYear(person, currentYear) {
  if (currentYear == null) return true;
  const birthYear = person.birth?.year;
  const deathYear = person.death?.year;
  if (birthYear != null) {
    if (currentYear < birthYear) return false;
    if (deathYear != null) return currentYear <= deathYear;
    return currentYear <= birthYear + ASSUMED_MAX_LIFESPAN;
  }
  const knownYears = [deathYear, ...(person.events || []).map((e) => e.year)].filter((y) => y != null);
  if (!knownYears.length) return true; // nothing at all recorded to bound this person by
  const earliest = Math.min(...knownYears);
  const latest = Math.max(...knownYears);
  return currentYear >= earliest - ASSUMED_MAX_LIFESPAN && currentYear <= latest + ASSUMED_MAX_LIFESPAN;
}

// Whether a specific waypoint's dot should read as "lit" for a given animation year -
// true whenever currentYear falls within its own widened interval, so during an
// ambiguous gap both neighboring waypoints light up together instead of the dot
// jumping instantly from one place to the next.
export function isIntervalActiveInYear(interval, currentYear) {
  if (currentYear == null) return true;
  return currentYear >= interval.startYear && currentYear <= interval.endYear;
}

// Where a single-dot animation should sit for `currentYear`, given a chronological
// list of {lat, lng, year, label, place, precision} points: glides linearly across the
// gap between whichever two points currentYear falls between - the same "we don't know
// exactly when they moved" gap presenceIntervals widens, just interpolated smoothly
// instead of shown as two simultaneously-lit endpoints - and holds still at the
// nearest end point outside the whole range (e.g. before their first geocoded
// waypoint, or after their last). `points` must already be sorted by year. `precision`
// rides along on every returned point so a caller (mapView.js) can render a
// country/state-centroid guess visibly differently from an actual city-level fix -
// carried straight through unchanged when the dot is holding at (or snapped to) one
// real point, and downgraded to 'broad' for an interpolated "en route" position between
// two points if EITHER end is itself only broad (the guess is no more precise than its
// least precise endpoint).
export function interpolateAmongPoints(points, currentYear) {
  if (!points.length) return null;
  const first = points[0];
  if (currentYear <= first.year) return { lat: first.lat, lng: first.lng, label: first.label, place: first.place, precision: first.precision };
  const last = points[points.length - 1];
  if (currentYear >= last.year) return { lat: last.lat, lng: last.lng, label: last.label, place: last.place, precision: last.precision };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (currentYear >= a.year && currentYear <= b.year) {
      const span = b.year - a.year;
      const t = span > 0 ? (currentYear - a.year) / span : 0;
      if (t <= 0.001) return { lat: a.lat, lng: a.lng, label: a.label, place: a.place, precision: a.precision };
      if (t >= 0.999) return { lat: b.lat, lng: b.lng, label: b.label, place: b.place, precision: b.precision };
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        label: 'En route',
        place: `${a.place || a.label} → ${b.place || b.label}`,
        precision: a.precision === 'city' && b.precision === 'city' ? 'city' : 'broad',
      };
    }
  }
  return null;
}

// A person's own single moving-dot position for `currentYear` - null while they're not
// "in play" at all (not born yet, or outside the assumed-lifespan window past death) or
// have no geocoded waypoints to place them with.
export function interpolatedPosition(person, currentYear) {
  if (currentYear == null || !isPersonActiveInYear(person, currentYear)) return null;
  const points = lifeWaypoints(person)
    .filter((wp) => wp.ev.lat != null && wp.ev.lng != null && wp.ev.year != null)
    .map((wp) => ({ lat: wp.ev.lat, lng: wp.ev.lng, year: wp.ev.year, label: wp.label, place: wp.ev.place, precision: wp.ev.precision }));
  return interpolateAmongPoints(points, currentYear);
}
