// Leaflet + OpenStreetMap rendering - no API key needed. Color always comes from a
// person's lineage. Two different pictures depending on whether the timeline is
// engaged (see main.js, `currentYear`):
//
// - "Show all, ignore time": every geocoded waypoint (birth, any places lived, death)
//   is its own always-on dot - the complete picture at once, with no connecting lines
//   between a person's own waypoints (only the gold overlap-lead lines, further down,
//   ever draw a line on the map).
// - Scrubbing or playing the timeline: each person collapses to exactly ONE dot,
//   gliding smoothly along their own route as `currentYear` changes (see
//   interpolatedPosition in model/presence.js) - no trailing path sketched in behind
//   it, just the live dot. This is what makes two different people's paths actually
//   crossing read as a moving collision rather than a static overlap of several
//   simultaneously-lit markers.

import {
  lifeWaypoints,
  inferredPresenceIntervals,
  isPersonActiveInYear,
  interpolatedPosition,
  interpolateAmongPoints,
} from '../model/presence.js';
import { buildIndices } from '../model/graph.js';

let map = null;
let dotsLayer = null;
let overlapLayer = null;
let pulseLayer = null;
let overlapStarLayer = null;

// Water and land start too close in raw lightness in stock OSM tiles (measured:
// water ~rgb(182,216,225), land ~rgb(242,239,233) - only ~30 points apart out of 255)
// for any CSS filter/blend-mode trick to darken one without darkening the other by
// nearly as much; a global filter can shift hue but can't selectively target "the blue
// pixels" while leaving cream pixels alone. So this recolors per-pixel instead: each
// tile loads as a plain image, gets read onto an offscreen canvas, and every pixel
// classified by how much bluer than red it is (OSM's water is consistently the one
// classification of feature where blue clearly leads red - land, roads, and parks
// never are) gets blended toward this app's own dark navy in proportion to that -
// a hard 0/1 cutoff would leave visibly jagged edges at every coastline, so it's a
// smooth ramp instead. Land pixels (blueness at or below the low end of that ramp)
// are untouched.
const WATER_TINT = [0x22, 0x46, 0x53]; // --blackthorn-berry
const WATER_RAMP_START = 5; // blue-minus-red below this: definitely not water, left alone
const WATER_RAMP_END = 25; // blue-minus-red at or above this: fully tinted

// Precomputed once rather than recomputed per pixel: blueness (b - r, always an integer
// 0-255 by the time a pixel reaches this lookup - the loop below already `continue`s
// past anything at or below WATER_RAMP_START, which covers every negative value too)
// maps straight to its blend factor. A single zoom gesture can create dozens of tiles
// across several zoom levels at once (see updateWhenZooming below), each running this
// over its own 65536 pixels, so trading a per-pixel division+clamp for an array read
// adds up - most visibly on ocean-heavy tiles, where most pixels take this path at all.
const RAMP_LUT = new Float32Array(256);
for (let b = 0; b < 256; b++) {
  RAMP_LUT[b] = b <= WATER_RAMP_START ? 0 : Math.min(1, (b - WATER_RAMP_START) / (WATER_RAMP_END - WATER_RAMP_START));
}

function tintWaterPixels(imageData) {
  const px = imageData.data;
  for (let i = 0; i < px.length; i += 4) {
    const blueness = px[i + 2] - px[i]; // b - r
    if (blueness <= WATER_RAMP_START) continue;
    const t = RAMP_LUT[blueness];
    px[i] += (WATER_TINT[0] - px[i]) * t;
    px[i + 1] += (WATER_TINT[1] - px[i + 1]) * t;
    px[i + 2] += (WATER_TINT[2] - px[i + 2]) * t;
  }
  return imageData;
}

const TILE_SUBDOMAINS = ['a', 'b', 'c'];

// Every tile's already-tinted pixels, keyed by its own URL - a second visit to a
// region (panning back, zooming out then back in, or the timeline camera revisiting
// somewhere) redraws instantly from this instead of re-fetching and re-processing from
// scratch. Unbounded: a genealogy map's own usage pattern is revisiting a handful of
// regions repeatedly within one tab's lifetime, not panning across thousands of unique
// tiles, so the memory this holds onto in practice stays modest without needing an
// eviction policy.
const tileCache = new Map();

// A GridLayer (not the simpler L.tileLayer) specifically because tinting needs to
// intercept each tile's actual pixels via canvas - L.tileLayer only ever hands you an
// <img>, with no post-load processing hook. Falls back to the untouched tile if
// reading its pixels ever throws (e.g. a future CORS policy change on OSM's end) -
// same "never let a map dependency hard-break the app" reasoning as picking stock OSM
// over a keyed provider in the first place, just for pixel access instead of the tile
// request itself.
// GridLayer's own _initTile sets each tile's CSS width/height to the exact nominal
// tile size, synchronously, right after createTile returns - so growing a tile's CSS
// box has to happen in a callback that runs later than that (a fresh microtask does),
// or _initTile just overwrites it straight back to the seam-prone exact size.
function growTileBox(canvas, size) {
  queueMicrotask(() => {
    canvas.style.width = `${size.x + 1}px`;
    canvas.style.height = `${size.y + 1}px`;
  });
}

const WaterTintLayer = window.L.GridLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize();
    const canvas = document.createElement('canvas');
    canvas.width = size.x;
    canvas.height = size.y;
    // willReadFrequently steers the browser toward the software (CPU) rendering path
    // for this canvas instead of the GPU-accelerated one - normally the wrong choice,
    // but this canvas does a getImageData+putImageData round trip on every tile, which
    // the software path handles considerably faster than paying a GPU readback cost
    // each time. Directly relevant to the actual bug report here: readback is the slow
    // step that made zooming/dragging outrun already-in-flight tiles most visibly.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const subdomain = TILE_SUBDOMAINS[Math.abs(coords.x + coords.y) % TILE_SUBDOMAINS.length];
    const url = `https://${subdomain}.tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.png`;

    const cached = tileCache.get(url);
    if (cached) {
      ctx.putImageData(cached, 0, 0);
      growTileBox(canvas, size);
      done(null, canvas);
      return canvas;
    }

    // A freshly-created canvas is fully transparent until something is actually drawn
    // to it - Leaflet adds this tile to the grid immediately (createTile returns it
    // synchronously, well before the image below has actually loaded), so without
    // this fill, an in-flight tile was a see-through gap showing the page's own bright
    // background straight through - exactly the "white line/patch" artifact, and far
    // more noticeable while actively zooming or dragging (many tiles in flight at
    // once) than sitting still. This is the same neutral gray Leaflet's own tiles
    // fall back to while loading, so an in-flight tile now reads as "still loading,"
    // not as something broken.
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, size.x, size.y);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size.x, size.y);
      try {
        const tinted = tintWaterPixels(ctx.getImageData(0, 0, size.x, size.y));
        ctx.putImageData(tinted, 0, 0);
        tileCache.set(url, tinted);
      } catch {
        // Pixel access failed - the plain drawImage above already put the untinted
        // tile on the canvas, so there's still a correct (just uncolored) map tile.
        // Deliberately not cached: a transient failure shouldn't permanently freeze
        // this tile at its untinted version for the rest of the session.
      }
      // Grown by exactly 1px (not centered - just extending past the right/bottom
      // edge) so this tile's box slightly overlaps the tiles to its right and below,
      // covering the hairline gap that opens up at tile seams once Leaflet's zoom/pan
      // transform applies a fractional-pixel CSS scale to the whole tile pane mid-
      // transition. A plain <img> tile never shows this (the browser's own scaling
      // already blends adjacent images' edge pixels together); a <canvas> tile is hard-
      // clipped to its own box and needs this nudge to get the same effect. The very
      // slight upscale this causes (256px of source stretched to fill 257px) is well
      // below what's visible at any tile's normal on-screen size.
      growTileBox(canvas, size);
      done(null, canvas);
    };
    img.onerror = () => done(new Error(`Tile load failed: ${url}`), canvas);
    img.src = url;
    return canvas;
  },
});

// Real map data only exists between these latitudes (Web Mercator's own hard limit,
// just past where Greenland/Antarctica already look absurdly stretched) - past them
// there's nothing to show but Leaflet's own bare gray container background. Dragging
// there was always technically possible, but the taller map panel (see .map-row in
// layout.css) made it easy to do by accident, and once there, that gray area could
// sit right under the "Map & timeline" label pinned to the panel's own top-left corner.
// maxBounds stops the drag before it ever reaches that gray - worldCopyJump keeps
// panning horizontally forever (so this only actually constrains north/south), and
// none of this touches scroll-to-zoom, which is a separate interaction.
const MAP_MAX_BOUNDS = [
  [-85, -Infinity],
  [85, Infinity],
];

export function initMap(containerId) {
  map = window.L.map(containerId, {
    worldCopyJump: true,
    maxBounds: MAP_MAX_BOUNDS,
    maxBoundsViscosity: 1.0,
    // Leaflet's default SVG renderer gives every circleMarker/polyline its own DOM
    // element - fine for a handful of dots, but renderMarkers (below) creates one per
    // geocoded waypoint, which for a real tree can be well into the thousands. That was
    // invisible for as long as most events had no coordinates yet to draw a dot for at
    // all; once they do, thousands of individual SVG elements is a multi-second
    // synchronous block on every single refresh() (confirmed: ~1.2s for the sample
    // tree's ~1,900 waypoints). Canvas draws every marker into one shared bitmap
    // instead of one DOM node each - the standard fix for exactly this, and doesn't
    // change how anything looks, only how it's drawn. Tile layers (the water-tinted
    // basemap) are unaffected either way - this only governs vector layers like dots
    // and the gold overlap lines.
    preferCanvas: true,
    // Whole-number-only zoom (Leaflet's default) means fitBounds can only ever pick
    // from zoom 2, 3, 4... - each one double the scale of the last - so a spread whose
    // true best-fit zoom is, say, 2.6 gets rounded all the way down to 2 rather than
    // landing anywhere close to 2.6, since 3 would already crop something out. That
    // rounding-down is the single biggest source of "why is there so much unused
    // margin" - fractional zoom lets fitBounds land on 2.6 itself instead.
    zoomSnap: 0.1,
  }).setView([25, 10], 2);
  // Stock OSM tiles specifically - genuinely keyless with no account/signup of any
  // kind, unlike most alternative tile providers (including CARTO's own basemaps,
  // tried here once and reverted: their tiles now watermark "API KEY REQUIRED"
  // without one).
  new WaterTintLayer({
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
    // Both defaults this overrides exist to cut down how many tiles a single zoom
    // gesture creates - each one is real work here (fetch, canvas readback, a per-pixel
    // tint pass), unlike a plain <img> tile layer where more tiles is nearly free.
    // updateWhenZooming defaults to true, which has Leaflet fetch and process a full
    // fresh set of tiles at EVERY integer zoom level crossed mid-gesture, not just the
    // one you land on - scrolling quickly through several levels multiplied the work by
    // however many levels that was. false shows the current tiles CSS-scaled during the
    // motion instead, and only fetches/tints the level you actually land on, once,
    // after the gesture settles - the single biggest lever on "zooming feels slow".
    updateWhenZooming: false,
    // keepBuffer (default 2) preloads that many extra rows/columns of tiles around the
    // viewport so panning just past the edge doesn't flash blank - halved here since
    // each of those tiles costs real tint-processing time too, and this map is
    // scrolled/zoomed through far more than it's panned around within one view.
    keepBuffer: 1,
  }).addTo(map);
  dotsLayer = window.L.layerGroup().addTo(map);
  overlapLayer = window.L.layerGroup().addTo(map);
  overlapStarLayer = window.L.layerGroup().addTo(map);
  pulseLayer = window.L.layerGroup().addTo(map);
  return map;
}

export function getMap() {
  return map;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function popupHtml(person, lineage, { label, place, precision } = {}) {
  const years = [person.birth.year, person.death.year].filter((y) => y != null).join(' – ');
  return `<div class="map-popup">
    <strong>${escapeHtml(person.name || '(unnamed)')}</strong>
    ${years ? `<div class="map-popup-years">${escapeHtml(years)}</div>` : ''}
    ${lineage ? `<div class="map-popup-lineage" style="color:${lineage.color}">${escapeHtml(lineage.name)}</div>` : ''}
    ${place ? `<div>${label ? escapeHtml(label) + ': ' : ''}${escapeHtml(place)}</div>` : ''}
    ${
      precision === 'broad'
        ? `<div class="map-popup-broad-note">⚠ Only a state/country-level match - this dot marks the middle of that whole region, not a real pinpoint.</div>`
        : ''
    }
    <button type="button" class="btn btn-secondary btn-sm map-popup-edit" data-person-id="${person.id}">Edit person</button>
  </div>`;
}

const RADIUS_BY_LABEL = { Born: 7, Died: 5 };

function inferredPointsFor(tree, indices, person) {
  return inferredPresenceIntervals(tree, indices, person)
    .map((iv) => ({ lat: iv.lat, lng: iv.lng, year: iv.year, label: `Inferred (${iv.sourceLabel})`, place: iv.place, precision: iv.precision }))
    .sort((a, b) => a.year - b.year);
}

// Inferred people (no records of their own - see model/presence.js) get the exact same
// solid dot as everyone else, not a faded/dashed "ghost" marker - the popup already
// says "Inferred (via ...)" so the provenance is there if you look, without the dot
// itself reading as spooky or looking broken. A BROAD-precision position is different:
// that's not "we borrowed this from a relative," it's "the only geocode we have for
// this point is a whole state or country" - showing that as a plain, full-confidence
// dot is what put a rock-solid-looking pin in the geographic middle of Canada for
// someone whose only record just said "Canada." Rendered hollow (unfilled ring, no
// solid center) instead, at the SAME real coordinates - still exactly where the data
// says, just visibly not a precise fix.
function addMovingDot(person, lineage, color, pos) {
  const latLng = [pos.lat, pos.lng];
  const isBroad = pos.precision === 'broad';
  const m = window.L.circleMarker(latLng, {
    radius: isBroad ? 9 : 7,
    color,
    weight: isBroad ? 2 : 1.5,
    fillColor: color,
    fillOpacity: isBroad ? 0 : 0.95,
    opacity: isBroad ? 0.65 : 0.95,
    dashArray: isBroad ? '2,3' : null,
  });
  // Lazy for the same reason as the waypoint dots below (renderMarkers) - and doubly so
  // here, since this path also runs on every single timeline animation tick for every
  // person currently active, not just once per render.
  m.on('click', function bindOnFirstClick() {
    m.off('click', bindOnFirstClick);
    m.bindPopup(popupHtml(person, lineage, { label: pos.label, place: pos.place, precision: pos.precision })).openPopup();
  });
  m.addTo(dotsLayer);
  return latLng;
}

// Returns both the full set of plotted [lat,lng] pairs (for the one-time "fit
// everyone" view) and just the ones currently on-screen for this year (for the
// timeline's camera-follow, which should track only who's part of the story at this
// point in time, not the whole dataset) - each carrying its own personId so the
// camera-follow logic in main.js can tell "the cast changed" apart from "someone's
// dot moved a little further along their own route," which needs a very different
// response (see followActiveBounds there).
export function renderMarkers(tree, { currentYear = null, visibleLineageIds = null, overlapGroups = [] } = {}) {
  dotsLayer.clearLayers();
  overlapLayer.clearLayers();
  const bounds = [];
  const activeBounds = [];
  const indices = buildIndices(tree);

  for (const person of Object.values(tree.people)) {
    if (visibleLineageIds && !visibleLineageIds.has(person.lineageId)) continue;
    const lineage = tree.lineages[person.lineageId];
    const color = lineage?.color || '#7d8f95'; // unassigned - neutral, not in the named palette
    const waypoints = lifeWaypoints(person).filter((wp) => wp.ev.lat != null && wp.ev.lng != null);

    if (currentYear != null) {
      // Just the one live dot per person while the timeline's engaged - no trailing
      // path sketched in behind it. The dot moving through real collisions is the
      // point; a faint line retracing where it's already been only clutters that up.
      if (waypoints.length) {
        const pos = interpolatedPosition(person, currentYear);
        if (pos) {
          const latLng = addMovingDot(person, lineage, color, pos);
          bounds.push(latLng);
          activeBounds.push({ latLng, personId: person.id });
        }
      } else if (isPersonActiveInYear(person, currentYear)) {
        const pos = interpolateAmongPoints(inferredPointsFor(tree, indices, person), currentYear);
        if (pos) {
          const latLng = addMovingDot(person, lineage, color, pos);
          bounds.push(latLng);
          activeBounds.push({ latLng, personId: person.id });
        }
      }
      continue;
    }

    // "Show all, ignore time" - every geocoded waypoint is its own always-on dot.
    if (!waypoints.length) {
      for (const iv of inferredPointsFor(tree, indices, person)) {
        const latLng = addMovingDot(person, lineage, color, iv);
        bounds.push(latLng);
      }
      continue;
    }

    // Every waypoint is its own dot, with no connecting line between them - the gold
    // dashed lines are reserved for actual overlap leads (see below); a same-color
    // dashed line between a person's own waypoints read as just as "ghostly" as the
    // trailing path the timeline animation used to draw.
    for (const wp of waypoints) {
      const latLng = [wp.ev.lat, wp.ev.lng];
      const isBroad = wp.ev.precision === 'broad';
      const radius = isBroad ? (RADIUS_BY_LABEL[wp.label] ?? 6) + 2 : RADIUS_BY_LABEL[wp.label] ?? 6;
      // Same hollow-ring treatment as the timeline's own moving dot (see addMovingDot) -
      // a state/country-centroid guess shouldn't look as confident as a real city fix,
      // in "Show all" just as much as mid-animation.
      const m = window.L.circleMarker(latLng, {
        radius,
        color,
        weight: isBroad ? 2 : 1.5,
        fillColor: color,
        fillOpacity: isBroad ? 0 : wp.label === 'Died' ? 0.78 : 0.92,
        opacity: isBroad ? 0.65 : 0.92,
        dashArray: isBroad ? '2,3' : null,
      });
      // Popup content is built and bound on first click, not here - bindPopup's own
      // setup cost (a Popup instance, its DOM wiring) is trivial for a handful of
      // markers but adds up fast multiplied across every waypoint in a real tree (the
      // sample tree alone draws roughly 1,900 of these dots on the very first render).
      // A person only ever clicks a tiny fraction of their own dots, so paying that
      // cost for all of them up front - most of which nobody will ever open - was pure
      // waste. Bound once per marker (not rebuilt on every click) since the same
      // person/waypoint never needs a second bindPopup call.
      m.on('click', function bindOnFirstClick() {
        m.off('click', bindOnFirstClick);
        m.bindPopup(popupHtml(person, lineage, { label: wp.label, place: wp.ev.place, precision: wp.ev.precision })).openPopup();
      });
      m.addTo(dotsLayer);
      bounds.push(latLng);
    }
  }

  for (const group of overlapGroups) {
    const members = group.members.filter((m) => !visibleLineageIds || visibleLineageIds.has(m.lineageId));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        window.L.polyline(
          [
            [members[i].lat, members[i].lng],
            [members[j].lat, members[j].lng],
          ],
          { color: '#c4a524', weight: 2, opacity: 0.85, dashArray: '1,7' }
        ).addTo(overlapLayer);
      }
    }
  }

  return { bounds, activeBounds };
}

export function fitToBounds(bounds) {
  if (!map || !bounds.length) return;
  // animate: false - a snap-to-fit reads fine here; there's nothing to visually track
  // continuity with on a first render, and it's one less thing redrawing every frame
  // while a large tree's worth of markers are already on screen.
  map.fitBounds(bounds, { padding: [16, 16], maxZoom: 18, animate: false });
}

// Follows the timeline: recenters/zooms on whoever is currently active, as tightly as
// the spread of their locations allows - a single present-day person zooms in close; a
// cast spread across two continents pulls back exactly as far as fitting BOTH of them
// requires, no further (tight padding, not a fixed "safe" zoom-out level) - showing
// everyone currently part of the story, including how far apart they actually are, is
// the point of this map, not something to hide for a tighter-looking shot. maxZoom
// caps how close a lone point (or a tight cluster) zooms in - high enough to read as
// "as zoomed in as it can be," not so high it lands on a single rooftop.
export function followBounds(bounds, { maxZoom = 15, durationSeconds = 0.8 } = {}) {
  if (!map || !bounds.length) return;
  if (bounds.length === 1) {
    map.flyTo(bounds[0], maxZoom, { duration: durationSeconds });
  } else {
    map.flyToBounds(bounds, { padding: [50, 50], maxZoom, duration: durationSeconds });
  }
}

// How long a collision star stays on screen before it fades itself out - well past its
// own "bang" (see collision-star-bang in components.css), long enough to actually
// notice mid-playback without needing to pause for it.
const COLLISION_STAR_LIFETIME_MS = 2600;
let activePulses = []; // [{ marker, timer }] - one per currently-showing collision star

// A gold star that bangs in, holds, then fades - at the point where two family trees'
// paths cross. Unlike the single-slot pulse this replaced, multiple can be alive at
// once (see checkForCollisions in main.js, which no longer stops at the first match
// per frame) - each just adds itself to pulseLayer and removes itself on its own timer,
// independent of any others already showing.
export function spawnCollisionStar(lat, lng, color) {
  const icon = window.L.divIcon({
    className: 'collision-star-icon',
    html: `<span class="collision-star" style="--pulse-color:${color}">★</span>`,
    iconSize: [1, 1],
  });
  const marker = window.L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(pulseLayer);
  const timer = setTimeout(() => {
    pulseLayer.removeLayer(marker);
    activePulses = activePulses.filter((p) => p.marker !== marker);
  }, COLLISION_STAR_LIFETIME_MS);
  activePulses.push({ marker, timer });
}

// Used when scrubbing or resetting the timeline - any stars mid-animation from
// wherever playback just was are no longer meaningful once the year jumps elsewhere.
export function clearAllCollisionPulses() {
  for (const { marker, timer } of activePulses) {
    clearTimeout(timer);
    pulseLayer.removeLayer(marker);
  }
  activePulses = [];
}

// Persistent (unlike spawnCollisionStar's transient bang-and-fade), one per qualifying
// possible-overlap group - see computeNumberedOverlaps in main.js for what qualifies
// and how numbers get assigned. Redrawn from scratch on every call, same pattern as
// the rest of renderMarkers' layers, so it never needs its own separate diffing logic.
export function renderOverlapStars(numberedGroups) {
  overlapStarLayer.clearLayers();
  for (const { group, isAllLines, number } of numberedGroups) {
    const lat = group.members.reduce((sum, m) => sum + m.lat, 0) / group.members.length;
    const lng = group.members.reduce((sum, m) => sum + m.lng, 0) / group.members.length;
    const numberBadge = number ? `<span class="overlap-star-number">${number}</span>` : '';
    const icon = window.L.divIcon({
      className: 'overlap-star-icon',
      html: `<span class="overlap-star ${isAllLines ? 'is-all-lines' : 'is-partial'}">★${numberBadge}</span>`,
      iconSize: [1, 1],
    });
    window.L.marker([lat, lng], { icon, zIndexOffset: 900, keyboard: false }).addTo(overlapStarLayer);
  }
}
