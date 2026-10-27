// An ancestor-only fan chart: the focus person sits at the center, and each generation
// ring splits into father's half (left) / mother's half (right), recursively, using
// standard ahnentafel numbering (father of n = 2n, mother = 2n+1, following the same
// partnerIds[0]=father / partnerIds[1]=mother convention used everywhere else in this
// app). This is deliberately a different view from the card-based pedigree: only
// direct ancestors, no descendants/spouses/siblings, which is what makes the radial
// shape mean something.
//
// Color follows the great-grandparent generation (ahnentafel 8-15): each of the 8
// possible great-grandparents gets one hue from the app's own palette, and every one
// of THEIR OWN ancestors (further out) inherits that same hue, alternating between the
// full color and a lightened tint each generation so adjacent rings stay visually
// distinct without ever leaving the family's color. Root/parents/grandparents (who
// each belong to more than one great-grandparent's family) stay neutral, near-white.
//
// Two different text treatments by ring type: the neutral rings are wide (2 and 4
// slots) and close to the root, so their text renders flat/horizontal rather than
// curved along the wedge - easier to read for the generations you'll look at most.
// The colored rings get progressively thinner as they go out, so their text stays
// radially-oriented (the only way it fits at all past a few generations) but each
// ring is deliberately made thicker than the neutral ones to hold more of a name
// before truncating.
//
// The whole chart lives in a single SVG that fills its container, panned/zoomed with
// d3-zoom the same way the map and Cards view are - drag to move around, scroll/pinch
// to zoom - rather than being sized to fit statically, which is what let outer-ring
// wedges get too thin to hold readable text before. The current pan/zoom is kept across
// incidental re-renders (editing a person elsewhere doesn't recenter the view); only
// switching which person is focused or how many generations are shown resets it.

import { FAN_BRANCH_PALETTE } from '../util/color.js';
import { buildAhnentafel } from '../model/ahnentafel.js';

const GREAT_GRANDPARENT_COLORS = FAN_BRANCH_PALETTE;
const NEUTRAL_BY_GEN = ['#fffcf6', '#f2efe8', '#e4e9ea']; // root, parents, grandparents
const SVG_NS = 'http://www.w3.org/2000/svg';
// px of arc length below which a wedge shows no text at all (hover still shows the
// name via its <title>) - below this there's not enough room for even a short,
// recognizable fragment, so attempting text anyway just produces an illegible
// scratch. Better to show a clean, unlabeled wedge than a fragment nobody can read.
const MIN_ARC_FOR_TEXT = 45;

// Text that's readable at the default view still shrinks below use once you zoom out
// to see more generations at once - the whole chart is one SVG scaled as a unit, so
// zooming out shrinks the name text exactly as much as it shrinks everything else.
// These two constants let name/years text grow back toward a legible on-screen size as
// the view zooms out, WITHOUT ever re-measuring or re-trimming: each text's own safe
// ceiling (how far it could grow before its already-trimmed string would overflow its
// own wedge - see the fitQueue drain below) is computed once, right after trimming, so
// growing it later is provably safe with no further layout work per zoom tick.
const MIN_ONSCREEN_FONT_PX = 11; // floor: text is boosted to at least roughly this many CSS px on screen, if its wedge has any slack to allow it
const MAX_ZOOM_FONT_BOOST = 1.5; // ceiling: kept modest so a boosted name/years pair can't grow tall enough to run back into each other across their fixed radial gap
const RADIAL_TEXT_MARGIN_PX = 8; // how far a colored ring's combined name+years text sits in from the wedge's inner edge before reading outward
const CENTER_RADIUS = 50;
const NEUTRAL_RING_THICKNESS = 90; // gen 1-2 (parents, grandparents) - horizontal text needs less radial room
const COLORED_RING_THICKNESS = 150; // gen 3+ starting point - grown further per-ring below if that's not enough
const MAX_NAME_CHARS = 30; // "only clip for very long names" - this is the ceiling, not the target

// A colored ring grows past its COLORED_RING_THICKNESS starting point, in these steps,
// until at least this fraction of its own names+years render in full - up to the cap
// below. Below the cap, "grow the ring" directly answers "there's blank space AND
// names are still cut off": the real constraint was never radial room (there was
// plenty), it was the ring sitting too close to center for its angular slice to be
// wide enough - moving it outward (and, since every generation's rInner is the sum of
// every ring before it, this also gives EVERY later generation more room for free)
// fixes that. The cap exists because slot count doubles every generation while total
// angle doesn't - past a certain depth, no amount of growing reaches 80% before the
// chart itself would balloon to an unusable size, so those rings fall back to trimming
// (fitTextToWidth) instead, same as before.
const MIN_FULL_FIT_RATIO = 0.8;
const RING_GROWTH_STEP = 24;
const MAX_COLORED_RING_THICKNESS = 700;
// Above this many slots a ring is almost entirely empty (see the matching cap on
// drawing DOM nodes further down) - not worth measuring real names for.
const THICKNESS_MEASURE_SLOT_CAP = 4096;
// Only rings this shallow or shallower (gen 3-5, 8/16/32 slots) get a vote in the
// shared thickness search below - past 32 slots, a ring's own angular slice keeps
// halving every generation while the shared thickness search has already found
// whatever it's going to find, so letting a hopeless deep ring (it would need a huge
// thickness to hit 80% even alone, let alone shared) keep demanding more only bloats
// every ring - including the ones that were already satisfied - chasing a target nothing
// past this depth can reach anyway. Deep rings still get the resulting shared
// thickness and still fall back to trimming (fitTextToWidth) when it isn't enough.
const UNIFORM_FIT_TARGET_SLOT_CAP = 32;

// The default "fit everything" zoom targets at most the radius through this generation,
// not the tree's real outerMost - a tree with real ancestry going back 15-20
// generations would otherwise force the whole chart down to a scale where even the
// readable early rings shrink to illegible slivers, just to make room for depths
// nobody's looking at by default. Set well above every fixed option the generations
// dropdown actually offers (5-9, i.e. maxGen 4-8) so any of those always fits its FULL
// requested depth on load rather than just an inner slice of it - this only needs to
// step in for "All generations" on a genuinely deep tree. Panning/zooming out still
// reaches every deeper generation regardless - this only bounds the view you land on
// before you do.
const DEFAULT_FIT_MAX_GEN = 10;

// The fan opens wider than a flat semicircle: each side angles another 20° past
// horizontal (down and slightly back in), so the two ends dip below the root instead
// of the whole shape reading as a hard half-circle with a straight bottom edge.
const DOWNWARD_ANGLE = 20;
const HALF_SPAN = 90 + DOWNWARD_ANGLE;

let savedTransform = null;
let savedKey = null; // `${rootId}:${maxGen}` - a change here means the shape changed, so re-center instead of preserving pan/zoom

// Forces the next renderFanChart call to recompute its own default fit/center instead
// of reusing whatever pan/zoom was saved - needed on a window resize, since the panel's
// own pixel size (availW/availH below) changed under it, so the OLD saved transform no
// longer actually centers anything. Without this, resizing the browser after the fan
// has already rendered once would silently leave it off-center until something else
// (switching root, changing generation count) happened to force a re-fit anyway.
export function resetFanFit() {
  savedTransform = null;
  savedKey = null;
}

// The currently-rendered chart's own SVG/zoom-layer/zoom-behavior, kept so
// pulseFanPerson (called later, from a completely separate UI action - the sidebar
// search) can pan/zoom to and flash a wedge without renderFanChart needing to hand
// anything back to its caller.
let currentSvg = null;
let currentZoomLayer = null;
let currentZoomBehavior = null;

// A persistent, invisible (but laid-out - position:fixed off-screen, not display:none)
// scratch element purely for asking the browser "how wide would this text actually
// render", independent of wherever the real chart's own SVG is in its own lifecycle -
// reused across renders and across ring-thickness decisions rather than recreated per
// call. Shares the `fan-wedge-text` class so it picks up the exact same font as the
// real name text it's standing in for.
let scratchTextEl = null;
function measureTextWidth(text, fontSize) {
  if (!scratchTextEl) {
    const scratchSvg = svgEl('svg', { style: 'position:fixed; left:-9999px; top:-9999px; width:10px; height:10px; overflow:visible;' });
    scratchTextEl = svgEl('text', { class: 'fan-wedge-text' });
    scratchSvg.appendChild(scratchTextEl);
    document.body.appendChild(scratchSvg);
  }
  scratchTextEl.setAttribute('font-size', fontSize);
  scratchTextEl.textContent = text;
  return scratchTextEl.getComputedTextLength();
}

function collectRingPeople(tree, ahnentafel, gen) {
  const slots = Math.pow(2, gen);
  if (slots > THICKNESS_MEASURE_SLOT_CAP) return [];
  const people = [];
  for (let idx = 0; idx < slots; idx++) {
    const person = tree.people[ahnentafel.get(slots + idx)];
    if (person) people.push(person);
  }
  return people;
}

// One shared thickness for EVERY colored ring, so the rings themselves read as a
// regular, even set of bands rather than each one being sized just for its own
// content - a uniform ring that's a little more generous than gen 3 strictly needs
// reads as intentional; rings of visibly different width reads as a rendering
// accident. Found by searching upward from COLORED_RING_THICKNESS, in
// RING_GROWTH_STEP steps, for the smallest thickness at which EVERY measurable
// colored ring (see THICKNESS_MEASURE_SLOT_CAP) independently clears
// MIN_FULL_FIT_RATIO - since a bigger shared thickness pushes every ring's own
// rInner outward too, this is monotonic (never makes a ring's fit worse), so the
// first thickness where every ring passes is the smallest one that works for all of
// them at once. Generations deep enough that no reasonable thickness gets them to
// 80% (slot count keeps doubling; total angle doesn't) are what push this all the way
// to the cap - at that point every ring shares the cap, and those specific deep rings
// still fall back to trimming (fitTextToWidth) same as before.
function decideUniformColoredThickness(tree, ahnentafel, maxGen, neutralOuterRadius) {
  const ringsData = [];
  for (let gen = 3; gen <= maxGen && Math.pow(2, gen) <= UNIFORM_FIT_TARGET_SLOT_CAP; gen++) {
    const people = collectRingPeople(tree, ahnentafel, gen);
    if (!people.length) continue;
    const angleSpanRad = (2 * HALF_SPAN * Math.PI) / 180 / Math.pow(2, gen);
    // Matches the render: one combined "Name · Years" string, read radially, measured
    // at the same font-size renderFanChart actually draws it at.
    const needs = people.map((p) => {
      const yl = yearsLabel(p);
      return measureTextWidth(`${p.name || '(unnamed)'}${yl ? ' · ' + yl : ''}`, 14);
    });
    ringsData.push({ gen, angleSpanRad, needs });
  }
  if (!ringsData.length) return COLORED_RING_THICKNESS;

  let thickness = COLORED_RING_THICKNESS;
  while (thickness < MAX_COLORED_RING_THICKNESS) {
    const allMeetTarget = ringsData.every(({ gen, angleSpanRad, needs }) => {
      const rInner = neutralOuterRadius + (gen - 3) * thickness;
      // Text reads outward (radially) from just inside rInner, so the budget is the
      // ring's own thickness, not an angle-times-radius arc length - that was the old
      // (wrong) tangential-reading model. Still needs to clear the angular gate too:
      // a wedge too narrow at its inner edge can't hold even one line of text, no
      // matter how much radial room the ring has.
      if (angleSpanRad * rInner < MIN_ARC_FOR_TEXT) return false;
      const budget = thickness - RADIAL_TEXT_MARGIN_PX - 10;
      return needs.filter((w) => w <= budget).length / needs.length >= MIN_FULL_FIT_RATIO;
    });
    if (allMeetTarget) break;
    thickness += RING_GROWTH_STEP;
  }
  return thickness;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Perceived-brightness heuristic (standard luma weights) - not color-accurate, just
// good enough to decide whether the app's normal dark-navy wedge text stays readable on
// a given fill. It stops being readable on the palette's darker, more saturated colors
// (one of them - Blackthorn Berry - is literally the same navy as the text itself), so
// those wedges swap to a light, warm off-white instead: the same color the app already
// uses for text on its other dark/solid-accent surfaces.
const LIGHT_TEXT = '#f9f8f4';
const LIGHT_TEXT_MUTED = 'rgba(249, 248, 244, 0.72)';
function isDark(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 145;
}

function colorForNode(n, gen) {
  if (gen < 3) return NEUTRAL_BY_GEN[gen];
  const gen3Ancestor = Math.floor(n / Math.pow(2, gen - 3));
  const colorIndex = (gen3Ancestor - 8) % GREAT_GRANDPARENT_COLORS.length;
  const base = GREAT_GRANDPARENT_COLORS[colorIndex];
  return (gen - 3) % 2 === 0 ? base : lighten(base, 0.42);
}

function yearsLabel(person) {
  const b = person.birth?.year;
  const d = person.death?.year;
  return b || d ? `${b ?? '?'}–${d ?? '?'}` : '';
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
}

// Places radially-oriented text so it always reads right-side-up: the right half
// (maternal, theta > 0) reads outward from center in the natural direction; the left
// half (paternal, theta < 0) gets rotated 180° further and right-aligned so it's never
// upside down, which flips its reading direction to outward-from-the-rim instead - the
// standard fan-chart convention, and why the two sides in the reference image read in
// opposite directions.
function textTransformFor(thetaDeg, radius) {
  const flip = thetaDeg < 0;
  const rotate = flip ? thetaDeg + 90 : thetaDeg - 90;
  const tx = flip ? -radius : radius;
  const anchor = flip ? 'end' : 'start';
  return { rotate, tx, anchor };
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function polar(thetaDeg, r) {
  const rad = (thetaDeg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
}

function wedgePath(thetaStart, thetaEnd, rInner, rOuter) {
  const [x1, y1] = polar(thetaStart, rOuter);
  const [x2, y2] = polar(thetaEnd, rOuter);
  const largeArc = thetaEnd - thetaStart > 180 ? 1 : 0;
  if (rInner <= 0.01) {
    return `M 0 0 L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }
  const [x3, y3] = polar(thetaEnd, rInner);
  const [x4, y4] = polar(thetaStart, rInner);
  return [
    `M ${x4} ${y4}`,
    `L ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

// `onAddParent(childId, slot)` fills in one missing father/mother box for an empty
// wedge, same as Cards view's placeholder cards - only offered when the wedge's own
// child (one generation closer to root) is a known person, since otherwise there's no
// one to attach the new parent to.
// Shown instead of the real chart before any starting person exists, so the very first
// thing you see already reads as "this is where your family radiates out from" rather
// than an empty rectangle - same root-wedge shape/size the real chart uses, just dashed
// and unlabeled. Click anywhere on it to add that first person.
export function renderBlankFanPlaceholder(container, onAddRoot) {
  container.innerHTML = '';
  currentSvg = null;
  currentZoomLayer = null;
  currentZoomBehavior = null;
  const radius = CENTER_RADIUS * 1.6;
  const svg = svgEl('svg', { class: 'fan-svg', viewBox: `${-radius - 20} ${-radius - 20} ${radius * 2 + 40} ${radius * 2 + 40}` });
  const g = svgEl('g');
  svg.appendChild(g);

  // A true circle, not a wedge (see the same note in renderFanChart's root shape) - the
  // "Add your starting person" label sits south of center, which a wedge this shape
  // never fills at x=0.
  const shape = svgEl('circle', { cx: 0, cy: 0, r: radius, class: 'fan-root-circle fan-root-blank' });
  shape.addEventListener('click', () => onAddRoot?.());
  g.appendChild(shape);
  appendCenteredText(g, 0, -8, '+', 'fan-blank-plus', 36);
  appendCenteredText(g, 0, 34, 'Add your starting person', 'fan-wedge-text fan-blank-label', 13);

  container.appendChild(svg);
}

export function renderFanChart(container, tree, indices, rootId, { maxGen = 5, onPersonClick, onAddParent } = {}) {
  container.innerHTML = '';
  currentSvg = null;
  currentZoomLayer = null;
  currentZoomBehavior = null;
  if (!rootId || !tree.people[rootId]) {
    container.innerHTML = '<p class="empty-state" style="padding:24px;">Pick a starting person to see their fan chart.</p>';
    return;
  }

  const ahnentafel = buildAhnentafel(tree, indices, rootId, maxGen);

  // The two neutral rings keep their own fixed, close-in thickness; every colored ring
  // past them shares ONE thickness (decideUniformColoredThickness) so the rings read as
  // an even, regular set of bands rather than each being sized to just its own content.
  const radiusByGen = [CENTER_RADIUS, CENTER_RADIUS + NEUTRAL_RING_THICKNESS, CENTER_RADIUS + 2 * NEUTRAL_RING_THICKNESS];
  const coloredThickness = decideUniformColoredThickness(tree, ahnentafel, maxGen, radiusByGen[2]);
  for (let gen = 3; gen <= maxGen; gen++) radiusByGen.push(radiusByGen[gen - 1] + coloredThickness);
  const outerMost = radiusByGen[maxGen];

  // Real width-fitting (fitTextToWidth) needs getComputedTextLength, which needs the
  // element attached to a laid-out document - so every name is drawn full-length first
  // and queued here, then trimmed to fit in one pass right after `svg` joins the DOM
  // (see the drain below), instead of guessing a safe length up front.
  const fitQueue = [];

  const svg = svgEl('svg', { class: 'fan-svg' });
  const g = svgEl('g', { class: 'fan-zoom-layer' });
  svg.appendChild(g);

  // Root
  const rootPerson = tree.people[rootId];
  // A true circle, not a wedge like every ring past it - the rings all leave a gap at
  // the bottom (HALF_SPAN < 180°, so the fan opens wider than a semicircle but still
  // stops short of a full one - see the module comment above), and centered text/years
  // for the root would otherwise straddle that gap: at x=0, ANY point south of center is
  // outside a wedge no matter how small y is, since due-south (180°) sits outside
  // [-HALF_SPAN, HALF_SPAN] regardless of radius. A full circle here has no such gap, so
  // the name and years always render on solid fill.
  const rootShape = svgEl('circle', { cx: 0, cy: 0, r: CENTER_RADIUS, class: 'fan-root-circle', 'data-person-id': rootId });
  rootShape.addEventListener('click', () => onPersonClick?.(rootId));
  g.appendChild(rootShape);
  appendCenteredText(g, 0, -7, truncate(rootPerson.name || '(unnamed)', MAX_NAME_CHARS), 'fan-wedge-text', 12.5);
  const rootYears = yearsLabel(rootPerson);
  if (rootYears) appendCenteredText(g, 0, 11, rootYears, 'fan-wedge-text fan-wedge-years', 10);

  for (let gen = 1; gen <= maxGen; gen++) {
    const slots = Math.pow(2, gen);
    const rInner = radiusByGen[gen - 1];
    const rOuter = radiusByGen[gen];
    const isNeutral = gen <= 2;
    const ringThickness = rOuter - rInner;

    for (let idx = 0; idx < slots; idx++) {
      const n = slots + idx;
      const thetaStart = -HALF_SPAN + (idx / slots) * (2 * HALF_SPAN);
      const thetaEnd = -HALF_SPAN + ((idx + 1) / slots) * (2 * HALF_SPAN);
      const personId = ahnentafel.get(n);
      const person = personId ? tree.people[personId] : null;

      let addableSlot = null;
      if (!person) {
        const childN = Math.floor(n / 2);
        const childId = childN >= 1 ? ahnentafel.get(childN) : null;
        if (childId && tree.people[childId] && onAddParent) addableSlot = { childId, slot: n % 2 === 0 ? 'father' : 'mother' };
      }

      // Past a certain depth, "All" generations can mean hundreds of thousands of
      // slots per ring (real ancestry sometimes genuinely goes back 15-20 generations)
      // - almost all of them permanently empty and not even fillable (their own child
      // slot is unknown, so there's no one to attach a new parent to). Drawing an inert
      // wedge for each would hang the browser for no visual payoff; skip creating any
      // DOM node for those once a ring gets this large, while still drawing every real
      // person and every actually-addable empty slot at any depth.
      if (!person && !addableSlot && slots > 4096) continue;

      const attrs = { d: wedgePath(thetaStart, thetaEnd, rInner, rOuter), class: person ? 'fan-wedge' : 'fan-wedge is-empty' };
      const color = person ? colorForNode(n, gen) : null;
      if (color) attrs.fill = color;
      const wedge = svgEl('path', attrs);
      if (person) {
        wedge.dataset.personId = personId;
        wedge.addEventListener('click', () => onPersonClick?.(personId));
        const title = svgEl('title');
        const yl = yearsLabel(person);
        title.textContent = `${person.name || '(unnamed)'}${yl ? ' · ' + yl : ''}`;
        wedge.appendChild(title);
      } else if (addableSlot) {
        wedge.classList.add('is-addable');
        wedge.addEventListener('click', () => onAddParent(addableSlot.childId, addableSlot.slot));
        const title = svgEl('title');
        title.textContent = addableSlot.slot === 'father' ? '+ Add father' : '+ Add mother';
        wedge.appendChild(title);
      }
      g.appendChild(wedge);

      if (person) {
        const thetaMid = (thetaStart + thetaEnd) / 2;
        const midRadius = (rInner + rOuter) / 2;
        const rawName = person.name || '(unnamed)';
        const years = yearsLabel(person);
        // Only the colored rings (gen 3+) ever get dark/saturated enough for the app's
        // normal navy text to lose contrast - the neutral rings are all near-white, so
        // this is a no-op (null) for them. Applied below via el.style.fill, NOT
        // setAttribute('fill', ...): the `.fan-wedge-text` stylesheet rule sets `fill`
        // too, and a CSS rule beats a plain presentation attribute of the same name, so
        // the attribute alone is silently overridden - only an inline style wins.
        const textColor = color && isDark(color) ? LIGHT_TEXT : null;
        const yearsColor = color && isDark(color) ? LIGHT_TEXT_MUTED : null;

        if (isNeutral) {
          // Flat, horizontal text - no rotation - for the wide, close-in neutral
          // rings. Available width is generous here (only 2 or 4 slots total), so
          // this rarely trims anything - it's a safety net, not the common case.
          const [tx, ty] = polar(thetaMid, midRadius);
          const fontSize = 14;
          const nameEl = appendCenteredText(g, tx, ty - 4, rawName, 'fan-wedge-text', fontSize);
          if (textColor) nameEl.style.fill = textColor;
          const budget = ((thetaEnd - thetaStart) * Math.PI / 180) * midRadius - 10;
          let yearsEl = null;
          if (years) {
            yearsEl = appendCenteredText(g, tx, ty + 13, years, 'fan-wedge-text fan-wedge-years', 11.5);
            if (yearsColor) yearsEl.style.fill = yearsColor;
          }
          fitQueue.push({ el: nameEl, fullText: rawName, maxWidth: budget, fontSize, yearsEl, ringThickness });
        } else {
          // Text reads RADIALLY here - inner edge outward - not tangentially along the
          // arc. Verified directly: two text elements given the SAME rotation but
          // different radii rendered head-to-tail on one straight line, not as two
          // parallel rows, which means the radius parameter is what advances as
          // characters are read, and the other transform axis only shifts things
          // sideways (tangentially) within the wedge. That's also the right direction
          // to read in for this chart's actual proportions: every colored ring now
          // shares one generous, uniform thickness (decideUniformColoredThickness),
          // while the angular slice keeps halving every generation - so there's far
          // more room reading outward than there ever is reading sideways.
          const angleSpanRad = ((thetaEnd - thetaStart) * Math.PI) / 180;
          // The narrowest point along a radial run is its OWN inner edge (arc length
          // only grows with radius) - a wedge has to clear that just to hold one line
          // of text at all, independent of how much radial room it has.
          const arcAtInner = angleSpanRad * rInner;
          if (arcAtInner >= MIN_ARC_FOR_TEXT) {
            const fontSize = 14;
            const { rotate, tx, anchor } = textTransformFor(thetaMid, rInner + RADIAL_TEXT_MARGIN_PX);
            const combinedText = years ? `${rawName} · ${years}` : rawName;

            const nameText = svgEl('text', {
              class: 'fan-wedge-text',
              transform: `rotate(${rotate}) translate(${tx}, 4)`,
              'text-anchor': anchor,
              'font-size': fontSize,
            });
            if (textColor) nameText.style.fill = textColor;
            g.appendChild(nameText);
            fitQueue.push({
              el: nameText,
              fullText: combinedText,
              maxWidth: ringThickness - RADIAL_TEXT_MARGIN_PX - 10,
              fontSize,
              yearsEl: null,
              ringThickness,
            });
          }
        }
      }
    }
  }


  container.appendChild(svg);
  // Trim first, then measure each result ONCE to record how much further it could
  // safely grow (maxWidth / actual rendered width) before it would overflow its own
  // wedge - that ratio (capped) is what lets the zoom handler below grow text on the
  // fly with zero further measurement, so it stays cheap even during a fast zoom
  // gesture with hundreds of names on screen.
  const scaleAwareTexts = [];
  for (const { el, fullText, maxWidth, fontSize, yearsEl } of fitQueue) {
    fitTextToWidth(el, fullText, maxWidth);
    if (!fontSize || !el.textContent) continue;
    const actualWidth = el.getComputedTextLength();
    const safeBoost = actualWidth > 0 ? Math.min(MAX_ZOOM_FONT_BOOST, Math.max(1, maxWidth / actualWidth)) : 1;
    scaleAwareTexts.push({ el, fontSize, safeBoost });
    if (yearsEl) scaleAwareTexts.push({ el: yearsEl, fontSize: parseFloat(yearsEl.getAttribute('font-size')), safeBoost });
  }

  // Grows every name/years element back toward MIN_ONSCREEN_FONT_PX as the view zooms
  // out (k shrinks), never past what that specific element already proved safe above,
  // and never shrinks anything below its own authored size when zoomed in close.
  function applyZoomTextScale(k) {
    for (const { el, fontSize, safeBoost } of scaleAwareTexts) {
      const neededBoost = MIN_ONSCREEN_FONT_PX / (fontSize * k);
      const boost = Math.max(1, Math.min(safeBoost, neededBoost));
      el.style.fontSize = `${fontSize * boost}px`;
    }
  }

  // The fan is top-heavy, not symmetric: it extends a full outerMost straight up
  // (theta=0) but only dips outerMost*downFrac below center at its two widest points
  // (theta=±HALF_SPAN) - downFrac is ~0.34 at the current 110° half-span, nowhere near a
  // full outerMost. Centering the origin at the panel's vertical MIDDLE (as if the fan
  // were symmetric) was wasting the entire bottom half of the panel as blank space
  // while starving the scale that actually mattered - shrinking real names down to
  // unreadable slivers AND leaving big empty margins left/right (width was never the
  // tight dimension; height was). Fitting to the fan's true vertical extent instead,
  // with the origin placed low enough to use nearly the whole panel, lets the scale
  // grow to use the space that's actually there.
  const rect = container.getBoundingClientRect();
  const availW = rect.width || 600;
  const availH = rect.height || 400;
  const fitRadius = radiusByGen[Math.min(maxGen, DEFAULT_FIT_MAX_GEN)];
  const halfSpanRad = (HALF_SPAN * Math.PI) / 180;
  const halfWidthNeeded = fitRadius * Math.sin(halfSpanRad);
  const downFrac = Math.max(0, -Math.cos(halfSpanRad));
  const margin = 20;
  // FIT_SAFETY, not a bigger margin, absorbs the gap between this formula's pure wedge
  // radius and the actual rendered edge - wedge-name text has its own glyph extent past
  // its anchor point. margin appears in BOTH the scale AND the vertical origin below
  // (fitRadius * scale + margin) - growing it does shrink the fan a touch,
  // but shifts that same origin downward by the full amount too, which on this
  // top-heavy shape (already dipping close to the panel's bottom edge) pushed the
  // bottom edge further down than the smaller scale pulled it back in. A flat
  // multiplier shrinks the fit around the SAME origin instead, with no such tug-of-war.
  const FIT_SAFETY = 0.92;
  const defaultFitScale =
    FIT_SAFETY *
    Math.max(0.02, Math.min(3, Math.min(availW / (halfWidthNeeded * 2 + margin * 2), availH / (fitRadius * (1 + downFrac) + margin * 2))));

  // Whichever dimension was NOT the tight one above (commonly width, since the fan
  // wants a wider-than-tall box - halfWidthNeeded*2 > fitRadius*(1+downFrac) - while
  // most panels are more squarish than that) is left with leftover room the scale
  // calculation above didn't need. Splitting that leftover evenly above and below,
  // instead of leaving it all as one lump of dead space below the fan, is what actually
  // centers the shape vertically - the origin itself still isn't the panel's vertical
  // middle (this stays "how far below the top" per the fan's own top-heavy shape), it's
  // just no longer pinned to the smallest-possible top margin regardless of how much
  // room is really there.
  const usedHeight = fitRadius * defaultFitScale * (1 + downFrac);
  const verticalSlack = Math.max(0, availH - usedHeight - margin * 2);
  const topOffset = margin + verticalSlack / 2;

  // Pan with drag, zoom with scroll/pinch, same as the map and Cards view - free range,
  // all the way out to seeing the whole tree at once and all the way in past any single
  // ring: that's the viewer's call to make, not something to cap on their behalf. A
  // fresh render for the same root+depth (any ordinary edit elsewhere) keeps whatever
  // pan/zoom the user already had; switching root or generation count re-centers, since
  // the shape of the fan itself just changed.
  const key = `${rootId}:${maxGen}`;
  const zoomBehavior = window.d3
    .zoom()
    .scaleExtent([0.02, 8])
    .on('zoom', (event) => {
      g.setAttribute('transform', event.transform.toString());
      savedTransform = event.transform;
      applyZoomTextScale(event.transform.k);
    });
  window.d3.select(svg).call(zoomBehavior);

  let initialTransform;
  if (savedKey === key && savedTransform) {
    initialTransform = savedTransform;
  } else {
    initialTransform = window.d3.zoomIdentity.translate(availW / 2, fitRadius * defaultFitScale + topOffset).scale(defaultFitScale);
    savedKey = key;
  }
  window.d3.select(svg).call(zoomBehavior.transform, initialTransform);
  applyZoomTextScale(initialTransform.k); // don't rely on .transform() dispatching its own 'zoom' event

  currentSvg = svg;
  currentZoomLayer = g;
  currentZoomBehavior = zoomBehavior;
}

// Called from the sidebar search: finds the searched person's own wedge (or the root
// circle) in the CURRENTLY rendered fan - never re-rooting the chart onto them, since
// jumping the root around on every search is exactly the disorienting behavior this
// avoids (a searched person you weren't specifically trying to re-center on would
// otherwise silently replace whoever you had the fan built around, with no way back
// short of re-finding that original starting person). Pans/zooms to bring their wedge
// to the center (at the current zoom level) and flashes it, so both the highlight and
// the person's own edit card (opened separately, alongside this) are visible together.
// Returns false with no effect if they're not part of the currently-rendered ancestor
// set at all (different family tree, or beyond the generations currently shown).
export function pulseFanPerson(personId) {
  if (!currentSvg || !currentZoomLayer || !currentZoomBehavior) return false;
  const el = currentZoomLayer.querySelector(`[data-person-id="${CSS.escape(personId)}"]`);
  if (!el) return false;

  const bbox = el.getBBox();
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const rect = currentSvg.getBoundingClientRect();
  const k = savedTransform ? savedTransform.k : 1;
  const centered = window.d3.zoomIdentity.translate(rect.width / 2 - cx * k, rect.height / 2 - cy * k).scale(k);
  window.d3.select(currentSvg).transition().duration(450).call(currentZoomBehavior.transform, centered);

  el.classList.remove('fan-pulse'); // restart the animation if it's already mid-pulse from a previous search
  void el.getBoundingClientRect(); // force reflow so re-adding the class below actually restarts it
  el.classList.add('fan-pulse');
  setTimeout(() => el.classList.remove('fan-pulse'), 2400);
  return true;
}

function appendCenteredText(g, x, y, text, className, fontSize) {
  const el = svgEl('text', { x, y, class: className, 'text-anchor': 'middle', 'font-size': fontSize });
  el.textContent = text;
  g.appendChild(el);
  return el;
}

// Trims `el`'s text down to whatever actually fits in `maxWidth`, measured for real
// (getComputedTextLength) rather than guessed from a fixed per-character width - a
// guess either wastes space on names with narrow letters or overflows on names with
// wide ones, since real glyphs vary a lot more than a flat average admits. Only called
// once `el` is attached to a laid-out document (see the fitQueue drain in
// renderFanChart), which is what a real width measurement requires.
function fitTextToWidth(el, fullText, maxWidth) {
  el.textContent = fullText;
  if (!(maxWidth > 0) || el.getComputedTextLength() <= maxWidth) return;
  let text = fullText;
  while (text.length > 1) {
    text = text.slice(0, -1);
    el.textContent = text + '…';
    if (el.getComputedTextLength() <= maxWidth) return;
  }
  el.textContent = ''; // not even one character + ellipsis fits - blank beats overflow
}
