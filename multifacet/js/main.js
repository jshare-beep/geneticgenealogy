import {
  createEmptyTree,
  addPerson,
  addUnion,
  addMatch,
  addPossibility,
  removeMatch,
  removePossibility,
  getPossibilityForPerson,
  addBranch,
  removeBranch,
  getBranchForPerson,
  isPersonExpanded,
  addSiblingOf,
  addParentsToPerson,
  addSpouse,
  addChildToUnion,
  removePersonCascade,
  buildIndices,
  canUnionMerge,
} from './model/graph.js';
import { rankPossibilities } from './scoring/scoring.js';
import { renderScorePanel, renderMatchesList, renderBranchesList } from './render/renderScorePanel.js';
import { treeToF3Data } from './render/familyChartAdapter.js';
import { saveDraft, loadDraft } from './sync/storage.js';
import * as cloud from './sync/supabaseClient.js';
import { buildSampleTree } from './sync/sampleData.js';
import { strengthToPlum } from './util/color.js';

const familyChartEl = document.getElementById('FamilyChart');
const emptyStateEl = document.getElementById('emptyState');
const matchesListEl = document.getElementById('matchesList');
const scorePanelEl = document.getElementById('scorePanel');
const branchesListEl = document.getElementById('branchesList');
const saveStatusEl = document.getElementById('saveStatus');

const branchFocusBanner = document.getElementById('branchFocusBanner');
const branchFocusName = document.getElementById('branchFocusName');
const branchFocusBackBtn = document.getElementById('branchFocusBackBtn');

const personMenuDialog = document.getElementById('personMenuDialog');
const pmName = document.getElementById('pmName');
const pmBirthYear = document.getElementById('pmBirthYear');
const pmDeathYear = document.getElementById('pmDeathYear');
const pmSpouseBranchBtn = document.getElementById('pmSpouseBranchBtn');
const pmSpouseBranchHint = document.getElementById('pmSpouseBranchHint');
const pmFocusBtn = document.getElementById('pmFocusBtn');
const pmBranchStatus = document.getElementById('pmBranchStatus');
const pmBranchBtn = document.getElementById('pmBranchBtn');
const pmMatchesList = document.getElementById('pmMatchesList');
const pmNewMatchCm = document.getElementById('pmNewMatchCm');
const pmAddMatchBtn = document.getElementById('pmAddMatchBtn');
const pmPossibilityStatus = document.getElementById('pmPossibilityStatus');
const pmPossibilityBtn = document.getElementById('pmPossibilityBtn');
const pmSiblingSection = document.getElementById('pmSiblingSection');
const pmSiblingFullBtn = document.getElementById('pmSiblingFullBtn');
const pmSiblingHalfBtn = document.getElementById('pmSiblingHalfBtn');
const pmSiblingParentChoice = document.getElementById('pmSiblingParentChoice');
const pmSiblingConnectBtn = document.getElementById('pmSiblingConnectBtn');
const pmSiblingMessage = document.getElementById('pmSiblingMessage');
const pmAddParentsBtn = document.getElementById('pmAddParentsBtn');
const pmAddChildBtn = document.getElementById('pmAddChildBtn');
const pmDeleteBtn = document.getElementById('pmDeleteBtn');
const pmCloseBtn = document.getElementById('pmCloseBtn');

const startOverBtn = document.getElementById('startOverBtn');
const signInBtn = document.getElementById('signInBtn');
const accountChip = document.getElementById('accountChip');
const accountEmail = document.getElementById('accountEmail');
const signOutBtn = document.getElementById('signOutBtn');
const signInDialog = document.getElementById('signInDialog');
const signInForm = document.getElementById('signInForm');
const signInEmail = document.getElementById('signInEmail');
const signInMessage = document.getElementById('signInMessage');
const signInSubmitBtn = document.getElementById('signInSubmitBtn');
const signInCancelBtn = document.getElementById('signInCancelBtn');
const googleSignInBtn = document.getElementById('googleSignInBtn');

const myTreesBtn = document.getElementById('myTreesBtn');
const saveTreeBtn = document.getElementById('saveTreeBtn');
const saveTreeDialog = document.getElementById('saveTreeDialog');
const saveTreeForm = document.getElementById('saveTreeForm');
const saveTreeName = document.getElementById('saveTreeName');
const saveTreeMessage = document.getElementById('saveTreeMessage');
const saveTreeSubmitBtn = document.getElementById('saveTreeSubmitBtn');
const saveTreeCancelBtn = document.getElementById('saveTreeCancelBtn');
const myTreesDialog = document.getElementById('myTreesDialog');
const myTreesList = document.getElementById('myTreesList');
const newTreeBtn = document.getElementById('newTreeBtn');
const myTreesCloseBtn = document.getElementById('myTreesCloseBtn');

let tree = createEmptyTree();
let chart = null;
let card = null;
let currentSession = null;
let cloudDirty = false;
let personMenuId = null; // person currently open in the person menu
let focusPersonId = null; // branch-focus filter: show only this person's ancestor line
let siblingRelation = null; // 'full' | 'half', while the sibling picker is open

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeTime(isoString) {
  const minutes = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function updateSaveStatus() {
  saveStatusEl.classList.remove('is-saved', 'is-local');
  if (!currentSession) {
    saveStatusEl.textContent = 'Saved on this device';
    saveStatusEl.classList.add('is-local');
  } else if (!tree.id) {
    saveStatusEl.textContent = 'Not saved to cloud yet';
    saveStatusEl.classList.add('is-local');
  } else if (cloudDirty) {
    saveStatusEl.textContent = `Unsaved changes to "${tree.title}"`;
    saveStatusEl.classList.add('is-local');
  } else {
    saveStatusEl.textContent = `Saved to cloud as "${tree.title}"`;
    saveStatusEl.classList.add('is-saved');
  }
}

function persist() {
  saveDraft(tree);
  if (currentSession && tree.id) cloudDirty = true;
  updateSaveStatus();
}

// --- family-chart card rendering (read-only surface; all edits go through the
// person menu, not through family-chart's own UI) --------------------------

function cardInnerHtmlCreator(d) {
  const datum = d.data;
  const name = escapeHtml(datum.data.name || '(unnamed)');
  const years =
    datum.data.birthYear || datum.data.deathYear
      ? `${escapeHtml(datum.data.birthYear || '?')}–${escapeHtml(datum.data.deathYear || '?')}`
      : '';
  const cmBadge = datum.data.cmBadge;
  const isPossibility = datum.data.isPossibility;
  const isBranch = datum.data.isBranch;
  const branchColor = datum.data.branchColor;
  const isFocused = focusPersonId === datum.id;
  const hasCoSpouse = datum.data.hasCoSpouse;

  const classes = ['f3-person-inner'];
  if (isPossibility) classes.push('is-possibility');
  if (datum.data.isTop) classes.push('is-top');
  if (datum.data.eliminated) classes.push('is-eliminated');
  if (isBranch) classes.push('is-branch');
  if (hasCoSpouse) classes.push('is-couple');

  let style = '';
  if (isBranch && branchColor) {
    style = ` style="border-color:${branchColor}; box-shadow:0 0 0 1px ${branchColor}, 0 2px 8px rgba(0,0,0,0.25);"`;
  } else if (isPossibility && !datum.data.eliminated) {
    // Strongest possibilities get the darkest, most saturated border; weaker ones
    // fade toward a pale tint of the same hue - a gradient instead of a single
    // binary "top" treatment. Ruled-out possibilities keep their own fixed muted
    // color untouched (see components.css .is-eliminated), no gradient involved.
    style = ` style="border-color:${strengthToPlum(datum.data.possStrength)};"`;
  }

  return `
    <div class="${classes.join(' ')}"${style}>
      <button type="button" class="f3-menu-hint" data-open-menu title="Open this person's menu">⋯</button>
      ${isBranch ? `<div class="f3-branch-flag" style="color:${branchColor}">● Branch</div>` : ''}
      ${isPossibility ? `<div class="f3-poss-flag">Possibility #${datum.data.possNumber ?? '?'}</div>` : ''}
      <div class="f3-person-main">
        <span class="f3-person-name">${name}</span>
        ${years ? `<span class="f3-person-years">${years}</span>` : ''}
      </div>
      ${
        hasCoSpouse
          ? `<div class="f3-person-main f3-co-spouse">
              <span class="f3-person-name">${escapeHtml(datum.data.coSpouseName || '(unnamed)')}</span>
              ${datum.data.coSpouseYears ? `<span class="f3-person-years">${escapeHtml(datum.data.coSpouseYears)}</span>` : ''}
            </div>`
          : ''
      }
      ${cmBadge ? `<div class="f3-person-cm">${escapeHtml(cmBadge)}</div>` : ''}
      ${isPossibility ? `<div class="f3-poss-badge">${escapeHtml(datum.data.possBadge)}</div>` : ''}
      ${isBranch ? `<div class="f3-branch-hint">${isFocused ? 'Click to return to full tree' : 'Click to view this branch'}</div>` : ''}
    </div>
  `;
}

function toggleBranchFocus(personId) {
  focusPersonId = focusPersonId === personId ? null : personId;
  destroyChart();
  refresh();
}

// family-chart is a "main person" pedigree renderer, not a general graph renderer: it
// only auto-expands the blood ancestors/descendants of whichever person is "main," plus
// their direct spouses - a spouse's OWN parents (a facet/branch, in this app's terms)
// never render unless THEY become main. So "view just this branch" is implemented by
// literally re-centering family-chart on the focused person via updateMainId(), not by
// filtering the node array ourselves - filtering can't fix a traversal limit.
function currentMainId() {
  return focusPersonId && tree.people[focusPersonId] ? focusPersonId : Object.keys(tree.people)[0];
}

function ensureChart(f3Data) {
  if (chart) {
    chart.updateData(f3Data);
    chart.updateMainId(currentMainId());
    chart.updateTree();
    return;
  }

  chart = window.f3
    .createChart('#FamilyChart', f3Data)
    // Transitions off: family-chart's own D3 transition keeps animating each link's
    // `d` attribute for the full duration and fights any manual override attempted
    // before it settles, which is what straightenSiblingLinks() needs to rewrite.
    .setTransitionTime(0)
    .setCardXSpacing(240)
    .setCardYSpacing(150)
    .setShowSiblingsOfMain(true)
    // An un-expanded partner is deliberately omitted from the data (folded into their
    // spouse's card instead - see familyChartAdapter.js), which family-chart otherwise
    // reads as "single parent, other parent unknown" and fills with a placeholder
    // ghost card. Turn that off since the other parent isn't unknown, just hidden.
    .setSingleParentEmptyCard(false);

  card = chart.setCardHtml().setCardInnerHtmlCreator(cardInnerHtmlCreator);
  card.setOnCardClick((e, d) => {
    const personId = d.data.id;
    const isBranch = d.data.data.isBranch;
    if (isBranch && !e.target.closest('[data-open-menu]')) {
      toggleBranchFocus(personId);
      return;
    }
    openPersonMenu(personId);
  });

  chart.updateMainId(currentMainId());
  chart.updateTree({ initial: true });
}

function destroyChart() {
  familyChartEl.innerHTML = '';
  chart = null;
  card = null;
}

// --- Clean sibling connector lines -------------------------------------------
// family-chart draws each child's connector as its own independent curved path back
// to the shared parent point. With 3+ children spread wide (each needing room for
// their own subtree below), those curves visually pile up into an overlapping blob
// right at the convergence point instead of reading as one clean line. There's no
// library option to change this, so we rewrite each child-link's `d` attribute after
// render into a plain right-angle elbow (drop from child to a shared horizontal bar,
// then one shared trunk up to the parent) - since siblings' horizontal segments then
// coincide exactly instead of diverging as curves, they read as a single line.
//
// The line always terminates at the child's own card - never at a midpoint with their
// spouse. A previous version aimed at the midpoint between a child and their spouse to
// avoid a sideways jog when family-chart centers the couple as a unit (leaving the
// child's own card off-center), but that made the connector visually touch the
// spouse's card too, implying a blood relationship that isn't there. A jog to the
// child's true position is the correct tradeoff - it just needs to look deliberate,
// which the shared-manifold elbow below already provides.

const ELBOW_CORNER_RADIUS = 14;

// Builds the child -> shared-manifold-bus -> parent elbow. `roundParentCorner` controls
// whether the corner at the parent's end (ex, manifoldY) also gets rounded, same as the
// child's end always does. Leave it false when several siblings converge onto this same
// point - rounding that corner independently per sibling produces overlapping curves
// right at the intersection - and true for a lone child, where there's only one line
// touching that corner and a sharp turn there would be the only unrounded corner
// anywhere in the tree for no reason.
function elbowPath(cx, cy, ex, ey, manifoldY, radius, roundParentCorner = false) {
  const vertLen = Math.abs(manifoldY - cy);
  const horizLen = Math.abs(ex - cx);
  const r = Math.min(radius, vertLen / 2, horizLen / 2);
  if (r < 0.5) {
    return `M${cx},${cy} L${cx},${manifoldY} L${ex},${manifoldY} L${ex},${ey}`;
  }
  const signY = manifoldY >= cy ? 1 : -1;
  const signX = ex >= cx ? 1 : -1;
  const preCorner = { x: cx, y: manifoldY - signY * r };
  const postCorner = { x: cx + signX * r, y: manifoldY };
  if (!roundParentCorner) {
    return `M${cx},${cy} L${preCorner.x},${preCorner.y} Q${cx},${manifoldY} ${postCorner.x},${postCorner.y} L${ex},${manifoldY} L${ex},${ey}`;
  }
  const parentSignY = ey >= manifoldY ? 1 : -1;
  const parentPreCorner = { x: ex - signX * r, y: manifoldY };
  const parentPostCorner = { x: ex, y: manifoldY + parentSignY * r };
  return `M${cx},${cy} L${preCorner.x},${preCorner.y} Q${cx},${manifoldY} ${postCorner.x},${postCorner.y} L${parentPreCorner.x},${parentPreCorner.y} Q${ex},${manifoldY} ${parentPostCorner.x},${parentPostCorner.y} L${ex},${ey}`;
}

// Builds a rounded orthogonal path through an ordered list of {x,y} points, rounding
// every interior corner by up to `radius` (clamped so it never overruns a short
// adjacent segment). Used for the spouse-dip shape below, which needs more than one
// corner.
function roundedPolylinePath(points, radius) {
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r < 0.5) {
      d += ` L${cur.x},${cur.y}`;
      continue;
    }
    const p1 = { x: cur.x - ((cur.x - prev.x) / d1) * r, y: cur.y - ((cur.y - prev.y) / d1) * r };
    const p2 = { x: cur.x + ((next.x - cur.x) / d2) * r, y: cur.y + ((next.y - cur.y) / d2) * r };
    d += ` L${p1.x},${p1.y} Q${cur.x},${cur.y} ${p2.x},${p2.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x},${last.y}`;
}

const SPOUSE_DIP_DEPTH = 26;
const SPOUSE_DIP_STUB = 30;

// Connects two spouse cards with a short flat step over/under whatever sits between
// them, instead of a flat straight line - used only for a shared parent's second (or
// later) marriage, see straightenSiblingLinks below. A straight line reads as a single
// continuous marriage line; when a first marriage's card happens to sit between the two
// spouses of a second marriage (a coincidence of family-chart's own layout, not
// anything meaningful), that straight line runs right along the same row as the first
// marriage's line and the two are visually indistinguishable from one connected group
// of three. The path still leaves each card horizontally, the same way every other
// spouse line does (an early version rose straight up out of the card's top edge,
// which read as a shape no real family tree uses) - it just detours up and back down
// in between, clearing whatever's in the way by SPOUSE_DIP_DEPTH.
function spouseDipPath(sx, sy, tx, ty, dip, radius, stub) {
  const signX = tx >= sx ? 1 : -1;
  const midY = sy + dip;
  const x1 = sx + signX * stub;
  const x2 = tx - signX * stub;
  if (signX > 0 ? x1 >= x2 : x1 <= x2) {
    return roundedPolylinePath(
      [
        { x: sx, y: sy },
        { x: sx, y: midY },
        { x: tx, y: midY },
        { x: tx, y: ty },
      ],
      radius
    );
  }
  return roundedPolylinePath(
    [
      { x: sx, y: sy },
      { x: x1, y: sy },
      { x: x1, y: midY },
      { x: x2, y: midY },
      { x: x2, y: ty },
      { x: tx, y: ty },
    ],
    radius
  );
}

const CARD_SLOT_HEIGHT_FALLBACK = 80;

// Measures how tall a card's rendered slot actually is, in the same data-unit
// coordinate space as every other position in this file - by finding two cards at
// different known rows, deriving pixels-per-data-unit from the vertical distance
// between them, then converting the tallest rendered card's pixel height through that
// same scale. Needed because family-chart gives every card_cont in a row the same
// fixed slot height regardless of content, and that height isn't exposed as a data
// value anywhere - it can only be read back from the rendered DOM.
function measureCardSlotHeight(allCards) {
  const rows = new Map();
  for (const c of allCards) {
    const y = c.__data__?.y;
    if (y != null && !rows.has(y)) rows.set(y, c);
  }
  const rowCards = [...rows.values()];
  if (rowCards.length < 2) return CARD_SLOT_HEIGHT_FALLBACK;
  const [cardA, cardB] = rowCards;
  const rectA = cardA.getBoundingClientRect();
  const rectB = cardB.getBoundingClientRect();
  const scaleY = Math.abs(rectB.top - rectA.top) / Math.abs(cardB.__data__.y - cardA.__data__.y);
  if (!scaleY) return CARD_SLOT_HEIGHT_FALLBACK;
  const maxHeightPx = Math.max(...allCards.map((c) => c.getBoundingClientRect().height));
  return maxHeightPx / scaleY;
}

// Sets a card's rendered position, keeping family-chart's own bookkeeping (__data__.x)
// in sync so every other computation this render pass - which all read that property,
// not the DOM transform - sees the corrected position too.
function setCardX(card, x) {
  const style = card.style;
  const yMatch = /translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(style.transform || '');
  const yPx = yMatch ? yMatch[1] : card.__data__.y;
  style.transform = `translate(${x}px, ${yPx}px)`;
  card.__data__.x = x;
}

// When someone has exactly two marriages, each with its own real card (see
// canUnionMerge), family-chart's own layout always fans both spouses off to the SAME
// side of the shared parent (a hardcoded rule, not something we can turn off - see
// familyChartAdapter.js) - so one of the two ends up sandwiched between the shared
// parent and their sibling-marriage regardless of which side that whole group lands
// on. Swapping the shared parent into the middle slot (an already-established pattern
// in this file - see the single-child repositioning below) turns both marriages into
// plain adjacent connectors with nothing between them to route around, which is both
// more readable and how every ordinary family tree draws a person with two spouses.
function centerSharedParentsBetweenSpouses(indices, allCards, findCardById) {
  for (const personId of Object.keys(tree.people)) {
    const unionIds = (indices.unionsOf.get(personId) || []).filter((uid) => tree.unions[uid]?.partnerIds.filter(Boolean).length === 2);
    if (unionIds.length !== 2) continue;
    const personCard = findCardById(personId);
    if (!personCard) continue;
    const spouseCards = unionIds
      .map((uid) => tree.unions[uid].partnerIds.find((pid) => pid && pid !== personId))
      .map((spouseId) => findCardById(spouseId));
    if (spouseCards.some((c) => !c) || spouseCards[0] === spouseCards[1]) continue;
    const [a, b] = spouseCards;
    if (a.__data__.y !== personCard.__data__.y || b.__data__.y !== personCard.__data__.y) continue;
    const xs = [personCard.__data__.x, a.__data__.x, b.__data__.x].sort((p, q) => p - q);
    const middleX = xs[1];
    if (personCard.__data__.x === middleX) continue; // already centered
    const displaced = a.__data__.x === middleX ? a : b.__data__.x === middleX ? b : null;
    if (!displaced) continue;
    const personX = personCard.__data__.x;
    setCardX(personCard, middleX);
    setCardX(displaced, personX);
  }
}

function straightenSiblingLinks() {
  const indices = buildIndices(tree);
  const allCards = [...familyChartEl.querySelectorAll('.card_cont')];
  const spouseLinks = [...familyChartEl.querySelectorAll('.link')].filter((el) => el.__data__?.spouse);
  const findCardById = (personId) => allCards.find((c) => c.__data__?.data?.id === personId);
  centerSharedParentsBetweenSpouses(indices, allCards, findCardById);
  // Which unions are a shared parent's second (or later) childbearing union - reused
  // from the half-sibling coloring logic below, and needed again here: a secondary
  // union's bus can still span an X range that overlaps a sibling union's bus at the
  // same row height (e.g. Bob&Edith's Clara sits further right than Bob&Lucy's card,
  // so Clara's trunk back to Bob crosses right through Lucy's territory). Sitting at
  // the exact same height makes two unrelated buses read as one continuous line
  // spanning both families' kids, so a secondary union's bus gets its own, visually
  // distinct height.
  const secondaryUnions = computeSecondaryUnionColors(indices);

  // Every marriage line gets its own neutral color, distinct from both the blood-line
  // color and the half-sibling color - a spouse isn't a blood relative or a sibling of
  // anyone, so their connector shouldn't visually read as either.
  for (const el of spouseLinks) el.style.stroke = 'var(--accent-light)';

  // The marriage line itself, not just the descent line below it, needs to look like a
  // second relationship rather than a continuation of the first (see spouseDipPath).
  // Read positions from the live cards, not the link's own `d` attribute - centering
  // above may just have moved the cards this same pass, which the link element doesn't
  // know about yet.
  for (const el of spouseLinks) {
    const d = el.__data__;
    const sid = d.source?.data?.id;
    const tid = d.target?.data?.id;
    const sourceCard = findCardById(sid);
    const targetCard = findCardById(tid);
    if (!sourceCard || !targetCard) continue;
    const sx = sourceCard.__data__.x;
    const sy = sourceCard.__data__.y;
    const tx = targetCard.__data__.x;
    const ty = targetCard.__data__.y;
    const union = Object.values(tree.unions).find((u) => u.partnerIds.includes(sid) && u.partnerIds.includes(tid));
    // Nothing to route around once the shared parent is centered between exactly two
    // spouses (see centerSharedParentsBetweenSpouses) - only step over an obstacle that
    // actually still sits between these two cards.
    const lo = Math.min(sx, tx);
    const hi = Math.max(sx, tx);
    const obstacle = allCards.find(
      (c) => c !== sourceCard && c !== targetCard && c.__data__?.y === sy && c.__data__?.x > lo && c.__data__?.x < hi
    );
    if (!union || !secondaryUnions.has(union.id) || !obstacle) {
      el.setAttribute('d', `M${sx},${sy}L${tx},${ty}`);
      continue;
    }
    // Prefer dipping up, into the clear space above the row - fall back to down only
    // if something (e.g. this person's own parents, in a branch-focus view) actually
    // occupies that space, so the dip never runs through a real card either way.
    const rowAbove = sy - 150;
    const aboveIsClear = !allCards.some((c) => c.__data__?.y === rowAbove && c.__data__?.x >= lo - 40 && c.__data__?.x <= hi + 40);
    const dip = aboveIsClear ? -SPOUSE_DIP_DEPTH : SPOUSE_DIP_DEPTH;
    el.setAttribute('d', spouseDipPath(sx, sy, tx, ty, dip, ELBOW_CORNER_RADIUS, SPOUSE_DIP_STUB));
  }

  const groups = new Map(); // "parentX,parentY" -> { ex, ey, unionId, items: [{el, cx, cy}] }
  for (const el of familyChartEl.querySelectorAll('.link')) {
    const d = el.__data__;
    if (!d || d.spouse) continue;
    const raw = el.getAttribute('d');
    if (!raw) continue;

    // Which endpoint is the child isn't reliably "target," or even always the path's
    // first point - family-chart draws links in one point order when the child is a
    // descendant of the focused/main person, and the reverse when the child is an
    // ancestor of it (e.g. viewing Lucy's own branch, where Walter/Opal -> Lucy is an
    // "ancestry" link). That mismatch was leaving Walter/Opal's connector as
    // family-chart's raw, un-straightened bezier curve, since the code was looking for
    // a child at the wrong end. Ground truth instead: pull every coordinate pair out of
    // the path (first and last are always the two true endpoints, even through a curve's
    // control points), match each to a real card, and ask OUR OWN data which of the two
    // people is actually recorded as someone's child.
    const allPoints = [...raw.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
    if (allPoints.length < 2) continue;
    const endpoints = [allPoints[0], allPoints[allPoints.length - 1]].map(([, x, y]) => ({
      x: parseFloat(x),
      y: parseFloat(y),
    }));
    const endpointCards = endpoints.map((p) => allCards.find((c) => Math.abs(c.__data__?.x - p.x) < 0.5 && Math.abs(c.__data__?.y - p.y) < 0.5));
    const childIndex = endpointCards.findIndex((c) => c && indices.parentUnionOf.has(c.__data__.data.id));
    if (childIndex === -1) continue;
    const cx = endpoints[childIndex].x;
    const cy = endpoints[childIndex].y;
    const childId = endpointCards[childIndex].__data__.data.id;

    // A descent line belongs to the MARRIAGE, so it should come from the midpoint
    // between the two parents' cards whenever that's meaningful - i.e. whenever both
    // partners are equally "just" each other's spouse (Franklin and Mary each have
    // their own separate ancestry but neither has a second marriage), the midpoint is
    // the only anchor that doesn't arbitrarily favor one of them over the other. When a
    // union renders as one merged pill (see graph.js canUnionMerge) there's only one
    // card anyway. The one case a midpoint isn't safe is when it would land on or be
    // blocked by some unrelated THIRD card sitting between the two parents - that used
    // to happen whenever a shared parent's two marriages weren't yet centered (Edith's
    // card sat exactly at the midpoint between Bob and Lucy), but centering (see
    // centerSharedParentsBetweenSpouses) removes that obstacle in the common case; this
    // still falls back to anchoring at whichever partner is unique to this union for
    // the rarer case centering doesn't reach (e.g. three or more marriages).
    const union = tree.unions[indices.parentUnionOf.get(childId)];
    if (!union) continue;
    const partners = union.partnerIds.filter(Boolean);

    let ex, ey;
    if (partners.length < 2) {
      const soloCard = findCardById(partners[0]);
      if (!soloCard) continue;
      ex = soloCard.__data__.x;
      ey = soloCard.__data__.y;
    } else if (canUnionMerge(tree, indices, union.id)) {
      const mergedCard = findCardById(partners.find((pid) => findCardById(pid)) ?? partners[0]);
      if (!mergedCard) continue;
      ex = mergedCard.__data__.x;
      ey = mergedCard.__data__.y;
    } else {
      const cardA = findCardById(partners[0]);
      const cardB = findCardById(partners[1]);
      if (!cardA || !cardB) continue;
      const sameRow = cardA.__data__.y === cardB.__data__.y;
      const lo = Math.min(cardA.__data__.x, cardB.__data__.x);
      const hi = Math.max(cardA.__data__.x, cardB.__data__.x);
      const obstacle =
        sameRow &&
        allCards.some((c) => c !== cardA && c !== cardB && c.__data__?.y === cardA.__data__.y && c.__data__?.x > lo && c.__data__?.x < hi);
      if (sameRow && !obstacle) {
        ex = (cardA.__data__.x + cardB.__data__.x) / 2;
        ey = cardA.__data__.y;
      } else {
        const counts = partners.map((pid) => (indices.unionsOf.get(pid) || []).length);
        const anchorId = counts[0] === 1 && counts[1] > 1 ? partners[0] : counts[1] === 1 && counts[0] > 1 ? partners[1] : partners[0];
        const anchorCard = findCardById(anchorId);
        if (!anchorCard) continue;
        ex = anchorCard.__data__.x;
        ey = anchorCard.__data__.y;
      }
    }

    const key = `${ex.toFixed(1)},${ey.toFixed(1)}`;
    if (!groups.has(key)) groups.set(key, { ex, ey, unionId: union.id, items: [] });
    groups.get(key).items.push({ el, cx, cy });
  }

  // Every card_cont in a row is given the same fixed slot height by family-chart,
  // regardless of how much text is actually in it (a plain one-line card and a
  // three-line "BRANCH" card both occupy the full slot) - so a bus positioned by a
  // fraction of the row gap can end up well inside that slot rather than in the clear
  // channel below it, and the bus line then runs straight through the card's own
  // footprint (this is what made George's line clip Lucy's card). Measure the actual
  // rendered slot height once per render and clear it by a margin, instead of guessing
  // a fraction of the gap.
  const cardSlotHeight = measureCardSlotHeight(allCards);
  const clearMargin = 12;
  // Primary unions bus at a height that clears every card's slot; a secondary union
  // (e.g. a second marriage) buses a bit closer to the parent row instead - still past
  // every card's slot, just less deep - so its line can never read as a continuation of
  // the primary union's bus even where their X ranges overlap.
  const manifoldOffsetFor = (unionId) =>
    unionId && secondaryUnions.has(unionId) ? cardSlotHeight + clearMargin : cardSlotHeight + clearMargin * 2;

  for (const { ex, ey, unionId, items } of groups.values()) {
    if (!items.length) continue;

    if (items.length === 1) {
      const { el, cx, cy } = items[0];

      // A lone child has no siblings to align with, so the ideal connector is a plain
      // straight vertical line with no turn at all - which only works if the parent
      // card actually sits directly above the child. family-chart doesn't guarantee
      // that (a solo parent-couple gets positioned by the library's own balancing, not
      // centered on their one child), so when it doesn't, shift the parent card itself
      // to sit above the child rather than drawing a diagonal or an unnecessary elbow.
      // That's only safe when the parent card is a single, self-contained union (no
      // separate spouse card that would visually detach) - otherwise fall back to one
      // clean, fully-rounded turn instead of moving something another line depends on.
      const parentCard = allCards.find(
        (c) => Math.abs(c.__data__?.x - ex) < 0.5 && Math.abs(c.__data__?.y - ey) < 0.5
      );
      const parentId = parentCard?.__data__?.data?.id;
      const hasSeparateSpouse =
        parentId && spouseLinks.some((l) => l.__data__.source?.data?.id === parentId || l.__data__.target?.data?.id === parentId);

      if (parentCard && !hasSeparateSpouse && Math.abs(cx - ex) > 0.5) {
        const style = parentCard.style;
        const yMatch = /translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(style.transform || '');
        const yPx = yMatch ? yMatch[1] : ey;
        style.transform = `translate(${cx}px, ${yPx}px)`;
        el.setAttribute('d', `M${cx},${ey} L${cx},${cy}`);
      } else if (Math.abs(cx - ex) < 0.5) {
        el.setAttribute('d', `M${ex},${ey} L${cx},${cy}`);
      } else {
        // Can't move the parent, and the child isn't under it, so some turn is
        // unavoidable. A single turn positioned at the child's own row would send its
        // horizontal segment sweeping across that entire row at card height - if this
        // child sits off to the side of an unrelated union's kids (e.g. a second
        // marriage's only child positioned past the first marriage's children), that
        // segment cuts right through their cards and their own lines. Route through
        // the clear channel below every card's slot instead (see manifoldOffsetFor) -
        // even though it costs a second turn. Both corners round, since there's no
        // sibling sharing this point to worry about.
        const manifoldY = ey + Math.sign(cy - ey) * manifoldOffsetFor(unionId);
        el.setAttribute('d', elbowPath(cx, cy, ex, ey, manifoldY, ELBOW_CORNER_RADIUS, true));
      }
      continue;
    }

    // Multiple siblings do need a shared bus so their lines converge instead of
    // crossing. It sits in the clear channel below every card's slot in the parent
    // row (unless this is a secondary union, see manifoldOffsetFor above).
    const cy = items[0].cy; // siblings share a generation row
    const manifoldY = ey + Math.sign(cy - ey) * manifoldOffsetFor(unionId);
    for (const { el, cx } of items) {
      el.setAttribute('d', elbowPath(cx, cy, ex, ey, manifoldY, ELBOW_CORNER_RADIUS));
    }
  }
}

// --- Half-sibling line coloring ---------------------------------------------
// family-chart draws every parent-child connector as a plain .link path with no
// per-union distinction. To make half-siblings visually obvious, any union beyond a
// parent's first child-bearing union gets this one designated color (user-supplied
// palette), applied as a direct style override on the matching rendered path after
// each render.

const HALF_SIBLING_LINE_COLOR = '#8e4585';

function computeSecondaryUnionColors(indices) {
  const colorByUnion = new Map();
  for (const personId of Object.keys(tree.people)) {
    const unionIds = (indices.unionsOf.get(personId) || []).filter((uid) => tree.unions[uid]?.childIds.length);
    for (let i = 1; i < unionIds.length; i++) {
      colorByUnion.set(unionIds[i], HALF_SIBLING_LINE_COLOR);
    }
  }
  return colorByUnion;
}

function applyLinkColors(colorByUnion) {
  for (const el of familyChartEl.querySelectorAll('.link')) {
    const d = el.__data__;
    // Spouse links are colored by straightenSiblingLinks (a secondary marriage's line
    // gets its own dip + color there) - leave them alone here.
    if (!d || d.spouse) continue;
    const ids = new Set(String(d.id || '').split(', ').filter(Boolean));
    let matchedColor = '';
    for (const [unionId, color] of colorByUnion) {
      const union = tree.unions[unionId];
      if (!union) continue;
      const childHit = union.childIds.some((cid) => ids.has(cid));
      const parentsKnown = union.partnerIds.filter(Boolean);
      const parentsHit = parentsKnown.length > 0 && parentsKnown.every((pid) => ids.has(pid));
      if (childHit && parentsHit) {
        matchedColor = color;
        break;
      }
    }
    el.style.stroke = matchedColor;
  }
}

function updateBranchFocusBanner() {
  if (focusPersonId && tree.people[focusPersonId]) {
    branchFocusBanner.hidden = false;
    branchFocusName.textContent = tree.people[focusPersonId].name || '(unnamed)';
  } else {
    focusPersonId = null;
    branchFocusBanner.hidden = true;
  }
}

branchFocusBackBtn.addEventListener('click', () => {
  focusPersonId = null;
  destroyChart();
  refresh();
});

// Right-click (desktop) is a shortcut straight to "Add spouse / New branch" - the
// same action reachable via the person menu (the "click through to the menu" path on
// mobile, where there's no right-click) - rather than opening the full menu first.
familyChartEl.addEventListener('contextmenu', (e) => {
  const cardCont = e.target.closest('.card_cont');
  if (!cardCont) return;
  e.preventDefault();
  const personId = cardCont.__data__?.data?.id;
  if (!personId) return;
  handleAddSpouseOrBranch(personId);
});

// --- Core refresh ------------------------------------------------------------

function refresh() {
  const indices = buildIndices(tree);
  const hasPeople = Object.keys(tree.people).length > 0;
  emptyStateEl.style.display = hasPeople ? 'none' : 'flex';
  familyChartEl.style.display = hasPeople ? 'flex' : 'none';
  startOverBtn.hidden = !hasPeople;

  // Scoring always runs against the full tree - the branch-focus filter below only
  // affects what's drawn on the canvas, never the math, so a possibility's ranking
  // keeps combining evidence from every connected branch regardless of which one
  // you're currently looking at.
  const rankedResults = hasPeople
    ? rankPossibilities(Object.values(tree.possibilities), Object.values(tree.matches), tree, indices)
    : [];

  if (hasPeople) {
    const f3Data = treeToF3Data(tree, indices, rankedResults);
    ensureChart(f3Data);
    // family-chart lays out link positions asynchronously even with transitions off
    // (at least one frame), so wait two animation frames - the standard way to be sure
    // a prior DOM/layout batch has actually been applied - before reading/rewriting
    // the rendered `d` attributes.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        straightenSiblingLinks();
        applyLinkColors(computeSecondaryUnionColors(indices));
      });
    });
  }

  renderScorePanel(scorePanelEl, rankedResults, tree);
  renderMatchesList(matchesListEl, tree, { onDeleteMatch: handleDeleteMatch });
  renderBranchesList(branchesListEl, tree, { onSelectBranch: toggleBranchFocus, focusPersonId });
  updateBranchFocusBanner();
  persist();
}

function handleDeleteMatch(matchId) {
  removeMatch(tree, matchId);
  refresh();
}

// --- Person menu -------------------------------------------------------------

function renderPmMatches(personId) {
  pmMatchesList.innerHTML = '';
  const matches = Object.values(tree.matches).filter((m) => m.personId === personId);
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No matches on this person yet.';
    pmMatchesList.appendChild(empty);
    return;
  }
  for (const m of matches) {
    const row = document.createElement('div');
    row.className = 'dialog-match-row';
    const label = document.createElement('span');
    label.textContent = `${m.cM} cM`;
    row.appendChild(label);
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'node-btn node-btn-icon node-btn-danger';
    delBtn.textContent = '✕';
    delBtn.onclick = () => {
      removeMatch(tree, m.id);
      renderPmMatches(personId);
      refresh();
    };
    row.appendChild(delBtn);
    pmMatchesList.appendChild(row);
  }
}

function refreshPossibilityUI() {
  const poss = getPossibilityForPerson(tree, personMenuId);
  pmPossibilityStatus.textContent = poss ? 'This is a possibility' : 'Not a possibility';
  pmPossibilityBtn.textContent = poss ? 'Remove possibility' : 'Designate as possibility';
  pmPossibilityBtn.classList.toggle('btn-danger', !!poss);
}

function refreshBranchUI() {
  const branch = getBranchForPerson(tree, personMenuId);
  pmBranchStatus.textContent = branch ? 'This is a branch' : 'Not a branch';
  pmBranchStatus.style.color = branch ? branch.color : '';
  pmBranchBtn.textContent = branch ? 'Remove branch' : 'Designate as branch';
  pmBranchBtn.classList.toggle('btn-danger', !!branch);
}

// The one button that covers every "I want to explore this person's spouse's own
// side" case: add a brand-new spouse and branch them, promote an existing but
// still-merged spouse into their own branch pill, or (if their spouse is already its
// own branch) add another spouse for a second marriage. Same action, three contexts.
function refreshSpouseBranchUI() {
  const indices = buildIndices(tree);
  const spouseIds = indices.spouseOf.get(personMenuId) || [];
  const unexpandedSpouseId = spouseIds.find((sid) => !isPersonExpanded(tree, indices, sid));
  if (unexpandedSpouseId) {
    const spouseName = tree.people[unexpandedSpouseId]?.name || '(unnamed)';
    pmSpouseBranchHint.textContent = `Turns ${spouseName} into their own branch you can explore.`;
  } else if (spouseIds.length) {
    pmSpouseBranchHint.textContent = 'Adds another spouse and starts a new branch for them.';
  } else {
    pmSpouseBranchHint.textContent = "Adds a spouse and starts exploring their side of the tree.";
  }
}

function handleAddSpouseOrBranch(personId) {
  const indices = buildIndices(tree);
  const spouseIds = indices.spouseOf.get(personId) || [];
  const unexpandedSpouseId = spouseIds.find((sid) => !isPersonExpanded(tree, indices, sid));
  const targetId = unexpandedSpouseId || addSpouse(tree, personId, { name: 'New spouse' }).spouse.id;
  addBranch(tree, { personId: targetId });
  focusPersonId = targetId;
  if (personMenuDialog.open) personMenuDialog.close();
  destroyChart();
  refresh();
}

let siblingParentChoice = null;

function resetSiblingPicker() {
  siblingRelation = null;
  siblingParentChoice = null;
  pmSiblingFullBtn.classList.remove('is-selected');
  pmSiblingHalfBtn.classList.remove('is-selected');
  pmSiblingParentChoice.hidden = true;
  pmSiblingParentChoice.innerHTML = '';
  pmSiblingConnectBtn.hidden = true;
  pmSiblingMessage.hidden = true;
}

function currentParents(personId) {
  const indices = buildIndices(tree);
  const unionId = indices.parentUnionOf.get(personId);
  if (!unionId) return [];
  return tree.unions[unionId].partnerIds.filter(Boolean).map((pid) => tree.people[pid]);
}

// For "half sibling," we need to know which one parent is shared. If the reference
// person only has one known parent in the tree, that's unambiguous; if they have two,
// ask which one via a small radio choice.
function renderSiblingOptions() {
  pmSiblingParentChoice.innerHTML = '';
  if (siblingRelation === 'full') {
    pmSiblingParentChoice.hidden = true;
    siblingParentChoice = null;
    pmSiblingConnectBtn.hidden = false;
    return;
  }

  const parents = currentParents(personMenuId);
  if (parents.length < 2) {
    siblingParentChoice = parents[0]?.id || null;
    pmSiblingParentChoice.hidden = true;
    pmSiblingConnectBtn.hidden = false;
    return;
  }

  siblingParentChoice = null;
  pmSiblingConnectBtn.hidden = true;
  pmSiblingParentChoice.hidden = false;
  pmSiblingParentChoice.appendChild(
    Object.assign(document.createElement('p'), { className: 'empty-state', textContent: 'Shares which parent?' })
  );
  for (const p of parents) {
    const label = document.createElement('label');
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'pmSharedParent';
    rb.value = p.id;
    rb.addEventListener('change', () => {
      siblingParentChoice = p.id;
      pmSiblingConnectBtn.hidden = false;
    });
    label.appendChild(rb);
    label.appendChild(document.createTextNode(p.name || '(unnamed)'));
    pmSiblingParentChoice.appendChild(label);
  }
}

pmSiblingFullBtn.addEventListener('click', () => {
  siblingRelation = 'full';
  pmSiblingFullBtn.classList.add('is-selected');
  pmSiblingHalfBtn.classList.remove('is-selected');
  renderSiblingOptions();
});
pmSiblingHalfBtn.addEventListener('click', () => {
  siblingRelation = 'half';
  pmSiblingHalfBtn.classList.add('is-selected');
  pmSiblingFullBtn.classList.remove('is-selected');
  renderSiblingOptions();
});
pmSiblingConnectBtn.addEventListener('click', () => {
  try {
    const indices = buildIndices(tree);
    const newPerson = addSiblingOf(tree, indices, {
      referencePersonId: personMenuId,
      relation: siblingRelation,
      sharedParentId: siblingParentChoice,
      personInfo: { name: 'New sibling' },
    });
    personMenuDialog.close();
    destroyChart();
    refresh();
    openPersonMenu(newPerson.id);
  } catch (err) {
    pmSiblingMessage.textContent = err.message;
    pmSiblingMessage.hidden = false;
  }
});

function openPersonMenu(personId) {
  const person = tree.people[personId];
  if (!person) return;
  personMenuId = personId;

  pmName.value = person.name || '';
  pmBirthYear.value = person.birthYear ?? '';
  pmDeathYear.value = person.deathYear ?? '';

  renderPmMatches(personId);
  refreshPossibilityUI();
  refreshBranchUI();
  refreshSpouseBranchUI();
  resetSiblingPicker();

  const indices = buildIndices(tree);
  pmSiblingSection.hidden = !indices.parentUnionOf.has(personId);

  personMenuDialog.showModal();
}

pmName.addEventListener('change', () => {
  if (!personMenuId) return;
  tree.people[personMenuId].name = pmName.value;
  refresh();
});
pmBirthYear.addEventListener('change', () => {
  if (!personMenuId) return;
  tree.people[personMenuId].birthYear = pmBirthYear.value ? parseInt(pmBirthYear.value, 10) || null : null;
  refresh();
});
pmDeathYear.addEventListener('change', () => {
  if (!personMenuId) return;
  tree.people[personMenuId].deathYear = pmDeathYear.value ? parseInt(pmDeathYear.value, 10) || null : null;
  refresh();
});

pmAddMatchBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const cM = parseFloat(pmNewMatchCm.value);
  if (Number.isNaN(cM) || cM < 0) {
    alert('Enter a valid, non-negative cM value.');
    return;
  }
  addMatch(tree, { personId: personMenuId, cM });
  pmNewMatchCm.value = '';
  renderPmMatches(personMenuId);
  refresh();
});

pmPossibilityBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const existing = getPossibilityForPerson(tree, personMenuId);
  if (existing) {
    removePossibility(tree, existing.id);
  } else {
    addPossibility(tree, { personId: personMenuId });
  }
  refresh();
  refreshPossibilityUI();
});

pmSpouseBranchBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  handleAddSpouseOrBranch(personMenuId);
});

pmBranchBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const existing = getBranchForPerson(tree, personMenuId);
  if (existing) {
    removeBranch(tree, existing.id);
    if (focusPersonId === personMenuId) focusPersonId = null;
  } else {
    addBranch(tree, { personId: personMenuId });
  }
  destroyChart();
  refresh();
  refreshBranchUI();
});

pmFocusBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  focusPersonId = personMenuId;
  personMenuDialog.close();
  destroyChart();
  refresh();
});

pmAddParentsBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  try {
    const indices = buildIndices(tree);
    addParentsToPerson(tree, personMenuId, indices, { parent1: { name: 'New parent' }, parent2: { name: 'New parent' } });
    personMenuDialog.close();
    destroyChart();
    refresh();
  } catch (err) {
    alert(err.message);
  }
});
pmAddChildBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const indices = buildIndices(tree);
  const unionIds = indices.unionsOf.get(personMenuId) || [];
  const unionId = unionIds.length ? unionIds[unionIds.length - 1] : addUnion(tree, [personMenuId, null], []).id;
  addChildToUnion(tree, unionId, { name: 'New child' });
  personMenuDialog.close();
  destroyChart();
  refresh();
});

pmDeleteBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  if (!confirm(`Delete ${person?.name || 'this person'} and their descendants? This cannot be undone.`)) return;
  const indices = buildIndices(tree);
  removePersonCascade(tree, personMenuId, indices);
  if (focusPersonId === personMenuId) focusPersonId = null;
  personMenuDialog.close();
  personMenuId = null;
  destroyChart();
  refresh();
});

pmCloseBtn.addEventListener('click', () => {
  personMenuDialog.close();
  personMenuId = null;
});

// --- Top bar ---------------------------------------------------------------

// The founder becomes branch #1 immediately, same mechanism as any later branch (see
// pmSpouseBranchBtn) - there's no separate "main tree" concept, just whichever branches
// exist, and every one of them (including this first one) needs a lead individual to
// be named after and to click back to from the sidebar.
document.getElementById('addFoundingCoupleBtn').addEventListener('click', () => {
  const p1 = addPerson(tree, { name: 'New person 1' });
  const p2 = addPerson(tree, { name: 'New person 2' });
  addUnion(tree, [p1.id, p2.id], []);
  addBranch(tree, { personId: p1.id });
  refresh();
});

document.getElementById('addFoundingPersonBtn').addEventListener('click', () => {
  const p1 = addPerson(tree, { name: 'New person' });
  addBranch(tree, { personId: p1.id });
  refresh();
});

document.getElementById('startSampleBtn').addEventListener('click', () => {
  tree = buildSampleTree();
  focusPersonId = null;
  destroyChart();
  refresh();
});

startOverBtn.addEventListener('click', () => {
  if (!confirm('Clear everything and start over? This deletes the tree on this device and cannot be undone.')) return;
  tree = createEmptyTree();
  tree.id = null;
  cloudDirty = false;
  focusPersonId = null;
  destroyChart();
  refresh();
});

// --- Account: sign in / out --------------------------------------------

function updateAccountUI(session) {
  currentSession = session;
  signInBtn.hidden = !!session;
  accountChip.hidden = !session;
  if (session) accountEmail.textContent = session.user.email;
}

signInBtn.addEventListener('click', () => {
  signInEmail.value = '';
  signInMessage.hidden = true;
  signInSubmitBtn.disabled = false;
  signInSubmitBtn.textContent = 'Send magic link';
  signInDialog.showModal();
});

signInCancelBtn.addEventListener('click', () => signInDialog.close());

googleSignInBtn.addEventListener('click', async () => {
  googleSignInBtn.disabled = true;
  try {
    await cloud.signInWithGoogle();
  } catch (err) {
    signInMessage.textContent = `Couldn't start Google sign-in: ${err.message}`;
    signInMessage.hidden = false;
    googleSignInBtn.disabled = false;
  }
});

signInForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = signInEmail.value.trim();
  if (!email) return;
  signInSubmitBtn.disabled = true;
  signInSubmitBtn.textContent = 'Sending…';
  try {
    await cloud.signInWithEmail(email);
    signInMessage.textContent = `Check ${email} for a sign-in link.`;
    signInMessage.hidden = false;
  } catch (err) {
    signInMessage.textContent = `Couldn't send that: ${err.message}`;
    signInMessage.hidden = false;
    signInSubmitBtn.disabled = false;
    signInSubmitBtn.textContent = 'Send magic link';
  }
});

signOutBtn.addEventListener('click', async () => {
  await cloud.signOut();
});

function handleAuthChange(session) {
  updateAccountUI(session);
  if (!session) {
    // Detach the working tree from any cloud row that belonged to the account that
    // just signed out; it stays editable as a local-only draft.
    tree.id = null;
    cloudDirty = false;
  }
  updateSaveStatus();
  if (signInDialog.open) signInDialog.close();
}

// --- Save to cloud -------------------------------------------------------

async function performCloudSave(name) {
  saveTreeSubmitBtn.disabled = true;
  saveTreeBtn.disabled = true;
  try {
    if (!tree.id) {
      tree.id = await cloud.createTree(currentSession.user.id, name, tree);
      tree.title = name;
    } else {
      if (name) tree.title = name;
      await cloud.updateTree(tree.id, tree.title, tree);
    }
    cloudDirty = false;
    updateSaveStatus();
    if (saveTreeDialog.open) saveTreeDialog.close();
  } catch (err) {
    saveTreeMessage.textContent = `Couldn't save: ${err.message}`;
    saveTreeMessage.hidden = false;
    saveStatusEl.textContent = `Save failed: ${err.message}`;
  } finally {
    saveTreeSubmitBtn.disabled = false;
    saveTreeBtn.disabled = false;
  }
}

saveTreeBtn.addEventListener('click', () => {
  if (tree.id) {
    performCloudSave();
    return;
  }
  saveTreeName.value = tree.title === 'Untitled tree' ? '' : tree.title;
  saveTreeMessage.hidden = true;
  saveTreeDialog.showModal();
});

saveTreeCancelBtn.addEventListener('click', () => saveTreeDialog.close());

saveTreeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = saveTreeName.value.trim() || 'Untitled tree';
  performCloudSave(name);
});

// --- My trees --------------------------------------------------------------

function renderMyTreesList(trees) {
  myTreesList.innerHTML = '';
  if (!trees.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = "You haven't saved any trees to the cloud yet.";
    myTreesList.appendChild(empty);
    return;
  }
  for (const t of trees) {
    const row = document.createElement('div');
    row.className = 'tree-list-item';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tree-list-main';
    main.innerHTML = `<span class="tree-list-name">${escapeHtml(t.name)}</span><span class="tree-list-updated">${relativeTime(t.updatedAt)}</span>`;
    main.addEventListener('click', () => openCloudTree(t.id));
    row.appendChild(main);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'node-btn node-btn-icon node-btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this tree';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
      await cloud.deleteTree(t.id);
      if (tree.id === t.id) {
        tree.id = null;
        cloudDirty = false;
        updateSaveStatus();
      }
      openMyTreesDialog();
    });
    row.appendChild(delBtn);

    myTreesList.appendChild(row);
  }
}

async function openMyTreesDialog() {
  myTreesDialog.showModal();
  myTreesList.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    renderMyTreesList(await cloud.listMyTrees());
  } catch (err) {
    myTreesList.innerHTML = `<p class="empty-state">Couldn't load your trees: ${escapeHtml(err.message)}</p>`;
  }
}

async function openCloudTree(id) {
  try {
    const data = await cloud.loadTree(id);
    tree = data;
    tree.id = id;
    cloudDirty = false;
    focusPersonId = null;
    destroyChart();
    refresh();
    myTreesDialog.close();
  } catch (err) {
    alert(`Couldn't open that tree: ${err.message}`);
  }
}

myTreesBtn.addEventListener('click', openMyTreesDialog);
myTreesCloseBtn.addEventListener('click', () => myTreesDialog.close());
newTreeBtn.addEventListener('click', () => {
  tree = createEmptyTree();
  cloudDirty = false;
  focusPersonId = null;
  destroyChart();
  refresh();
  myTreesDialog.close();
});

// --- Dialogs: click the backdrop to dismiss without applying anything ------
// A click lands directly on the <dialog> element itself only when it hits the
// backdrop, not any of the dialog's content (a click on content targets that child
// element instead) - the standard way to detect a backdrop click on a native dialog.
for (const dialog of [personMenuDialog, signInDialog, saveTreeDialog, myTreesDialog]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// --- Boot --------------------------------------------------------------

async function boot() {
  const cloudReady = await cloud.isCloudConfigured();
  const session = cloudReady ? await cloud.getSession() : null;

  const draft = loadDraft();
  if (draft) tree = draft;

  updateAccountUI(session);
  refresh();

  if (cloudReady) cloud.onAuthChange(handleAuthChange);
}

boot();
