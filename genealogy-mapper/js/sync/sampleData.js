// Four pedigrees derived from real GEDCOM exports (see sampleTreeAData.js,
// sampleTreeBData.js, sampleTreeCData.js, and sampleTreeDData.js) run through the same
// ancestors-only import the "Import GEDCOM file" button offers - each person's direct
// parent/child line, no siblings, no other branches, as far back as their export
// actually goes. The four most recent generations of each have fictional names and
// lightly shifted dates (see those files' headers); everything older, and every place,
// is as recorded - so this is real research for the map, not a synthetic demo. The
// "walkthrough with sample data" button is how this exact data gets reloaded on any
// browser that doesn't already have it in local storage.
//
// Places ship pre-geocoded via SAMPLE_PLACE_CACHE (see samplePlaceCache.js and
// scripts/geocode-sample-places.mjs) wherever that lookup has an entry, instead of
// depending on the app's live background geocoding pass - the whole reason that cache
// exists is so this data doesn't take a 10-20 minute crawl through Nominatim, throttled
// to 1 request/second, before the map shows more than a handful of dots. Anything NOT
// in the cache (most commonly: the script hasn't been run yet, so the cache is still
// empty - see that file) falls back to the normal 'pending' shape and gets picked up by
// the regular live geocoding pass, exactly like a fresh import.

import { createEmptyTree, addPerson, addUnion, addLineage, addLifeEvent } from '../model/graph.js';
import { parseFuzzyDate } from '../util/dates.js';
import { TREE_A_PEOPLE, TREE_A_UNIONS } from './sampleTreeAData.js';
import { TREE_B_PEOPLE, TREE_B_UNIONS } from './sampleTreeBData.js';
import { TREE_C_PEOPLE, TREE_C_UNIONS } from './sampleTreeCData.js';
import { TREE_D_PEOPLE, TREE_D_UNIONS } from './sampleTreeDData.js';
import { SAMPLE_PLACE_CACHE } from './samplePlaceCache.js';

// `in`, not a plain lookup - a cached `null` (Nominatim was actually asked about this
// place and genuinely had no match) needs to read differently from "never asked at
// all", even though both leave `coords` itself falsy below. Collapsing them the same
// way used to mark every one of the cache's real, confirmed-not-found entries as
// merely 'pending' - the app would then dutifully re-ask Nominatim, live, for every
// single one, get the same "no match" answer it already had, and only end up at
// 'failed' after burning a real throttled network round trip it didn't need to.
function placeCoords(place) {
  if (!place) return { known: false, coords: null };
  const key = place.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SAMPLE_PLACE_CACHE, key)) return { known: false, coords: null };
  return { known: true, coords: SAMPLE_PLACE_CACHE[key] };
}

function ev(dateStr = '', place = '') {
  const { raw, year, approx } = parseFuzzyDate(dateStr);
  const { known, coords } = placeCoords(place);
  const geocodeStatus = !place ? 'none' : coords ? 'ok' : known ? 'failed' : 'pending';
  return {
    date: raw,
    year,
    approx,
    place,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    geocodeStatus,
    precision: coords?.precision ?? null,
  };
}

// Every branch below is real data (not a photo transcription): one person's direct
// ancestor line as recorded in an actual GEDCOM export, filtered down by
// collectAncestorChain in js/import/gedcom.js to just their parent/child chain - no
// siblings, no other branches. `events` are other dated+placed facts a source recorded
// (census residences, etc.) - see each *Data.js file for provenance and how to
// regenerate it from a fresh export.
function buildBranch(tree, { people, unions, lineageName, color }) {
  const lineage = addLineage(tree, { name: lineageName, color });
  const idMap = new Map();

  for (const p of people) {
    const person = addPerson(tree, {
      name: p.name,
      sex: p.sex,
      isRoot: p.isRoot,
      lineageId: lineage.id,
      birth: ev(p.birthDate, p.birthPlace),
      death: ev(p.deathDate, p.deathPlace),
    });
    for (const e of p.events || []) {
      const event = addLifeEvent(person, { date: e.date, place: e.place });
      // addLifeEvent already left this event at geocodeStatus 'pending' (via
      // applyEventFields, since a place was just set) - that's the correct final state
      // for "not in the cache at all", so only the other two outcomes need handling
      // here: a real hit, or a cached, confirmed no-match.
      const { known, coords } = placeCoords(e.place);
      if (coords) {
        event.lat = coords.lat;
        event.lng = coords.lng;
        event.geocodeStatus = 'ok';
        event.precision = coords.precision;
      } else if (known) {
        event.geocodeStatus = 'failed';
      }
    }
    idMap.set(p.id, person.id);
  }

  for (const u of unions) {
    const fatherId = u.father != null ? idMap.get(u.father) : null;
    const motherId = u.mother != null ? idMap.get(u.mother) : null;
    addUnion(tree, [fatherId, motherId], u.children.map((c) => idMap.get(c)));
  }
}

export function buildSampleTree() {
  const tree = createEmptyTree("Sample family trees");
  // color: null on all four (not hardcoded hex) - addLineage falls back to
  // nextLineageColor, which hands out LINEAGE_PALETTE (util/color.js) in order: Ivy
  // Bloom, Raspberry Cane, Copper Beech, Foxglove Bell for these four in turn. Letting
  // it auto-assign, rather than hardcoding each branch's hex here, is what keeps this
  // in sync with that palette - this used to hardcode the fourth tree's color to Blackthorn Berry
  // (dark navy) directly, which is the exact color the map tints its own ocean water,
  // making his dots nearly invisible over open water.
  buildBranch(tree, { people: TREE_A_PEOPLE, unions: TREE_A_UNIONS, lineageName: "Alden Ashgrove's family tree", color: null });
  buildBranch(tree, { people: TREE_B_PEOPLE, unions: TREE_B_UNIONS, lineageName: "Seraphina Vandermere's family tree", color: null });
  buildBranch(tree, { people: TREE_C_PEOPLE, unions: TREE_C_UNIONS, lineageName: "Blythe Galloway's family tree", color: null });
  buildBranch(tree, { people: TREE_D_PEOPLE, unions: TREE_D_UNIONS, lineageName: 'Jerome Verity (DNA match)', color: null });
  return tree;
}
