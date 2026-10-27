// Fills in a broad geocode (a place that only resolved to a state/province/country/
// county centroid - Nominatim found no actual city, see classifyPrecision in
// geocode.js), a failed one (place text Nominatim couldn't find at all), or a MISSING
// one (no place recorded whatsoever) by borrowing a specific city from a close
// relative, rather than leaving that person's dot sitting on an administrative
// centroid that's often nowhere near where they actually were - or off the map
// entirely. The original complaint this module exists to fix: a lone dot in the
// geographic middle of Canada, from someone's death record only ever having said
// "Canada" - the same problem as a parent whose only record says "England" landing on
// a random dot in the middle of the country and clustering, in the overlap search,
// with someone from York who happens to share that same coincidental non-place, when a
// child or spouse's own record already says specifically "Surrey, England."
//
// A broad match (Nominatim genuinely resolved SOME region) still has to be textually
// consistent with the candidate's specific place - see isPlaceConsistent - so a parent
// whose own broad match is "Scotland" never borrows a relative's city in Yorkshire just
// because that relative happens to be nearby in the family tree. A failed or missing
// match has no such region to confirm against, so any of that relative's own city-level
// records is used - there's nothing more specific to weigh it against, and it's still a
// better guess than no dot (or a country-centroid dot) at all.
//
// Relatives are tried in this priority order, per event needing inference:
//   1. spouse
//   2. a minor child (a minor lives with their parent, so the child's own recorded
//      place is a reasonable stand-in for where the parent was too)
//   3. a parent, if this person was themselves a minor at the time of the event
//   4. a child, if this person was an adult at the time of the event
//   5. a parent, if this person was an adult at the time of the event
// The first relative (in that order) who has ANY event - birth, death, or a life event
// - that is both city-precision AND textually consistent with this person's broad
// place text wins; that relative's coordinates are borrowed, and the source is
// recorded on the event so the UI can say where the guess came from instead of passing
// it off as a real geocode.

const MINOR_CUTOFF_YEARS = 18;

function normalizePlace(text) {
  return (text || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// A broad place ("Ontario, Canada") is treated as consistent with a specific one
// ("Toronto, Ontario, Canada") when the specific text contains the broad text - place
// names conventionally read narrowest-first, so a real city in that broad place almost
// always has the broad place's own text sitting at the end of its own, longer text.
// A plain substring check (not just a suffix check) is deliberately a little more
// lenient than that, to tolerate minor formatting differences between two people's own
// place text for what's meant to be the same broad region.
function isPlaceConsistent(broadText, specificText) {
  const broad = normalizePlace(broadText);
  const specific = normalizePlace(specificText);
  if (!broad || !specific) return false;
  return specific.includes(broad);
}

function personEvents(person) {
  return [person.birth, person.death, ...(person.events || [])].filter(Boolean);
}

function isMinorInYear(person, year) {
  if (year == null || person.birth?.year == null) return false;
  const age = year - person.birth.year;
  return age >= 0 && age < MINOR_CUTOFF_YEARS;
}

function parentIdsOf(tree, indices, personId) {
  const unionId = indices.parentUnionOf.get(personId);
  const union = unionId ? tree.unions[unionId] : null;
  return union ? union.partnerIds.filter(Boolean) : [];
}

// The five candidate tiers, in priority order, for one person's one broad event. Only
// one of "is a minor" vs. "is an adult" ever applies for a given event's year, so
// exactly one of tiers 3-5 is ever non-empty by construction (not by an extra check
// here) - matching the mutually-exclusive minor/adult framing the tiers were specified
// in.
function candidateTiers(tree, indices, person, eventYear) {
  const childIds = indices.childrenOf.get(person.id) || [];
  const minorChildIds = childIds.filter((cid) => isMinorInYear(tree.people[cid], eventYear));
  const parentIds = parentIdsOf(tree, indices, person.id);
  const selfIsMinor = isMinorInYear(person, eventYear);

  const tiers = [
    { via: 'spouse', ids: indices.spouseOf.get(person.id) || [] },
    { via: 'minor child', ids: minorChildIds },
  ];
  if (selfIsMinor) {
    tiers.push({ via: 'parent', ids: parentIds });
  } else {
    tiers.push({ via: 'child', ids: childIds });
    tiers.push({ via: 'parent', ids: parentIds });
  }
  return tiers;
}

// true only for a genuine Nominatim broad match - a real (if imprecise) region to hold
// a candidate's own city accountable to. A failed or missing match has no such region,
// so bestMatchFrom below skips the consistency check entirely for those rather than
// comparing against empty text (which isPlaceConsistent already treats as "never
// consistent," which would otherwise silently block every failed/missing event from
// ever matching anything).
function hasBroadRegionToMatch(ev) {
  return !!(ev.place && ev.geocodeStatus === 'ok' && ev.precision === 'broad');
}

// Broad ('ok'/'broad'): a real Nominatim region, just not a specific enough one.
// Failed: place text Nominatim couldn't resolve at all. None: no place recorded. All
// three read the same way here - "nothing useful to plot yet" - they just differ in
// whether there's region text worth holding a candidate match accountable to (see
// hasBroadRegionToMatch) and whether there's any place text worth keeping once a
// specific one is found (see the `ev.place ||=` below - only a genuinely blank one
// gets the matched relative's own text copied in).
function needsInference(ev) {
  if (!ev) return false;
  if (ev.geocodeStatus === 'ok' && ev.precision === 'broad') return true;
  if (ev.geocodeStatus === 'failed') return true;
  if (ev.geocodeStatus === 'none') return true;
  return false;
}

// The first city-precision event belonging to this specific candidate that's
// consistent with the broad region being resolved (skipped entirely when there isn't
// one - see hasBroadRegionToMatch) - same-type (birth-for-birth, death-for-death)
// preferred over any other event of theirs, since e.g. a spouse's decades-later death
// place is a weaker stand-in for THIS person's birth place than any of the spouse's
// own events would be if one happens to match type.
function bestMatchFrom(candidate, targetEvent, targetEventKey) {
  const requireConsistency = hasBroadRegionToMatch(targetEvent);
  const candidateEvents = personEvents(candidate);
  const sameType = targetEventKey === 'birth' || targetEventKey === 'death' ? candidate[targetEventKey] : null;
  const ordered = sameType ? [sameType, ...candidateEvents.filter((e) => e !== sameType)] : candidateEvents;
  for (const ev of ordered) {
    if (!ev || !ev.place || ev.precision !== 'city' || ev.lat == null || ev.lng == null) continue;
    if (requireConsistency && !isPlaceConsistent(targetEvent.place, ev.place)) continue;
    return ev;
  }
  return null;
}

function eventsOf(person) {
  return [
    ['birth', person.birth],
    ['death', person.death],
    ...(person.events || []).map((ev) => [ev.id, ev]),
  ];
}

// Mutates every event still needing inference (see needsInference) in place. Safe to
// call on every refresh(): an event that's already city-precision (whether from a real
// geocode, a manual pin, or a previous inference) is untouched, so re-running this as
// data changes elsewhere just picks up newly-possible matches rather than redoing
// settled ones. Returns how many events it resolved, for callers that want to report it.
export function applyLocationInference(tree, indices) {
  let resolvedCount = 0;
  for (const person of Object.values(tree.people)) {
    for (const [key, ev] of eventsOf(person)) {
      if (!needsInference(ev)) continue;
      const tiers = candidateTiers(tree, indices, person, ev.year);
      let match = null;
      let matchedVia = null;
      let matchedCandidate = null;
      for (const tier of tiers) {
        for (const candidateId of tier.ids) {
          const candidate = tree.people[candidateId];
          if (!candidate) continue;
          const found = bestMatchFrom(candidate, ev, key);
          if (found) {
            match = found;
            matchedVia = tier.via;
            matchedCandidate = candidate;
            break;
          }
        }
        if (match) break;
      }
      if (!match) continue;
      ev.lat = match.lat;
      ev.lng = match.lng;
      ev.precision = 'city';
      ev.geocodeStatus = 'inferred';
      // A failed event's own place text is the researcher's own data (just not
      // something Nominatim could resolve) and stays exactly as typed; a blank one has
      // nothing to preserve, so it borrows the matched relative's place text too -
      // otherwise this event would show real coordinates on the map next to an empty
      // place field, which reads as broken rather than as a filled-in guess.
      if (!ev.place) ev.place = match.place;
      ev.inferredFrom = { personId: matchedCandidate.id, name: matchedCandidate.name || 'a relative', via: matchedVia, place: match.place };
      resolvedCount += 1;
    }
  }
  return resolvedCount;
}
