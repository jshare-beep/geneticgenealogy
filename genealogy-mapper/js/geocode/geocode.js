// Turns free-text place names ("Cork, Ireland") into map coordinates via OpenStreetMap's
// free Nominatim geocoder - no API key needed, but its usage policy caps clients at 1
// request/second, so every lookup is serialized through one shared queue rather than
// fired off in parallel (bulk imports of a few hundred people would otherwise slam it).
// Results are cached by normalized place text in localStorage, both to stay well under
// that limit on repeat imports/edits and because many people in one tree share a town.

const CACHE_KEY = 'genealogyMapper.geocodeCache.v1';
// Exported so the UI can estimate "time left" for a bulk pass without duplicating the
// throttle rate as a separate magic number.
export const MIN_INTERVAL_MS = 1100;

// "At sea" never resolves through Nominatim (it's not a real place), so it's
// special-cased to a fixed box of open Atlantic water inside the Bermuda Triangle -
// clear of Bermuda itself, the Bahamas chain, Turks & Caicos, and Puerto Rico. Each
// distinct person/event gets its own deterministic point (hashed from a seed, not the
// place text) so multiple "at sea" deaths scatter across the box instead of stacking on
// one dot, while still landing on the exact same point every time the app reloads.
const AT_SEA_RE = /\bat\s+sea\b/i;
const BERMUDA_TRIANGLE_BOUNDS = { latMin: 25, latMax: 29, lonMin: -71, lonMax: -67 };

// How precisely a geocode result pins down a real place - "city" (an actual town/city/
// village match, tight enough that two people landing here plausibly crossed paths) vs
// "broad" (a state, county, or country-level match - two people both just recorded as
// "Missouri" could be 300 miles apart, so that's a much weaker overlap signal). Used to
// split the "Possible overlaps" list into "City and Year Overlaps" vs "Broader/Possible
// Overlaps". Nominatim's place_rank is the most reliable signal (roughly: 4=country,
// 8=state, 12=county, 16=city, 17+=town/village/suburb); addresstype is a fallback for
// responses that omit it.
const CITY_ADDRESS_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'municipality', 'borough', 'township', 'city_district', 'neighbourhood']);

function classifyPrecision(nominatimResult) {
  const rank = nominatimResult?.place_rank;
  if (typeof rank === 'number') return rank >= 16 ? 'city' : 'broad';
  return CITY_ADDRESS_TYPES.has(nominatimResult?.addresstype) ? 'city' : 'broad';
}

let cache = loadCache();
let queue = Promise.resolve();
let lastCallAt = 0;

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pointInBermudaTriangle(seed) {
  const h = hashString(seed);
  const fracLat = (h % 10007) / 10007;
  const fracLon = (Math.floor(h / 10007) % 10007) / 10007;
  const { latMin, latMax, lonMin, lonMax } = BERMUDA_TRIANGLE_BOUNDS;
  return {
    lat: latMin + fracLat * (latMax - latMin),
    lng: lonMin + fracLon * (lonMax - lonMin),
    display: 'At sea (Bermuda Triangle, approximate)',
    precision: 'broad',
  };
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable - the cache just stops persisting, lookups still work.
  }
}

function normalize(place) {
  return String(place || '').trim().toLowerCase();
}

async function throttledFetch(url) {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);
  return res.json();
}

// Returns {lat, lng, display} on success, null if the place genuinely has no match
// (cached either way), or undefined on a transient failure (network/rate-limit - NOT
// cached, so a later retry can still succeed).
//
// `seed` identifies which specific person/event this lookup is for (e.g. "p123:death"),
// used only to scatter "at sea" placements - ignored for normal places, which are still
// shared/cached by place text as usual.
export async function geocodePlace(place, seed) {
  const key = normalize(place);
  if (!key) return null;
  if (AT_SEA_RE.test(key)) return pointInBermudaTriangle(seed || key);
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

  const run = queue.then(async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    try {
      const data = await throttledFetch(url);
      const hit = data && data[0]
        ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name, precision: classifyPrecision(data[0]) }
        : null;
      cache[key] = hit;
      saveCache();
      return hit;
    } catch (err) {
      console.error('Geocode error for', place, err);
      return undefined;
    }
  });
  queue = run.catch(() => {});
  return run;
}

// Walks every person's pending birth/death place and geocodes it, one at a time
// (throttled above), reporting progress so a large bulk import can show a live counter
// instead of appearing to hang.
function allEventsOf(person) {
  return [person.birth, person.death, ...(person.events || [])];
}

export async function geocodeAllPending(tree, { onProgress, signal } = {}) {
  // Grouped by line first, then merged round-robin below - Nominatim's 1-request/
  // second policy means a big tree's places alone can take tens of minutes, and
  // resolving strictly in whatever order people happen to be stored would let one
  // large line's places hog the entire front of the queue while every other line
  // sits untouched. Interleaving means every line gets an early, representative
  // sample of its own geography resolved, instead of looking geographically
  // narrower than it really is just because its places haven't come up yet.
  const byLineage = new Map(); // lineageId (or a shared key for "no line") -> pending items, in each person's own tree order
  for (const person of Object.values(tree.people)) {
    const key = person.lineageId || '__unassigned__';
    if (!byLineage.has(key)) byLineage.set(key, []);
    const bucket = byLineage.get(key);
    if (person.birth.place && person.birth.geocodeStatus === 'pending') {
      bucket.push({ ev: person.birth, seed: `${person.id}:birth` });
    }
    if (person.death.place && person.death.geocodeStatus === 'pending') {
      bucket.push({ ev: person.death, seed: `${person.id}:death` });
    }
    for (const event of person.events || []) {
      if (event.place && event.geocodeStatus === 'pending') {
        bucket.push({ ev: event, seed: `${person.id}:${event.id}` });
      }
    }
  }
  const buckets = [...byLineage.values()];
  const pending = [];
  for (let more = true; more; ) {
    more = false;
    for (const bucket of buckets) {
      if (bucket.length) {
        pending.push(bucket.shift());
        more = true;
      }
    }
  }
  let done = 0;
  for (const { ev, seed } of pending) {
    if (signal?.aborted) break;
    const result = await geocodePlace(ev.place, seed);
    if (result === undefined || result === null) {
      ev.geocodeStatus = 'failed';
    } else {
      ev.lat = result.lat;
      ev.lng = result.lng;
      ev.geocodeStatus = 'ok';
      ev.precision = result.precision ?? null;
    }
    done++;
    onProgress?.(done, pending.length);
  }
  return { total: pending.length };
}

export function countPendingGeocodes(tree) {
  let n = 0;
  for (const person of Object.values(tree.people)) {
    for (const ev of allEventsOf(person)) {
      if (ev.place && ev.geocodeStatus === 'pending') n++;
    }
  }
  return n;
}
