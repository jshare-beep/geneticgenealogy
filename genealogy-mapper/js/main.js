import {
  createEmptyTree,
  buildIndices,
  addPerson,
  setPersonEvent,
  addLifeEvent,
  updateLifeEvent,
  removeLifeEvent,
  addUnion,
  addChildToUnion,
  addParentsToPerson,
  addSingleParent,
  inferMissingSexes,
  addSpouse,
  addRootPerson,
  addLineage,
  renameLineage,
  recolorLineage,
  removeLineage,
  restoreLineage,
  purgeExpiredTrash,
  TRASH_RETENTION_DAYS,
  removePersonCascade,
  setPersonManualCoords,
  addComparison,
  removeComparison,
} from './model/graph.js';
import { geocodePlace, geocodeAllPending, countPendingGeocodes, MIN_INTERVAL_MS } from './geocode/geocode.js';
import { parseGedcom, importGedcomIntoTree, importGedcomAncestorsIntoTree } from './import/gedcom.js';
import { parseCsv } from './import/csv.js';
import { importRowsIntoTree, ROW_FIELDS } from './import/rows.js';
import {
  initMap,
  getMap,
  renderMarkers,
  fitToBounds,
  followBounds,
  spawnCollisionStar,
  clearAllCollisionPulses,
  renderOverlapStars,
} from './map/mapView.js';
import { computeYearRange } from './map/timeline.js';
import { findPossibleOverlaps } from './map/overlap.js';
import { treeToF3Data } from './render/familyChartAdapter.js';
import { renderFanChart, renderBlankFanPlaceholder, pulseFanPerson, resetFanFit } from './render/fanChart.js';
import { computeMaxAncestorGen, buildAhnentafel } from './model/ahnentafel.js';
import { applyLocationInference } from './model/locationInference.js';
import { findOverlappingAncestors } from './model/ancestorMatch.js';
import { saveDraft, loadDraft, hasSeenOnboarding, markOnboardingSeen } from './sync/storage.js';
import * as cloud from './sync/supabaseClient.js';
import { buildSampleTree } from './sync/sampleData.js';
import { LINEAGE_PALETTE } from './util/color.js';
import { KM_TO_MILES } from './util/dates.js';

// --- DOM refs ----------------------------------------------------------------

const treeViewEl = document.getElementById('treeView');
const mapViewEl = document.getElementById('mapView');
const familyChartEl = document.getElementById('FamilyChart');
const emptyStateEl = document.getElementById('emptyState');
const treeModeCardsBtn = document.getElementById('treeModeCardsBtn');
const treeModeFanBtn = document.getElementById('treeModeFanBtn');
const fanGenerationsRow = document.getElementById('fanGenerationsRow');
const fanGenerationsSelect = document.getElementById('fanGenerationsSelect');
const diagramCountEl = document.getElementById('diagramCount');
const fanChartContainer = document.getElementById('fanChartContainer');
const startSampleBtn = document.getElementById('startSampleBtn');
const emptyStateGedcomLink = document.getElementById('emptyStateGedcomLink');
const emptyStateHandLink = document.getElementById('emptyStateHandLink');
const replayOnboardingBtn = document.getElementById('replayOnboardingBtn');
const startOverBtn = document.getElementById('startOverBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const helpBtn = document.getElementById('helpBtn');
const saveStatusEl = document.getElementById('saveStatus');

const onboardingDialog = document.getElementById('onboardingDialog');
const onboardingSkipBtn = document.getElementById('onboardingSkipBtn');
const onboardingWalkthroughBtn = document.getElementById('onboardingWalkthroughBtn');

const takeTourBtn = document.getElementById('takeTourBtn');
const tourOverlay = document.getElementById('tourOverlay');
const tourHighlightBox = document.getElementById('tourHighlightBox');
const tourCallout = document.getElementById('tourCallout');
const tourStepLabel = document.getElementById('tourStepLabel');
const tourTitle = document.getElementById('tourTitle');
const tourPreview = document.getElementById('tourPreview');
const tourBody = document.getElementById('tourBody');
const tourSkipBtn = document.getElementById('tourSkipBtn');
const tourNextBtn = document.getElementById('tourNextBtn');

const lineageListEl = document.getElementById('lineageList');
const importSummaryEl = document.getElementById('importSummary');
const addLineageBtn = document.getElementById('addLineageBtn');
const saveGroupingBtn = document.getElementById('saveGroupingBtn');
const addRootBtn = document.getElementById('addRootBtn');
const overlapCityList = document.getElementById('overlapCityList');
const overlapBroadList = document.getElementById('overlapBroadList');
const geocodeProgressEl = document.getElementById('geocodeProgress');
const geocodeClockEl = document.getElementById('geocodeClock');
const geocodeProgressTextEl = document.getElementById('geocodeProgressText');
const geocodeCongratsEl = document.getElementById('geocodeCongrats');
const peopleSearchInput = document.getElementById('peopleSearchInput');
const peopleSearchResults = document.getElementById('peopleSearchResults');
const reviewSection = document.getElementById('reviewSection');
const reviewCount = document.getElementById('reviewCount');
const reviewList = document.getElementById('reviewList');
const trashSection = document.getElementById('trashSection');
const trashCountEl = document.getElementById('trashCount');
const trashListEl = document.getElementById('trashList');

const mapContainer = document.getElementById('mapContainer');
const timelinePlayBtn = document.getElementById('timelinePlayBtn');
const timelineSlider = document.getElementById('timelineSlider');
const timelineYearLabel = document.getElementById('timelineYearLabel');
const timelineResetBtn = document.getElementById('timelineResetBtn');

const treeExpandBtn = document.getElementById('treeExpandBtn');
const mapExpandBtn = document.getElementById('mapExpandBtn');
const mapRefreshBtn = document.getElementById('mapRefreshBtn');
const mapStatusBadge = document.getElementById('mapStatusBadge');
const mapReadinessSummary = document.getElementById('mapReadinessSummary');
const mapReadinessList = document.getElementById('mapReadinessList');
const panelLightbox = document.getElementById('panelLightbox');
const panelLightboxContent = document.getElementById('panelLightboxContent');
const panelLightboxCloseBtn = document.getElementById('panelLightboxCloseBtn');

const personDialog = document.getElementById('personDialog');
const pName = document.getElementById('pName');
const pSexToggle = document.getElementById('pSexToggle');
const pLineage = document.getElementById('pLineage');
const pBirthDate = document.getElementById('pBirthDate');
const pBirthPlace = document.getElementById('pBirthPlace');
const pBirthGeoStatus = document.getElementById('pBirthGeoStatus');
const pBirthMap = document.getElementById('pBirthMap');
const pDeathDate = document.getElementById('pDeathDate');
const pDeathPlace = document.getElementById('pDeathPlace');
const pDeathGeoStatus = document.getElementById('pDeathGeoStatus');
const pDeathMap = document.getElementById('pDeathMap');
const pEventsList = document.getElementById('pEventsList');
const pAddEventBtn = document.getElementById('pAddEventBtn');
const pReviewBanner = document.getElementById('pReviewBanner');
const pReviewBannerText = document.getElementById('pReviewBannerText');
const pResolveReviewBtn = document.getElementById('pResolveReviewBtn');
const pLocationReviewBar = document.getElementById('pLocationReviewBar');
const pLocationReviewCount = document.getElementById('pLocationReviewCount');
const pLocationReviewNextBtn = document.getElementById('pLocationReviewNextBtn');
const pLocationReviewDoneBtn = document.getElementById('pLocationReviewDoneBtn');
const geocodeNoticeDialog = document.getElementById('geocodeNoticeDialog');
const geocodeNoticeMessage = document.getElementById('geocodeNoticeMessage');
const geocodeNoticeClock = document.getElementById('geocodeNoticeClock');
const geocodeNoticeProgress = document.getElementById('geocodeNoticeProgress');
const geocodeNoticeOkBtn = document.getElementById('geocodeNoticeOkBtn');
const locationPrecisionDialog = document.getElementById('locationPrecisionDialog');
const locationPrecisionMessage = document.getElementById('locationPrecisionMessage');
const locationPrecisionSkipBtn = document.getElementById('locationPrecisionSkipBtn');
const locationPrecisionWalkBtn = document.getElementById('locationPrecisionWalkBtn');
const reviewBroadLocationsBtn = document.getElementById('reviewBroadLocationsBtn');
const pSaveStatus = document.getElementById('pSaveStatus');
const pAddParentsBtn = document.getElementById('pAddParentsBtn');
const pAddSpouseBtn = document.getElementById('pAddSpouseBtn');
const pAddChildBtn = document.getElementById('pAddChildBtn');
const pDeleteBtn = document.getElementById('pDeleteBtn');
const pCloseBtn = document.getElementById('pCloseBtn');

const rootDialog = document.getElementById('rootDialog');
const rootName = document.getElementById('rootName');
const rootCancelBtn = document.getElementById('rootCancelBtn');
const rootCreateBtn = document.getElementById('rootCreateBtn');

const gedcomImportDialog = document.getElementById('gedcomImportDialog');
const openGedcomImportBtn = document.getElementById('openGedcomImportBtn');
const gedcomFileInput = document.getElementById('gedcomFileInput');
const gedcomScopeSection = document.getElementById('gedcomScopeSection');
const gedcomAncestorsOnly = document.getElementById('gedcomAncestorsOnly');
const gedcomRootPickerRow = document.getElementById('gedcomRootPickerRow');
const gedcomRootSearch = document.getElementById('gedcomRootSearch');
const gedcomRootResults = document.getElementById('gedcomRootResults');
const gedcomRootSelected = document.getElementById('gedcomRootSelected');
const gedcomLineageSelect = document.getElementById('gedcomLineageSelect');
const gedcomImportMessage = document.getElementById('gedcomImportMessage');
const gedcomImportCancelBtn = document.getElementById('gedcomImportCancelBtn');
const gedcomImportBtn = document.getElementById('gedcomImportBtn');

const csvImportDialog = document.getElementById('csvImportDialog');
const openCsvImportBtn = document.getElementById('openCsvImportBtn');
const csvFileInput = document.getElementById('csvFileInput');
const csvMappingArea = document.getElementById('csvMappingArea');
const csvLineageSelect = document.getElementById('csvLineageSelect');
const csvImportMessage = document.getElementById('csvImportMessage');
const csvImportCancelBtn = document.getElementById('csvImportCancelBtn');
const csvImportBtn = document.getElementById('csvImportBtn');

const gridImportDialog = document.getElementById('gridImportDialog');
const openGridImportBtn = document.getElementById('openGridImportBtn');
const bulkGridBody = document.getElementById('bulkGridBody');
const gridAddRowBtn = document.getElementById('gridAddRowBtn');
const gridLineageSelect = document.getElementById('gridLineageSelect');
const gridImportMessage = document.getElementById('gridImportMessage');
const gridImportCancelBtn = document.getElementById('gridImportCancelBtn');
const gridImportBtn = document.getElementById('gridImportBtn');

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

const myMapsBtn = document.getElementById('myMapsBtn');
const saveMapBtn = document.getElementById('saveMapBtn');
const saveMapDialog = document.getElementById('saveMapDialog');
const saveMapForm = document.getElementById('saveMapForm');
const saveMapName = document.getElementById('saveMapName');
const saveMapMessage = document.getElementById('saveMapMessage');
const saveMapSubmitBtn = document.getElementById('saveMapSubmitBtn');
const saveMapCancelBtn = document.getElementById('saveMapCancelBtn');
const myMapsDialog = document.getElementById('myMapsDialog');
const myMapsList = document.getElementById('myMapsList');
const newMapBtn = document.getElementById('newMapBtn');
const myMapsCloseBtn = document.getElementById('myMapsCloseBtn');

const createComparisonBtn = document.getElementById('createComparisonBtn');
const myComparisonsBtn = document.getElementById('myComparisonsBtn');
const comparisonDialog = document.getElementById('comparisonDialog');
const comparisonLineageChecklist = document.getElementById('comparisonLineageChecklist');
const comparisonNameInput = document.getElementById('comparisonNameInput');
const comparisonDialogMessage = document.getElementById('comparisonDialogMessage');
const comparisonCancelBtn = document.getElementById('comparisonCancelBtn');
const comparisonSaveBtn = document.getElementById('comparisonSaveBtn');
const myComparisonsDialog = document.getElementById('myComparisonsDialog');
const myComparisonsList = document.getElementById('myComparisonsList');
const newComparisonFromDialogBtn = document.getElementById('newComparisonFromDialogBtn');
const myComparisonsCloseBtn = document.getElementById('myComparisonsCloseBtn');

const findAncestorMatchesBtn = document.getElementById('findAncestorMatchesBtn');
const ancestorMatchDialog = document.getElementById('ancestorMatchDialog');
const ancestorMatchIntro = document.getElementById('ancestorMatchIntro');
const ancestorMatchList = document.getElementById('ancestorMatchList');
const ancestorMatchCloseBtn = document.getElementById('ancestorMatchCloseBtn');

// --- State ---------------------------------------------------------------

let tree = createEmptyTree();
let chart = null;
let personMenuId = null;
let focusPersonId = null; // who the tree view is currently centered on
let currentSession = null;
let cloudConfigured = false;
let cloudDirty = false;
let currentOverlaps = [];
// The same groups as currentOverlaps, but carrying the numbering/isAllLines info
// computeNumberedOverlaps works out once per refresh() - see renderMap's own
// time-filtering of both of these against currentYear below, so a crossing centuries
// later than wherever the timeline's currently scrubbed to doesn't already show up.
let currentNumberedOverlaps = [];

let mapInstance = null;
let userMovedMap = false;
let hiddenLineageIds = new Set();
// A line can be visible on the map (hiddenLineageIds above) but skipped when computing
// possible overlaps - useful once one line is huge and mostly just adding noise/slowdown
// to the overlap search for the others, without wanting to hide it from the map itself.
let excludedOverlapLineageIds = new Set();
let timelineActive = false;
let currentYear = null;
let playTimer = null;
let geocodingInFlight = false;
let lastActiveSignature = null; // who the camera is currently following, so it only re-flies when that set changes
let seenCollisions = new Set(); // pair keys already surfaced this playback run, so a resumed/rescrubbed run doesn't repeat them

// --- Helpers ---------------------------------------------------------------

function escapeHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMsg(el, text) {
  el.textContent = text;
  el.hidden = false;
}

// A persistent (not auto-hiding) note on exactly what the last GEDCOM/CSV/rows import
// actually did - how many people were in the source versus how many landed in the
// tree, and why, when the two numbers differ. Sits right at the top of "Family trees"
// so it's the first thing visible after an import, and stays up (surviving refresh()
// re-renders of the rest of the sidebar) until either a new import replaces it or the
// user dismisses it themselves - a message that vanishes on its own before someone's
// had a chance to read it doesn't fix "I have no way of knowing what happened."
function showImportSummary(html) {
  importSummaryEl.innerHTML = `<span>${html}</span><button type="button" class="import-summary-dismiss" title="Dismiss">✕</button>`;
  importSummaryEl.hidden = false;
  importSummaryEl.querySelector('.import-summary-dismiss').addEventListener('click', () => {
    importSummaryEl.hidden = true;
  });
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

// --- Tree view (family-chart) -----------------------------------------------

function cardInnerHtmlCreator(d) {
  const datum = d.data.data;
  if (datum.isPlaceholder) {
    return `
      <div class="f3-person-inner is-placeholder">
        <span class="f3-placeholder-label">+ Add ${datum.placeholderSlot === 'father' ? 'father' : 'mother'}</span>
      </div>
    `;
  }
  const name = escapeHtml(datum.name || '(unnamed)');
  const years = datum.years;
  const classes = ['f3-person-inner'];
  if (datum.isRoot) classes.push('is-root');

  const style = datum.lineageColor ? ` style="border-color:${datum.lineageColor};"` : '';

  return `
    <div class="${classes.join(' ')}"${style}>
      <button type="button" class="f3-menu-hint" data-open-menu title="Open details">⋯</button>
      ${datum.lineageName ? `<div class="f3-lineage-flag" style="color:${datum.lineageColor || 'inherit'}">${escapeHtml(datum.lineageName)}</div>` : ''}
      ${datum.isRoot ? `<div class="f3-root-flag">★ Starting person</div>` : ''}
      <div class="f3-person-main">
        <span class="f3-person-name">${name}</span>
        ${years ? `<span class="f3-person-years">${escapeHtml(years)}</span>` : ''}
      </div>
    </div>
  `;
}

// family-chart is a "main person" pedigree renderer: it only draws whoever is
// connected to a single chosen "main" id, so with multiple unrelated starting people
// (the normal case here - two separate paper trails, not yet known to connect) only
// one tree is visible at a time. focusPersonId tracks whichever person was last opened,
// so the tree view follows wherever you're actually looking instead of always
// snapping back to whichever root happened to be created first.
function currentMainId() {
  if (focusPersonId && tree.people[focusPersonId]) return focusPersonId;
  const root = Object.values(tree.people).find((p) => p.isRoot);
  return root ? root.id : Object.keys(tree.people)[0];
}

// A card click is either a real person (open their edit card, without shifting which
// person the whole tree is rooted on - see the keepFocus note on openPersonMenu) or one
// of the synthetic "+ Add father"/"+ Add mother" placeholders injected by
// treeToF3Data's ancestor-gap-filling (id shaped "ph:<childId>:<father|mother>") - fill
// in just that one slot and open the new person's card.
function handleCardClick(d) {
  const id = d?.data?.id;
  if (!id) return;
  if (id.startsWith('ph:')) {
    const [, childId, slot] = id.split(':');
    addAncestorParent(childId, slot);
    return;
  }
  if (!tree.people[id]) return;
  openPersonMenu(id, { keepFocus: true });
}

function buildCardsF3Data() {
  return treeToF3Data(tree, buildIndices(tree), { ancestorRootId: currentMainId(), maxAncestorGen: 7 });
}

// family-chart's own default view logic is "fit the whole rendered tree to the
// container" (tree_position: 'fit', and 'initial: true' forces this same fit
// regardless of tree_position) - with 7 generations of ancestors and 10 of
// descendants now always in the data (see buildCardsF3Data), that fit routinely
// shrinks everything to a couple percent scale to cram it all in, which is exactly the
// unreadable-smear startup view. Its 'main_to_middle' alternative (even with an
// explicit `scale`) turns out not to reliably escape that same tiny scale for a tree
// this size either - tested directly against this exact library build - so
// centerCardsViewOnMain does it by hand instead: read the root card's own actual
// on-screen position (whatever scale it's currently, possibly wrongly, at) to work out
// where it sits in the tree's untransformed coordinate space, then write a fresh
// pan/zoom transform putting that point at the container's center at a fixed, legible
// scale. It also has to write that transform onto every `.cards_view` element -
// family-chart renders cards and connector-lines into two separate internal layers
// both with that class, and its own positioning logic only actually updates one of
// them. Re-centers only when the root actually changes; an ordinary edit elsewhere
// passes a tree_position family-chart doesn't recognize, which per its own source
// leaves the current pan/zoom untouched instead of refitting on every edit.
let lastChartMainId = null;
const CARDS_DEFAULT_SCALE = 0.6;

function applyCardsViewCenter(scale = CARDS_DEFAULT_SCALE) {
  const container = familyChartEl;
  const zoomNode = [container, ...container.querySelectorAll('*')].find((el) => '__zoom' in el);
  const mainCard = container.querySelector('.card-main');
  const cardsViews = container.querySelectorAll('.cards_view');
  const containerRect = container.getBoundingClientRect();
  const cardRect = mainCard?.getBoundingClientRect();
  if (!zoomNode || !cardsViews.length || !cardRect?.width || !containerRect.width) return false;

  const currentZoom = zoomNode.__zoom;
  const cardCenterX = cardRect.x + cardRect.width / 2 - containerRect.x;
  const cardCenterY = cardRect.y + cardRect.height / 2 - containerRect.y;
  const localX = (cardCenterX - currentZoom.x) / currentZoom.k;
  const localY = (cardCenterY - currentZoom.y) / currentZoom.k;

  const x = containerRect.width / 2 - localX * scale;
  const y = containerRect.height / 2 - localY * scale;

  zoomNode.__zoom.k = scale;
  zoomNode.__zoom.x = x;
  zoomNode.__zoom.y = y;
  for (const cardsView of cardsViews) {
    cardsView.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
  return true;
}

let cardsViewGuardTimer = null;

// A single call isn't enough: family-chart keeps nudging its own internal position
// asynchronously (a frame or more after updateTree() returns, sometimes more than
// once) for a bit after the tree changes shape, which can silently re-break the fix.
// Keeps reasserting the centered, legible view for a couple seconds after a root
// change so it wins regardless of exactly when that settles, then stops - well before
// the user would plausibly start panning/zooming by hand.
function centerCardsViewOnMain(scale = CARDS_DEFAULT_SCALE) {
  clearInterval(cardsViewGuardTimer);
  const deadline = Date.now() + 2000;
  cardsViewGuardTimer = setInterval(() => {
    applyCardsViewCenter(scale);
    if (Date.now() > deadline) clearInterval(cardsViewGuardTimer);
  }, 50);
}

function ensureChart(f3Data) {
  const mainId = currentMainId();
  const rootChanged = mainId !== lastChartMainId;
  if (chart) {
    chart.updateData(f3Data);
    chart.updateMainId(mainId);
    chart.updateTree({ tree_position: rootChanged ? 'main_to_middle' : 'inherit', transition_time: 0 });
    lastChartMainId = mainId;
    if (rootChanged) centerCardsViewOnMain();
    return;
  }
  chart = window.f3
    .createChart('#FamilyChart', f3Data)
    .setTransitionTime(300)
    .setCardXSpacing(240)
    .setCardYSpacing(150)
    .setShowSiblingsOfMain(true)
    .setSingleParentEmptyCard(false)
    .setAncestryDepth(7)
    .setProgenyDepth(10);
  const card = chart.setCardHtml().setCardInnerHtmlCreator(cardInnerHtmlCreator);
  card.setOnCardClick((e, d) => handleCardClick(d));
  chart.updateMainId(mainId);
  chart.updateTree({ tree_position: 'main_to_middle', transition_time: 0 });
  lastChartMainId = mainId;
  centerCardsViewOnMain();
}

function destroyChart() {
  familyChartEl.innerHTML = '';
  chart = null;
}

// --- Fan chart mode ------------------------------------------------------------
//
// A second, ancestors-only view alongside the card-based pedigree above - same focus
// person (currentMainId()), different shape. Switching away from Cards tears down the
// family-chart instance so it rebuilds fresh (with correct container dimensions) the
// next time it's shown, rather than risk it laying out against a hidden, zero-size
// container.

// Fan, not Cards - this is the view a returning researcher actually wants to land on
// (an ancestor-only radial view of whichever tree was last open), not a first-timer's
// orientation view.
let treeMode = 'fan';
// Either a fixed number or the literal string 'all' - resolved to an actual number
// (via computeMaxAncestorGen) right before each fan chart render, since "all" depends
// on the current root and can change as data is added. Counts the root as its own
// generation (see the Generations <select> in index.html and the note on
// resolvedMaxGen below) - a fixed value here is always one more than the number of
// ancestor rings actually drawn.
let fanGenerations = fanGenerationsSelect.value === 'all' ? 'all' : parseInt(fanGenerationsSelect.value, 10) || 6;

function setTreeMode(mode) {
  if (treeMode === mode) return;
  if (treeMode === 'cards') destroyChart();
  treeMode = mode;
  treeModeCardsBtn.classList.toggle('is-active', mode === 'cards');
  treeModeFanBtn.classList.toggle('is-active', mode === 'fan');
  fanGenerationsRow.hidden = mode !== 'fan';
  refresh();
}
treeModeCardsBtn.addEventListener('click', () => setTreeMode('cards'));
treeModeFanBtn.addEventListener('click', () => setTreeMode('fan'));

fanGenerationsSelect.addEventListener('change', () => {
  fanGenerations = fanGenerationsSelect.value === 'all' ? 'all' : parseInt(fanGenerationsSelect.value, 10) || 6;
  refresh();
});

// --- Map view ----------------------------------------------------------------

function computeVisibleLineageIds() {
  if (hiddenLineageIds.size === 0) return null;
  const visible = new Set(Object.keys(tree.lineages).filter((id) => !hiddenLineageIds.has(id)));
  visible.add(null);
  return visible;
}

function updateTimelineUI() {
  const { min, max } = computeYearRange(tree);
  timelineSlider.min = String(min);
  timelineSlider.max = String(max);
  if (!timelineActive) {
    timelineSlider.value = String(max);
    timelineYearLabel.textContent = 'All';
  } else {
    const y = currentYear ?? max;
    timelineSlider.value = String(y);
    timelineYearLabel.textContent = String(y);
  }
}

// Renders the current frame, then - only while the timeline is engaged - follows the
// camera to whoever is currently alive. Outside of that, keeps re-fitting to the FULL
// growing set of geocoded places on every render - not just once - until the user
// actually takes the camera into their own hands (drags, scrolls to zoom, or
// double-clicks). A one-time-only initial fit used to mean the very first fit (often
// against just one or two places that happened to already be cached) was the last one
// the map ever did on its own: as live geocoding resolved dozens more places over the
// next several minutes, the view stayed stuck on that first tiny slice - "starts in
// America, zoom out and there's nothing else to see" - because nothing ever told it to
// look again. `forceFitAll` (from "Show all") also un-sticks a view the user HAD taken
// over, since clicking that is exactly asking for the full picture back.
// Whether a possible-overlap group's own window (already the narrow span where every
// member could actually have been there at once - see findTimeOverlapGroups in
// map/overlap.js) contains currentYear. Only meaningful while the timeline's engaged -
// with it off, every group is "in play" at once, which is the point of "Show all."
function isOverlapGroupInPlay(group) {
  return !timelineActive || (currentYear >= group.startYear && currentYear <= group.endYear);
}

function renderMap({ forceFitAll = false } = {}) {
  if (!mapInstance) return;
  updateTimelineUI();
  // Filtered to whichever crossings currentYear has actually reached - without this, a
  // lead from the 1920s was drawn (dashed gold lines here, its own star below) on the
  // very first frame of playback at the timeline's earliest year, before the animation
  // had gotten anywhere near it.
  const overlapGroupsInPlay = currentOverlaps.filter(isOverlapGroupInPlay);
  const { bounds, activeBounds } = renderMarkers(tree, {
    currentYear: timelineActive ? currentYear : null,
    visibleLineageIds: computeVisibleLineageIds(),
    overlapGroups: overlapGroupsInPlay,
  });
  renderOverlapStars(currentNumberedOverlaps.filter((n) => isOverlapGroupInPlay(n.group)));
  if (forceFitAll) userMovedMap = false;
  if (!timelineActive && !userMovedMap && bounds.length) {
    fitToBounds(bounds);
  }
  if (timelineActive) followActiveBounds(activeBounds);
}

// Re-flies the camera only when the CAST actually changed since the last frame -
// comparing person ids, not coordinates. Someone mid-transit between two waypoints
// gets a new interpolated lat/lng on almost every tick even though nothing about
// who's on screen changed - re-flying for that was fighting itself: each 220ms tick
// could cancel the previous tick's still-in-flight camera animation, which read as
// jittery rather than smooth. The camera now holds still through a stretch where the
// same people are just continuing their own routes, and only re-fits when the roster
// changes (someone enters/exits the story) OR someone currently on screen has drifted
// outside the current view (a long solo migration, not a same-place-more-or-less
// wobble).
//
// Frames EVERYONE currently active, not just the largest cluster of them (tried once,
// reverted) - hiding whoever wasn't in the biggest group made a real crossing between
// two smaller, far-apart groups invisible, and made the camera jump between regions
// with no visible reason (someone seeming to vanish, or the view suddenly "flying" off
// with no on-screen indication of why). Seeing the actual distance between two people
// - even a large one - IS the point of this map; the fix for "too much empty space"
// is tight fitBounds padding (see followBounds in map/mapView.js), not hiding people.
function followActiveBounds(activeEntries) {
  if (!activeEntries.length) return;
  const rosterSignature = activeEntries
    .map((e) => e.personId)
    .sort()
    .join('|');
  const rosterChanged = rosterSignature !== lastActiveSignature;
  const latLngs = activeEntries.map((e) => e.latLng);
  if (!rosterChanged) {
    const viewBounds = getMap()?.getBounds();
    const stillInView = viewBounds && latLngs.every((ll) => viewBounds.contains(ll));
    if (stillInView) return;
  }
  lastActiveSignature = rosterSignature;
  followBounds(latLngs);
}

function groupKey(group) {
  return group.members
    .map((m) => m.personId)
    .sort()
    .join('|');
}

// Checks the already-computed possible-overlap groups for any whose own overlap window
// (already the precise intersection of every member's presence interval - see
// map/overlap.js) contains the current animation year. Every matching group fires, not
// just the first - each just spawns its own star and the animation keeps playing, so
// several genuine crossings the same year all get shown rather than only one being
// picked arbitrarily. Broad/statewide-only groups (isCityLevel: false - two people who
// only ever share a state-level "somewhere in New York" match) are skipped entirely:
// they're common enough, and loose enough, that surfacing every one of them is just
// noise, not a real lead - see isCityLevel in map/overlap.js.
function checkForCollisions() {
  if (currentYear == null) return;
  for (const group of currentOverlaps) {
    if (!group.isCityLevel) continue;
    const key = groupKey(group);
    if (seenCollisions.has(key)) continue;
    if (currentYear < group.startYear || currentYear > group.endYear) continue;
    seenCollisions.add(key);
    triggerCollision(group);
  }
}

// A gold star bangs onto the map right where the crossing happens - playback never
// stops for it. Pausing (and needing a "Continue" click) to explain every crossing
// used to mean the animation kept getting interrupted, sometimes many times per run;
// the star is legible on its own and the possible-overlaps list underneath the map
// already has the names/places/years for anyone who wants to look them up.
function triggerCollision(group) {
  const lat = group.members.reduce((sum, m) => sum + m.lat, 0) / group.members.length;
  const lng = group.members.reduce((sum, m) => sum + m.lng, 0) / group.members.length;
  spawnCollisionStar(lat, lng, '#c4a524');
}

function stopPlaying() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  timelinePlayBtn.textContent = '▶';
}

function onYearChanged() {
  renderMap();
  checkForCollisions();
}

// Plays forward from the oldest recorded generation toward the present - the more
// intuitive reading order (this ancestor, then their child, then theirs...) and the
// one that lets a crossing actually read as cause-and-effect ("these two were in the
// same place, and THEN...") rather than working backward from an already-known
// outcome. Resuming an already-started run picks up where it left off, but starting
// fresh (or having reached the most recent generation) restarts at the oldest year and
// forgets which crossings were already shown.
function startPlayback() {
  timelineActive = true;
  const { min, max } = computeYearRange(tree);
  if (currentYear == null || currentYear >= max) {
    currentYear = min;
    seenCollisions = new Set();
    lastActiveSignature = null;
    onYearChanged();
  }
  timelinePlayBtn.textContent = '⏸';
  playTimer = setInterval(() => {
    const { max: curMax } = computeYearRange(tree);
    currentYear += 1;
    if (currentYear > curMax) {
      stopPlaying();
      return;
    }
    onYearChanged();
  }, 220);
}

timelineSlider.addEventListener('input', () => {
  stopPlaying();
  clearAllCollisionPulses();
  timelineActive = true;
  currentYear = parseInt(timelineSlider.value, 10);
  onYearChanged();
});

timelineResetBtn.addEventListener('click', () => {
  stopPlaying();
  clearAllCollisionPulses();
  timelineActive = false;
  currentYear = null;
  seenCollisions = new Set();
  lastActiveSignature = null;
  renderMap({ forceFitAll: true });
});

timelinePlayBtn.addEventListener('click', () => {
  if (playTimer) {
    stopPlaying();
    return;
  }
  startPlayback();
});

document.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.map-popup-edit');
  if (editBtn) {
    openPersonMenu(editBtn.dataset.personId, { keepFocus: true });
    if (treeMode === 'fan') pulseFanPerson(editBtn.dataset.personId);
    return;
  }
  if (!e.target.closest('.lineage-swatch-wrap')) {
    document.querySelectorAll('.lineage-color-popover').forEach((p) => {
      p.hidden = true;
    });
  }
  if (!e.target.closest('.lineage-remove')) {
    document.querySelectorAll('.lineage-remove.is-confirming').forEach((btn) => {
      clearTimeout(btn._revertTimer);
      btn.classList.remove('is-confirming');
      btn.textContent = '🗑️';
      btn.title = 'Delete this family tree and everyone in it (recoverable for 30 days - see Recently deleted)';
    });
  }
});

// --- Map panel (always mounted, alongside the tree - not a tab you switch to) ------

function initMapPanel() {
  mapInstance = initMap('mapContainer');
  renderMap();
  window.addEventListener('resize', () => mapInstance?.invalidateSize());

  // Marks the camera as user-controlled the moment someone actually drags, scroll- or
  // double-click-zooms, or uses the +/- buttons - as opposed to any of this app's OWN
  // programmatic moves (fitToBounds, followBounds), which never touch this flag. Once
  // set, renderMap stops auto-fitting on its own so it isn't fighting whatever the
  // user just deliberately looked at; "Show all" is the explicit way back.
  mapInstance.on('dragstart', () => {
    userMovedMap = true;
  });
  const mapEl = mapInstance.getContainer();
  mapEl.addEventListener('wheel', () => { userMovedMap = true; }, { passive: true });
  mapEl.addEventListener('dblclick', () => { userMovedMap = true; });
  mapEl.addEventListener('click', (e) => {
    if (e.target.closest('.leaflet-control-zoom-in, .leaflet-control-zoom-out')) userMovedMap = true;
  });
}

// Re-centers the fan chart to whatever the panel's new pixel size actually is, so it
// stays properly fit/centered regardless of how big the browser window is - without
// this, resizing after the fan's already rendered once would leave it fit to the OLD
// size (see resetFanFit in render/fanChart.js for why refresh() alone isn't enough).
// Debounced since 'resize' fires continuously while a window is actively being
// dragged, and re-fitting is real layout+render work, not something to redo per pixel.
let fanResizeTimer = null;
window.addEventListener('resize', () => {
  if (treeMode !== 'fan') return;
  clearTimeout(fanResizeTimer);
  fanResizeTimer = setTimeout(() => {
    resetFanFit();
    refresh();
  }, 150);
});

// --- Lineage panel ---------------------------------------------------------
//
// Colors are picked from the app's own hedgerow palette, not an arbitrary native color
// picker - swatch click opens a small popover of palette dots (closed by the delegated
// document click handler below whenever the click lands outside it).

function buildLineageSwatch(lineage) {
  const wrap = document.createElement('div');
  wrap.className = 'lineage-swatch-wrap';

  const swatchBtn = document.createElement('button');
  swatchBtn.type = 'button';
  swatchBtn.className = 'lineage-swatch-btn';
  swatchBtn.style.background = lineage.color;
  swatchBtn.title = 'Change color';

  const popover = document.createElement('div');
  popover.className = 'lineage-color-popover';
  popover.hidden = true;
  for (const color of LINEAGE_PALETTE) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'lineage-color-dot';
    if (color === lineage.color) dot.classList.add('is-selected');
    dot.style.background = color;
    dot.title = color;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      recolorLineage(tree, lineage.id, color);
      refresh();
    });
    popover.appendChild(dot);
  }

  swatchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = popover.hidden;
    document.querySelectorAll('.lineage-color-popover').forEach((p) => {
      p.hidden = true;
    });
    popover.hidden = !wasHidden;
  });

  wrap.appendChild(swatchBtn);
  wrap.appendChild(popover);
  return wrap;
}

function renderLineageList() {
  lineageListEl.innerHTML = '';
  const lineages = Object.values(tree.lineages);
  if (!lineages.length) {
    lineageListEl.innerHTML = '<p class="empty-state">No family trees yet.</p>';
    return;
  }
  for (const lineage of lineages) {
    const row = document.createElement('div');
    row.className = 'lineage-row';

    row.appendChild(buildLineageSwatch(lineage));

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'lineage-name-input';
    nameInput.value = lineage.name;
    nameInput.addEventListener('change', () => {
      renameLineage(tree, lineage.id, nameInput.value.trim() || 'Untitled family tree');
      refresh();
    });
    row.appendChild(nameInput);

    const count = Object.values(tree.people).filter((p) => p.lineageId === lineage.id).length;
    const countEl = document.createElement('span');
    countEl.className = 'lineage-count';
    countEl.textContent = String(count);
    row.appendChild(countEl);

    // A custom pill toggle, not the browser's native checkbox - its own OS-blue check
    // mark would fight the family tree's own color right next to it. The real
    // `<input type="checkbox">` stays underneath (just visually hidden), so this is
    // still a proper, keyboard- and screen-reader-operable checkbox, not a div
    // pretending to be one - only its painted appearance is custom.
    const visWrap = document.createElement('label');
    visWrap.className = 'lineage-toggle';
    visWrap.style.setProperty('--toggle-color', lineage.color);
    visWrap.title = 'Include this family tree on the map and in the timeline animation';

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'lineage-visibility';
    vis.checked = !hiddenLineageIds.has(lineage.id);
    vis.addEventListener('change', () => {
      if (vis.checked) hiddenLineageIds.delete(lineage.id);
      else hiddenLineageIds.add(lineage.id);
      renderMap();
    });
    const visTrack = document.createElement('span');
    visTrack.className = 'lineage-toggle-track';
    visWrap.appendChild(vis);
    visWrap.appendChild(visTrack);
    row.appendChild(visWrap);

    // Separate from map visibility above: a line can stay visible on the map but be
    // skipped when computing "possible overlaps" - handy once one huge line is mostly
    // just adding noise (or slowing the search down) for everyone else's matches.
    const overlapBtn = document.createElement('button');
    overlapBtn.type = 'button';
    overlapBtn.className = 'lineage-overlap-btn';
    overlapBtn.textContent = '🔍';
    const computesOverlap = !excludedOverlapLineageIds.has(lineage.id);
    overlapBtn.classList.toggle('is-off', !computesOverlap);
    overlapBtn.title = computesOverlap
      ? 'Included when searching for possible overlaps with other family trees - click to exclude'
      : 'Excluded from the overlap search - click to include';
    overlapBtn.addEventListener('click', () => {
      if (excludedOverlapLineageIds.has(lineage.id)) excludedOverlapLineageIds.delete(lineage.id);
      else excludedOverlapLineageIds.add(lineage.id);
      refresh();
    });
    row.appendChild(overlapBtn);

    const rootPerson = Object.values(tree.people).find((p) => p.isRoot && p.lineageId === lineage.id);
    if (rootPerson) {
      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'lineage-focus-btn';
      focusBtn.textContent = '🌳';
      focusBtn.title = `View ${rootPerson.name || 'their'}'s tree`;
      focusBtn.addEventListener('click', () => {
        focusPersonId = rootPerson.id;
        refresh();
        treeViewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      row.appendChild(focusBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'lineage-remove';
    removeBtn.textContent = '🗑️';
    removeBtn.title = 'Delete this family tree and everyone in it (recoverable for 30 days - see Recently deleted)';
    // Two-click confirm instead of a native confirm() popup: first click arms it
    // ("Sure?"), a second click within a few seconds actually deletes. Arms itself back
    // off on its own (timeout, or a click elsewhere - see the delegated document click
    // handler below) so an abandoned click doesn't leave a live "delete" button armed.
    removeBtn.addEventListener('click', () => {
      if (!removeBtn.classList.contains('is-confirming')) {
        removeBtn.classList.add('is-confirming');
        removeBtn.textContent = 'Sure?';
        removeBtn.title = `Click again to delete "${lineage.name}" and everyone in it (recoverable for 30 days)`;
        clearTimeout(removeBtn._revertTimer);
        removeBtn._revertTimer = setTimeout(() => {
          removeBtn.classList.remove('is-confirming');
          removeBtn.textContent = '🗑️';
          removeBtn.title = 'Delete this family tree and everyone in it (recoverable for 30 days - see Recently deleted)';
        }, 4000);
        return;
      }
      clearTimeout(removeBtn._revertTimer);
      removeLineage(tree, lineage.id);
      refresh();
    });
    row.appendChild(removeBtn);

    lineageListEl.appendChild(row);
  }
}

addLineageBtn.addEventListener('click', () => {
  addLineage(tree, {});
  refresh();
});

function populateLineageSelect(selectEl) {
  selectEl.innerHTML = '';
  for (const lineage of Object.values(tree.lineages)) {
    const opt = document.createElement('option');
    opt.value = lineage.id;
    opt.textContent = lineage.name;
    selectEl.appendChild(opt);
  }
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New family tree…';
  selectEl.appendChild(newOpt);
}

function resolveLineageSelection(selectEl) {
  if (selectEl.value === '__new__') {
    const name = prompt('Name this new family tree:', 'New family tree');
    if (!name) return null;
    return addLineage(tree, { name }).id;
  }
  return selectEl.value || null;
}

// --- Person search -----------------------------------------------------------
//
// The tree view only draws whoever's connected to the current focus person, and the
// map only plots whoever's geocoded - so anyone who's neither (a standalone import row
// with no linked parents yet, someone with no place recorded) would otherwise be
// impossible to find or open at all. This is the one search surface that doesn't care
// about connectivity or location.

function renderPeopleSearch() {
  const query = peopleSearchInput.value.trim().toLowerCase();
  peopleSearchResults.innerHTML = '';
  if (!query) return;

  const matches = Object.values(tree.people)
    .filter((p) => (p.name || '').toLowerCase().includes(query))
    .slice(0, 25);

  if (!matches.length) {
    peopleSearchResults.innerHTML = '<p class="empty-state">No one matches.</p>';
    return;
  }

  for (const person of matches) {
    const lineage = tree.lineages[person.lineageId];
    const years = [person.birth.year, person.death.year].filter((y) => y != null).join('–');
    const row = document.createElement('div');
    row.className = 'people-search-row';
    row.innerHTML = `<span class="people-search-name" style="color:${lineage?.color || 'inherit'}">${escapeHtml(person.name || '(unnamed)')}</span><span class="people-search-meta">${escapeHtml(years)}</span>`;
    row.addEventListener('click', () => {
      // Never re-root the tree view onto whoever a search finds - see the keepFocus
      // note on openPersonMenu. In fan view, pulseFanPerson pans/flashes their wedge
      // in place instead, so the search result and the freshly-opened edit card are
      // both visible together without ever moving what the fan is centered on.
      openPersonMenu(person.id, { keepFocus: true });
      if (treeMode === 'fan') pulseFanPerson(person.id);
    });
    peopleSearchResults.appendChild(row);
  }
}

peopleSearchInput.addEventListener('input', renderPeopleSearch);

// --- Needs review --------------------------------------------------------------
//
// The direct answer to "where do I go fix the things you flagged": a standing list,
// always visible while anything's flagged, of every person who either has a note (set
// by an import that wasn't fully confident - see sampleData.js for the clearest
// example) or is still missing a name. No searching required.

function needsReview(person) {
  return !!(person.notes && person.notes.trim()) || !(person.name && person.name.trim());
}

function renderReviewList() {
  const flagged = Object.values(tree.people).filter(needsReview);
  reviewSection.hidden = flagged.length === 0;
  reviewCount.textContent = flagged.length ? String(flagged.length) : '';
  reviewList.innerHTML = '';

  for (const person of flagged) {
    const lineage = tree.lineages[person.lineageId];
    const row = document.createElement('div');
    row.className = 'review-row';
    const label = person.name && person.name.trim() ? person.name : '(name not yet filled in)';
    row.innerHTML = `<div class="review-row-name" style="color:${lineage?.color || 'inherit'}">${escapeHtml(label)}</div>${person.notes ? `<div class="review-row-note">${escapeHtml(person.notes)}</div>` : ''}`;
    row.addEventListener('click', () => {
      openPersonMenu(person.id, { keepFocus: true });
      if (treeMode === 'fan') pulseFanPerson(person.id);
    });
    reviewList.appendChild(row);
  }
}

// --- Trash (soft-deleted lines) ---------------------------------------------
//
// A deleted line's people are actually gone from the live tree the moment you delete
// it (see removeLineage in model/graph.js) - this panel is what makes that survivable:
// every entry here can be put back exactly as it was, for TRASH_RETENTION_DAYS after
// deletion, before it's purged for real (purgeExpiredTrash, called once at boot).

function daysLeft(deletedAt) {
  const elapsedMs = Date.now() - new Date(deletedAt).getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsedDays));
}

function renderTrashList() {
  const entries = tree.trash || [];
  trashSection.hidden = entries.length === 0;
  trashCountEl.textContent = entries.length ? String(entries.length) : '';
  trashListEl.innerHTML = '';

  // Most recently deleted first - that's the one someone's most likely here to undo.
  for (const entry of [...entries].reverse()) {
    const row = document.createElement('div');
    row.className = 'trash-row';

    const swatch = document.createElement('span');
    swatch.className = 'trash-row-swatch';
    swatch.style.background = entry.lineage.color;
    row.appendChild(swatch);

    const info = document.createElement('div');
    info.className = 'trash-row-info';
    const peopleCount = Object.keys(entry.people).length;
    const left = daysLeft(entry.deletedAt);
    info.innerHTML = `<div class="trash-row-name">${escapeHtml(entry.lineage.name)}</div><div class="trash-row-meta">${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} · ${left <= 0 ? 'expiring soon' : `${left} day${left === 1 ? '' : 's'} left`}</div>`;
    row.appendChild(info);

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn btn-secondary btn-sm';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => {
      restoreLineage(tree, entry.id);
      destroyChart();
      refresh();
    });
    row.appendChild(restoreBtn);

    trashListEl.appendChild(row);
  }
}

// --- Overlap panel -----------------------------------------------------------

// A person's age in a given year, from their own recorded birth year - null (shown as
// no age at all, rather than a guess) whenever either side of that subtraction isn't
// known.
function ageInYear(person, year) {
  if (person.birth?.year == null || year == null) return null;
  return year - person.birth.year;
}

// "possible years they're living there": a waypoint's own widened startYear-endYear
// (see model/presence.js - the gap to its neighboring waypoints, since we rarely know
// the exact day someone moved on), not just the single dated year the record itself
// carries - that single year is still shown via `label` (Born/Died/a life event's own
// date) right before it. Age is computed at both ends of that same range, so a wide
// range reads as a wide age range too, rather than one potentially-misleading single
// number.
function formatPossibleYearsAndAge(person, m) {
  const yearsLabel = m.startYear === m.endYear ? String(m.startYear) : `${m.startYear}–${m.endYear}`;
  const ageStart = ageInYear(person, m.startYear);
  const ageEnd = ageInYear(person, m.endYear);
  const ageLabel = ageStart == null || ageEnd == null ? '' : ageStart === ageEnd ? ` (age ${ageStart})` : ` (age ${ageStart}–${ageEnd})`;
  return `possibly ${yearsLabel}${ageLabel}`;
}

// One row's worth of markup: the shared time window, then each person involved with
// their own specific place and possible year range within that window (not their
// birth/death - the waypoint that actually put them here), then how tight the cluster
// is, in both units since "30 miles" and "30 km" mean pretty different things to plan
// an actual trip around.
function overlapRowHtml(group) {
  const windowLabel = group.startYear === group.endYear ? String(group.startYear) : `${group.startYear}–${group.endYear}`;
  const membersHtml = group.members
    .map((m) => {
      const person = tree.people[m.personId];
      if (!person) return '';
      const lineage = tree.lineages[m.lineageId];
      return `<div class="overlap-member">
        <span class="overlap-member-dot" style="background:${lineage?.color || '#7d8f95'}"></span>
        <span class="overlap-member-name">${escapeHtml(person.name || '(unnamed)')}</span>
        <span class="overlap-member-place">${m.label ? escapeHtml(m.label) + ' ' : ''}${escapeHtml(m.place)} · ${escapeHtml(formatPossibleYearsAndAge(person, m))}${
        m.isInferred ? ` <span class="overlap-member-inferred">inferred ${escapeHtml(m.sourceLabel || '')}</span>` : ''
      }</span>
      </div>`;
    })
    .join('');
  const distanceMiles = group.distanceKm * KM_TO_MILES;
  return `<div class="overlap-window">${escapeHtml(windowLabel)}</div>
    ${membersHtml}
    <div class="overlap-meta">~${Math.round(distanceMiles)} mi (~${Math.round(group.distanceKm)} km) apart</div>`;
}

// The app's actual thesis, checked directly: a real crossing worth citing by number is
// specifically a woman from one family tree and a man from another turning up in the
// same place at the same time - not just any two people, regardless of sex, sharing a
// spot (which is what `group` alone guarantees). `group.members` already spans 2+
// distinct lineages by construction (see findTimeOverlapGroups in map/overlap.js); this
// only asks whether an F and an M within it are in DIFFERENT lineages from each other.
function qualifiesAsFemaleMale(group) {
  for (const a of group.members) {
    const personA = tree.people[a.personId];
    if (!personA || personA.sex !== 'F') continue;
    for (const b of group.members) {
      if (b === a) continue;
      const personB = tree.people[b.personId];
      if (personB && personB.sex === 'M' && b.lineageId !== a.lineageId) return true;
    }
  }
  return false;
}

// Only city-precision, female/male-qualifying groups get numbered/starred at all - a
// state-level "Missouri and Missouri" match, or a same-sex/unknown-sex pairing, isn't
// the specific kind of lead this app is built to surface (see qualifiesAsFemaleMale
// above). Within that set, spanning EVERY family tree currently loaded (only
// meaningful once there are 3+ - with exactly 2, every cross-line match trivially
// spans "all" of them) is the strongest possible shape of lead: those get numbered
// #1, #2... in the order they happen in time, and the bold, continuously-glowing gold
// star both on the map (see renderOverlapStars in map/mapView.js) and in the list
// here. The same shape of lead across only SOME of the lines still gets flagged - a
// paler yellow, no number - since it's still worth a glance, just not worth citing.
function computeNumberedOverlaps(groups, totalLineageCount) {
  const qualifying = groups.filter((g) => g.isCityLevel && qualifiesAsFemaleMale(g));
  const isAllLines = (g) => totalLineageCount >= 3 && g.lineageIds.length === totalLineageCount;
  const allLines = qualifying
    .filter(isAllLines)
    .sort((a, b) => a.startYear - b.startYear || groupKey(a).localeCompare(groupKey(b)))
    .map((group, i) => ({ group, isAllLines: true, number: i + 1 }));
  const partial = qualifying.filter((g) => !isAllLines(g)).map((group) => ({ group, isAllLines: false, number: null }));
  return [...allLines, ...partial];
}

// A read-only illustrative map for one overlap row - every member's own waypoint as a
// dot in their lineage's color, and the same narrow shared window already shown above
// the row in text (the span where every member here could ALL have been present at
// once - see findTimeOverlapGroups in map/overlap.js) repeated as a caption on the map
// itself. Lazily created only when a row's "Show map" toggle is opened, and torn down
// again when it's closed or the list re-renders - there can be dozens of rows, and a
// live Leaflet instance per row up front would be needless overhead for ones nobody
// ever looks at.
function renderOverlapMiniMap(key, container, group) {
  destroyMiniMap(key);
  container.innerHTML = '';
  const windowLabel = group.startYear === group.endYear ? String(group.startYear) : `${group.startYear}–${group.endYear}`;
  const caption = document.createElement('p');
  caption.className = 'overlap-mini-map-caption';
  caption.textContent = `Narrow window everyone could have been here: ${windowLabel}`;
  container.appendChild(caption);
  const canvas = document.createElement('div');
  canvas.className = 'mini-map-canvas';
  container.appendChild(canvas);

  const points = group.members.filter((m) => m.lat != null && m.lng != null).map((m) => [m.lat, m.lng]);
  if (!points.length) return;

  const map = window.L.map(canvas, { attributionControl: false, scrollWheelZoom: false });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
  miniMaps.set(key, map);

  for (const m of group.members) {
    if (m.lat == null || m.lng == null) continue;
    const person = tree.people[m.personId];
    const lineage = tree.lineages[m.lineageId];
    window.L.circleMarker([m.lat, m.lng], {
      radius: 7,
      color: lineage?.color || '#7d8f95',
      fillColor: lineage?.color || '#7d8f95',
      fillOpacity: 0.85,
      weight: 2,
    })
      .addTo(map)
      .bindTooltip(escapeHtml(person?.name || '(unnamed)'));
  }

  if (points.length === 1) {
    map.setView(points[0], 11);
  } else {
    map.fitBounds(points, { padding: [24, 24], maxZoom: 12 });
  }

  // Same reasoning as every other mini-map here: the container was just given real
  // size by unhiding it, but Leaflet measured it before that layout took effect.
  requestAnimationFrame(() => map.invalidateSize());
}

function renderOverlapGroupsInto(container, groups, numberLookup) {
  container.innerHTML = '';
  if (!groups.length) {
    container.innerHTML = '<p class="empty-state">None found yet — add locations to people in at least two family trees to check.</p>';
    return;
  }
  for (const group of groups) {
    const info = numberLookup.get(groupKey(group));
    const row = document.createElement('div');
    row.className = 'overlap-row';
    if (info?.isAllLines) row.classList.add('is-all-lines');
    else if (info) row.classList.add('is-partial-lead');
    const numberBadge = info?.number ? `<span class="overlap-row-number">#${info.number}</span>` : '';
    row.innerHTML = numberBadge + overlapRowHtml(group);
    row.addEventListener('click', () => focusOverlapGroup(group));

    // A separate toggle, not folded into the row's own click-to-focus-the-main-map
    // behavior above - clicking to peek at a tiny illustrative map here is a different
    // action from clicking to fly the real map over to this group, and both stay
    // available side by side (stopPropagation keeps the toggle from also triggering
    // the row's own click).
    const mapKey = `overlap:${groupKey(group)}:${group.startYear}-${group.endYear}`;
    const mapToggleBtn = document.createElement('button');
    mapToggleBtn.type = 'button';
    mapToggleBtn.className = 'overlap-map-toggle';
    mapToggleBtn.textContent = '🗺 Show map';
    const mapContainer = document.createElement('div');
    mapContainer.className = 'overlap-mini-map';
    mapContainer.hidden = true;
    mapContainer.addEventListener('click', (e) => e.stopPropagation());

    mapToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = mapContainer.hidden;
      mapContainer.hidden = !willShow;
      mapToggleBtn.textContent = willShow ? '🗺 Hide map' : '🗺 Show map';
      if (willShow) {
        renderOverlapMiniMap(mapKey, mapContainer, group);
      } else {
        destroyMiniMap(mapKey);
        mapContainer.innerHTML = '';
      }
    });

    row.appendChild(mapToggleBtn);
    row.appendChild(mapContainer);
    container.appendChild(row);
  }
}

// Split by how precisely the matched places are known: a real city/town match on both
// sides (or a hand-placed pin) is a genuine lead worth checking first; a match that only
// exists because two records both said "Missouri" or "Ontario" is far weaker and belongs
// in its own, clearly-labeled second tier rather than mixed in with the tight ones.
function renderOverlapList() {
  // Both lists below get fully rebuilt (container.innerHTML = '') on every call, which
  // would otherwise leak any Leaflet instance a still-open "Show map" toggle left
  // live - their DOM node is gone, but the map object itself isn't, without this.
  destroyMiniMapsWithPrefix('overlap:');
  const groups = findPossibleOverlaps(tree, { excludeLineageIds: excludedOverlapLineageIds });
  const totalLineageCount = Object.keys(tree.lineages).length;
  const numbered = computeNumberedOverlaps(groups, totalLineageCount);
  const numberLookup = new Map(numbered.map((n) => [groupKey(n.group), n]));

  const cityGroups = groups.filter((g) => g.isCityLevel);
  const broadGroups = groups.filter((g) => !g.isCityLevel);

  renderOverlapGroupsInto(overlapCityList, cityGroups, numberLookup);
  renderOverlapGroupsInto(overlapBroadList, broadGroups, numberLookup);
  // Numbering is assigned once here, in chronological order across the WHOLE tree, so
  // a given crossing keeps the same number as playback moves through it rather than
  // being renumbered every frame - renderMap() below does the actual time-filtering,
  // showing only whichever of these currentYear has already reached.
  currentNumberedOverlaps = numbered;

  return groups;
}

// Works the same whether the timeline is mid-playback or already paused - stopping
// playback first means the very next animation tick can't immediately re-fly the
// camera out from under the view this just asked for.
function focusOverlapGroup(group) {
  stopPlaying();
  mapViewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  getMap()?.fitBounds(
    group.members.map((m) => [m.lat, m.lng]),
    { padding: [80, 80], maxZoom: 10 }
  );
}

// --- Core refresh --------------------------------------------------------

function refresh() {
  inferMissingSexes(tree);
  const indices = buildIndices(tree);
  // A no-op once everything resolvable already has been (an already-city-precision
  // event, inferred or not, is left alone - see applyLocationInference) - safe to just
  // always re-run rather than tracking when it might newly succeed.
  applyLocationInference(tree, indices);
  const hasPeople = Object.keys(tree.people).length > 0;
  emptyStateEl.style.display = hasPeople ? 'none' : 'flex';
  startOverBtn.hidden = !hasPeople;

  familyChartEl.style.display = hasPeople && treeMode === 'cards' ? 'flex' : 'none';
  // Before there's anyone to draw, the fan panel stays up (regardless of the Cards/Fan
  // toggle) showing a blank, clickable placeholder instead of going dark - so the very
  // first thing you see already looks like where your tree will grow from.
  fanChartContainer.style.display = !hasPeople || treeMode === 'fan' ? 'flex' : 'none';

  if (!hasPeople) {
    renderBlankFanPlaceholder(fanChartContainer, () => addRootBtn.click());
    diagramCountEl.hidden = true;
  } else if (treeMode === 'cards') {
    ensureChart(buildCardsF3Data());
    diagramCountEl.hidden = true;
  } else {
    const mainId = currentMainId();
    // fanGenerations counts the root as its own generation ("the root person is a generation") -
    // buildAhnentafel's own convention counts the root as generation 0, so a fixed
    // count needs -1 to reach the equivalent ancestor-rings-beyond-root value. "All"
    // isn't a count at all, so it's unaffected by which convention is in play.
    const resolvedMaxGen = fanGenerations === 'all' ? Math.max(1, computeMaxAncestorGen(tree, indices, mainId)) : fanGenerations - 1;
    renderFanChart(fanChartContainer, tree, indices, mainId, {
      maxGen: resolvedMaxGen,
      onPersonClick: (id) => openPersonMenu(id, { keepFocus: true }),
      onAddParent: addAncestorParent,
    });
    // The fan only ever shows ONE person's direct ancestor line, capped at
    // resolvedMaxGen - never the whole lineage's roster (siblings, descendants,
    // anyone not on this exact ancestor path are all left out on purpose). Surfacing
    // that gap here - the sidebar's own per-lineage count is the "in the tree" number,
    // this is the "in the diagram" one - is what actually explains a smaller count in
    // the diagram than in the family trees list above, rather than leaving it looking
    // like data went missing.
    const mainPerson = tree.people[mainId];
    const lineageTotal = mainPerson ? Object.values(tree.people).filter((p) => p.lineageId === mainPerson.lineageId).length : 0;
    const shownCount = new Set([...buildAhnentafel(tree, indices, mainId, resolvedMaxGen).values()].filter(Boolean)).size;
    if (mainPerson && shownCount < lineageTotal) {
      diagramCountEl.hidden = false;
      diagramCountEl.textContent = `Showing ${shownCount} of ${lineageTotal} people — ${mainPerson.name || 'this person'}'s direct ancestors only`;
    } else {
      diagramCountEl.hidden = true;
    }
  }

  currentOverlaps = renderOverlapList();
  renderLineageList();
  renderPeopleSearch();
  renderReviewList();
  renderTrashList();
  updateReviewBroadLocationsBtn();
  renderMap();
  updateMapRefreshBtn();
  renderMapReadiness();
  updateMapStatusBadge();
  persist();

  // Every field in the person dialog calls refresh() on change, so this is the one
  // place that reliably sees every edit - confirming right where the edit was made,
  // rather than leaving it to the topbar's save status (out of view while the dialog
  // is open) to imply the same thing.
  if (personDialog.open) {
    pSaveStatus.textContent = '✓ Saved';
    pSaveStatus.classList.add('is-visible');
  }
}

// --- Geocoding integration -------------------------------------------------

// inferredFrom (only ever set alongside status 'inferred') names which relative and
// place the dot was borrowed from - shown instead of a bare "located" claim so this
// reads as the guess it is, not a real geocode, and stays correctable the same way a
// wrong real geocode already is (edit the place, or drag the mini-map pin).
function geoStatusLabel(status, inferredFrom) {
  if (status === 'ok') return { text: '✓ Located on map', cls: 'is-ok' };
  if (status === 'manual') return { text: '✓ Manually set', cls: 'is-ok' };
  if (status === 'inferred') {
    const who = inferredFrom?.name || 'a relative';
    return { text: `✓ Estimated from ${who}'s ${inferredFrom?.place || 'location'}`, cls: 'is-inferred' };
  }
  if (status === 'failed') return { text: "Couldn't find this place — try adding more detail", cls: 'is-failed' };
  if (status === 'pending') return { text: 'Looking up…', cls: 'is-pending' };
  return { text: '', cls: '' };
}

function updateGeoStatusUI(which, status, inferredFrom) {
  const el = which === 'birth' ? pBirthGeoStatus : pDeathGeoStatus;
  el.classList.remove('is-ok', 'is-failed', 'is-pending', 'is-inferred');
  const { text, cls } = geoStatusLabel(status, inferredFrom);
  el.textContent = text;
  if (cls) el.classList.add(cls);
}

// --- Manual map correction ---------------------------------------------------
//
// Free-text geocoding occasionally guesses wrong (a misspelled or ambiguous place name
// can silently resolve to somewhere on the wrong continent) with no obvious sign
// anything's off, and sometimes it can't resolve a place at all. Every birth, death,
// and other-place-lived event gets its own small map with a draggable pin, so a bad
// guess - or a place that never geocoded - can be corrected by hand without the place
// text itself needing to describe anywhere real.

const miniMaps = new Map(); // key ('birth' | 'death' | 'event:<id>') -> Leaflet map instance

function destroyMiniMap(key) {
  const map = miniMaps.get(key);
  if (map) {
    map.remove();
    miniMaps.delete(key);
  }
}

function destroyMiniMapsWithPrefix(prefix) {
  for (const key of Array.from(miniMaps.keys())) {
    if (key.startsWith(prefix)) destroyMiniMap(key);
  }
}

function renderMiniMap(key, container, ev, onSetLocation) {
  destroyMiniMap(key);
  container.innerHTML = '';
  const canvas = document.createElement('div');
  canvas.className = 'mini-map-canvas';
  container.appendChild(canvas);
  const hint = document.createElement('p');
  hint.className = 'mini-map-hint';
  container.appendChild(hint);

  const hasCoords = ev.lat != null && ev.lng != null;
  const map = window.L.map(canvas, { attributionControl: false, scrollWheelZoom: false }).setView(
    hasCoords ? [ev.lat, ev.lng] : [20, 0],
    hasCoords ? 9 : 1.5
  );
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
  miniMaps.set(key, map);

  let marker = null;
  function placeMarker(latlng) {
    if (marker) {
      marker.setLatLng(latlng);
    } else {
      marker = window.L.marker(latlng, { draggable: true }).addTo(map);
      marker.on('dragend', () => onSetLocation(marker.getLatLng().lat, marker.getLatLng().lng));
    }
  }
  if (hasCoords) placeMarker([ev.lat, ev.lng]);

  map.on('click', (e) => {
    placeMarker(e.latlng);
    onSetLocation(e.latlng.lat, e.latlng.lng);
  });

  hint.textContent = hasCoords
    ? 'Drag the pin to fix the spot, or click elsewhere on the map.'
    : 'Click the map to set an exact location by hand.';

  // The dialog may have just become visible, so the container had zero size when the
  // map measured it - nudge Leaflet to re-measure once the browser's actually painted.
  requestAnimationFrame(() => map.invalidateSize());
}

function setManualLocation(person, which, lat, lng) {
  setPersonManualCoords(person, which, lat, lng);
  if (personMenuId === person.id) updateGeoStatusUI(which, 'manual');
  refresh();
}

function renderBirthDeathMiniMaps(person) {
  renderMiniMap('birth', pBirthMap, person.birth, (lat, lng) => setManualLocation(person, 'birth', lat, lng));
  renderMiniMap('death', pDeathMap, person.death, (lat, lng) => setManualLocation(person, 'death', lat, lng));
}

async function geocodeAndRefresh(person, which) {
  const ev = person[which];
  if (!ev.place || ev.geocodeStatus !== 'pending') return;
  const result = await geocodePlace(ev.place, `${person.id}:${which}`);
  if (result === undefined || result === null) {
    ev.geocodeStatus = 'failed';
  } else {
    ev.lat = result.lat;
    ev.lng = result.lng;
    ev.geocodeStatus = 'ok';
    ev.precision = result.precision ?? null;
  }
  if (personMenuId === person.id) {
    updateGeoStatusUI(which, ev.geocodeStatus, ev.inferredFrom);
    renderMiniMap(which, which === 'birth' ? pBirthMap : pDeathMap, ev, (lat, lng) => setManualLocation(person, which, lat, lng));
  }
  refresh();
}

// --- Other places lived (life events) ---------------------------------------

async function geocodeLifeEventAndRefresh(person, eventId) {
  const event = (person.events || []).find((e) => e.id === eventId);
  if (!event || !event.place || event.geocodeStatus !== 'pending') return;
  const result = await geocodePlace(event.place, `${person.id}:${event.id}`);
  if (result === undefined || result === null) {
    event.geocodeStatus = 'failed';
  } else {
    event.lat = result.lat;
    event.lng = result.lng;
    event.geocodeStatus = 'ok';
    event.precision = result.precision ?? null;
  }
  if (personMenuId === person.id) renderPersonEventsList(person);
  refresh();
}

function setManualLifeEventLocation(person, event, lat, lng) {
  event.lat = lat;
  event.lng = lng;
  event.geocodeStatus = 'manual';
  event.precision = 'city';
  event.inferredFrom = null;
  if (personMenuId === person.id) {
    const statusEl = document.querySelector(`.event-row[data-event-id="${event.id}"] .geo-status`);
    if (statusEl) {
      statusEl.classList.remove('is-ok', 'is-failed', 'is-pending');
      const { text, cls } = geoStatusLabel('manual');
      statusEl.textContent = text;
      if (cls) statusEl.classList.add(cls);
    }
  }
  refresh();
}

function renderPersonEventsList(person) {
  destroyMiniMapsWithPrefix('event:');
  pEventsList.innerHTML = '';
  for (const event of person.events || []) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.eventId = event.id;

    const fieldsRow = document.createElement('div');
    fieldsRow.className = 'form-row event-fields-row';

    const dateInput = document.createElement('input');
    dateInput.type = 'text';
    dateInput.placeholder = 'Date (e.g. 1870)';
    dateInput.value = event.date || '';

    const placeInput = document.createElement('input');
    placeInput.type = 'text';
    placeInput.placeholder = 'Place (e.g. Chicago, Illinois)';
    placeInput.value = event.place || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'event-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this date & place';

    const statusEl = document.createElement('p');
    statusEl.className = 'geo-status';
    const { text: statusText, cls: statusCls } = geoStatusLabel(event.geocodeStatus, event.inferredFrom);
    statusEl.textContent = statusText;
    if (statusCls) statusEl.classList.add(statusCls);

    dateInput.addEventListener('change', () => {
      updateLifeEvent(person, event.id, { date: dateInput.value });
      refresh();
    });
    placeInput.addEventListener('change', () => {
      updateLifeEvent(person, event.id, { place: placeInput.value });
      renderPersonEventsList(person);
      refresh();
      geocodeLifeEventAndRefresh(person, event.id);
    });
    removeBtn.addEventListener('click', () => {
      removeLifeEvent(person, event.id);
      renderPersonEventsList(person);
      refresh();
    });

    const mapEl = document.createElement('div');
    mapEl.className = 'mini-map';

    fieldsRow.appendChild(dateInput);
    fieldsRow.appendChild(placeInput);
    fieldsRow.appendChild(removeBtn);
    row.appendChild(fieldsRow);
    row.appendChild(statusEl);
    row.appendChild(mapEl);
    pEventsList.appendChild(row);

    renderMiniMap(`event:${event.id}`, mapEl, event, (lat, lng) => setManualLifeEventLocation(person, event, lat, lng));
  }
}

pAddEventBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  addLifeEvent(person, {});
  renderPersonEventsList(person);
});

// Nominatim's usage policy caps every client (this app, run from anyone's browser) at
// 1 request/second, hard - there's no way to safely go faster without risking the
// whole app getting IP-blocked for every user, not just one. This is a rough estimate
// (results that hit the cache, or "at sea" places that never touch the network, finish
// instantly - so real time is usually somewhat less), not a guarantee.
function estimatedSeconds(count) {
  return Math.ceil((count * MIN_INTERVAL_MS) / 1000);
}
// Same estimate as the live clock below, worded to stand on its own ("about 2 minutes")
// rather than count down - for the one-time notice's opening message, not the live
// status line.
function formatDuration(count) {
  const totalSeconds = estimatedSeconds(count);
  if (totalSeconds < 60) return `${totalSeconds} seconds`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes === 1 ? '1 minute' : minutes + ' minutes'}`;
}
// MM:SS, for the actual ticking clock display (as opposed to formatDuration's standalone
// prose) - a real clock face reads at a glance in a way "~24m 9s left" doesn't.
function formatClock(remainingCount) {
  const totalSeconds = estimatedSeconds(remainingCount);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Below this, the worst-case wait (well under 20 seconds) is short enough that a whole
// dialog about it would be more disruptive than the wait itself - the sidebar's own
// progress clock under Add people still shows for those, just without interrupting
// anything to say so.
const GEOCODE_NOTICE_THRESHOLD = 15;

// Shown once, right after a bulk import, only when there's actually enough pending
// geocoding for someone to plausibly get confused and think the app hung. Doesn't
// gate or pause anything - runGeocodingPass is already running underneath it by the
// time this shows, and dismissing this has no effect on that.
function maybeShowGeocodeNotice(pendingCount) {
  if (pendingCount < GEOCODE_NOTICE_THRESHOLD) return;
  geocodeNoticeMessage.textContent =
    `That added ${pendingCount} places that still need a spot on the map. We look them up one at a time - one ` +
    `lookup per second, that's the free map service's rule, not ours - and any place shared by more than one ` +
    `person (a whole family from the same town, say) only gets looked up once, not once per person. At that ` +
    `pace, your map should be built in about ${formatDuration(pendingCount)} or less. You don't need to wait ` +
    `here for it: close this and keep working, switch tabs, or close the window entirely - there's a live ` +
    `countdown clock right here in the sidebar under "Add people" the whole time, and reopening the app later ` +
    `picks up wherever it left off.`;
  geocodeNoticeClock.textContent = formatClock(pendingCount);
  geocodeNoticeProgress.textContent = `0 of ${pendingCount} found`;
  geocodeNoticeDialog.showModal();
}
geocodeNoticeOkBtn.addEventListener('click', () => geocodeNoticeDialog.close());

// How long the "your map is ready" message stays up before fading back out on its own -
// long enough to notice even for someone who's mid-scroll or looked away, short enough
// not to linger as stale-looking clutter under Add people for the rest of the session.
const GEOCODE_CONGRATS_DISPLAY_MS = 8000;
let geocodeCongratsTimer = null;

async function runGeocodingPass() {
  if (geocodingInFlight) return;
  const total = countPendingGeocodes(tree);
  if (!total) return;
  clearTimeout(geocodeCongratsTimer);
  geocodeCongratsEl.hidden = true;
  geocodingInFlight = true;
  geocodeProgressEl.hidden = false;
  updateMapStatusBadge();
  await geocodeAllPending(tree, {
    onProgress: (done, totalCount) => {
      const remaining = totalCount - done;
      geocodeClockEl.textContent = formatClock(remaining);
      geocodeProgressTextEl.textContent = `${done} of ${totalCount} places found`;
      // Harmless to keep writing this while geocodeNoticeDialog is closed - it's just
      // not visible to anyone until the next time (if ever) that dialog is open.
      geocodeNoticeClock.textContent = formatClock(remaining);
      geocodeNoticeProgress.textContent = `${done} of ${totalCount} found`;
      if (done % 5 === 0 || done === totalCount) {
        renderMap();
        updateMapStatusBadge();
        persist();
      }
    },
  });
  geocodeProgressEl.hidden = true;
  geocodingInFlight = false;
  // "or less" in the opening notice becomes true right here surprisingly often - a
  // cache hit or an "at sea" placement resolves instantly, with no network call at all,
  // so a batch full of repeats or a few unresolvable places routinely finishes faster
  // than its own worst-case estimate.
  geocodeCongratsEl.textContent = '🎉 All done — your map is ready to view!';
  geocodeCongratsEl.hidden = false;
  geocodeCongratsTimer = setTimeout(() => {
    geocodeCongratsEl.hidden = true;
  }, GEOCODE_CONGRATS_DISPLAY_MS);
  refresh();
}

// --- Person dialog -----------------------------------------------------------

function populatePersonLineageSelect() {
  pLineage.innerHTML = '<option value="">— unassigned —</option>';
  for (const lineage of Object.values(tree.lineages)) {
    const opt = document.createElement('option');
    opt.value = lineage.id;
    opt.textContent = lineage.name;
    pLineage.appendChild(opt);
  }
}

// `keepFocus` lets a caller open someone's edit card without also re-rooting whichever
// tree view (Cards/Fan) is currently showing onto them - otherwise every incidental
// click to check or fill in a person silently drags the whole chart's center along with
// it, which is exactly the "view keeps changing on me" problem this fixes. The only
// call sites that still want the center to move are the ones deliberately choosing a
// new starting person to build from ("+ Name a starting person", a family tree's own
// 🌳 button) - everything else that just opens someone's card (the sidebar search,
// Needs review, a fan wedge, a Cards card) passes keepFocus: true, since finding or
// checking on someone is never itself a request to re-root the whole view onto them.
function openPersonMenu(personId, { keepFocus = false } = {}) {
  const person = tree.people[personId];
  if (!person) return;
  personMenuId = personId;
  if (!keepFocus) focusPersonId = personId;

  pName.value = person.name || '';
  setSexToggle(person.sex || 'U');
  populatePersonLineageSelect();
  pLineage.value = person.lineageId || '';
  pBirthDate.value = person.birth.date || '';
  pBirthPlace.value = person.birth.place || '';
  pBirthPlace.classList.remove('needs-city');
  pDeathDate.value = person.death.date || '';
  pDeathPlace.value = person.death.place || '';
  pDeathPlace.classList.remove('needs-city');
  updateGeoStatusUI('birth', person.birth.geocodeStatus, person.birth.inferredFrom);
  updateGeoStatusUI('death', person.death.geocodeStatus, person.death.inferredFrom);
  renderBirthDeathMiniMaps(person);
  renderPersonEventsList(person);
  updateReviewBanner(person.notes);
  pSaveStatus.textContent = '';
  pSaveStatus.classList.remove('is-visible');

  // Re-populating the same open dialog for the next person in a location-review queue
  // (see advanceLocationReview) calls this without a close in between - showModal()
  // throws if called on a dialog that's already open, so only call it when needed.
  if (!personDialog.open) personDialog.showModal();
}

function updateReviewBanner(notes) {
  const text = (notes || '').trim();
  pReviewBanner.hidden = !text;
  pReviewBannerText.textContent = text;
}

// --- Location-detail review (walking through people an import left at broad precision) --
//
// A place is "broad" once geocoded (state/county/country-level - see classifyPrecision
// in geocode.js) rather than pinned to an actual city/town: two people both just
// recorded as "Missouri" could be 300 miles apart, so every broad-precision place is
// pure noise for the whole point of this app (spotting real crossed paths), not just a
// slightly-worse pin. maybePromptForLocationDetail (called after an import's geocoding
// pass finishes - see runGeocodingPass) offers to walk through exactly the people that
// import just added whose birth or death only resolved that broadly, one at a time,
// so a paper trail with real city-level records in hand can actually use them instead
// of quietly degrading to a same-state-only match.
function needsCityDetail(ev) {
  return !!ev.place && ev.precision !== 'city';
}
function personNeedsCityDetail(personId) {
  const p = tree.people[personId];
  return !!p && (needsCityDetail(p.birth) || needsCityDetail(p.death));
}

let locationReviewQueue = null;
let locationReviewIndex = 0;

function maybePromptForLocationDetail(importedIds) {
  const needsDetail = importedIds.filter(personNeedsCityDetail);
  if (!needsDetail.length) return;
  locationPrecisionMessage.textContent =
    `${needsDetail.length} of the ${importedIds.length} people just added only have a state, county, or ` +
    `country-level place for their birth or death - not tight enough to catch a real overlap, only a ` +
    `same-state one. Add a closer city for them now, or skip and work with what's there.`;
  locationReviewQueue = needsDetail;
  locationReviewIndex = 0;
  locationPrecisionDialog.showModal();
}

function advanceLocationReview() {
  if (!locationReviewQueue) return;
  while (locationReviewIndex < locationReviewQueue.length && !personNeedsCityDetail(locationReviewQueue[locationReviewIndex])) {
    locationReviewIndex++; // already fixed (or deleted) since the queue was built - skip it
  }
  if (locationReviewIndex >= locationReviewQueue.length) {
    endLocationReview();
    personDialog.close();
    return;
  }
  const id = locationReviewQueue[locationReviewIndex];
  openPersonMenu(id, { keepFocus: true });
  const person = tree.people[id];
  pBirthPlace.classList.toggle('needs-city', needsCityDetail(person.birth));
  pDeathPlace.classList.toggle('needs-city', needsCityDetail(person.death));
  pLocationReviewBar.hidden = false;
  pLocationReviewCount.textContent = `${locationReviewIndex + 1} of ${locationReviewQueue.length} — add a city for the highlighted field below`;
}

function endLocationReview() {
  locationReviewQueue = null;
  locationReviewIndex = 0;
  pLocationReviewBar.hidden = true;
}

// Covers everyone in the tree, not just whatever an import just added - the entry
// point for going back and tightening up locations that were already broad-precision
// before this feature existed, or that someone chose "Continue with general mapping"
// on at import time. No separate confirm dialog first: clicking a button whose own
// label already says what it does IS the confirmation.
function updateReviewBroadLocationsBtn() {
  const count = Object.keys(tree.people).filter(personNeedsCityDetail).length;
  reviewBroadLocationsBtn.hidden = count === 0;
  reviewBroadLocationsBtn.textContent = `Add city detail to ${count} vague location${count === 1 ? '' : 's'}`;
}
reviewBroadLocationsBtn.addEventListener('click', () => {
  const needsDetail = Object.keys(tree.people).filter(personNeedsCityDetail);
  if (!needsDetail.length) return;
  locationReviewQueue = needsDetail;
  locationReviewIndex = 0;
  advanceLocationReview();
});

locationPrecisionSkipBtn.addEventListener('click', () => {
  locationReviewQueue = null;
  locationPrecisionDialog.close();
});
locationPrecisionWalkBtn.addEventListener('click', () => {
  locationPrecisionDialog.close();
  advanceLocationReview();
});
pLocationReviewNextBtn.addEventListener('click', () => {
  locationReviewIndex++;
  advanceLocationReview();
});
pLocationReviewDoneBtn.addEventListener('click', () => {
  endLocationReview();
  personDialog.close();
});

// Most fields already commit on their own 'change' event (blur), but that depends on
// the field actually losing focus before the dialog closes - true for the normal "click
// Done" path, but not guaranteed for every way a <dialog> can close (Escape, clicking
// the backdrop). This is the safety net: whenever the dialog closes, for ANY reason,
// whatever's currently in the form gets written to the person one last time. Re-writing
// unchanged values is harmless - the underlying setters no-op when nothing differs.
function commitPersonFieldsFromForm() {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  if (!person) return;
  person.name = pName.value;
  person.sex = getSexToggleValue();
  person.lineageId = pLineage.value || null;
  setPersonEvent(person, 'birth', { date: pBirthDate.value, place: pBirthPlace.value });
  setPersonEvent(person, 'death', { date: pDeathDate.value, place: pDeathPlace.value });
  refresh();
}

// Fires for every way the dialog can close (Done, Escape, clicking the backdrop) -
// the one place that reliably runs the safety-net commit above and clears whose menu
// is open, instead of each closing path needing to remember to do both itself.
personDialog.addEventListener('close', () => {
  commitPersonFieldsFromForm();
  personMenuId = null;
  destroyMiniMap('birth');
  destroyMiniMap('death');
  destroyMiniMapsWithPrefix('event:');
  endLocationReview();
});

pResolveReviewBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  if (!person) return;
  person.notes = '';
  updateReviewBanner('');
  refresh();
});

pName.addEventListener('change', () => {
  if (!personMenuId) return;
  tree.people[personMenuId].name = pName.value;
  refresh();
});
function setSexToggle(sex) {
  for (const btn of pSexToggle.children) btn.classList.toggle('is-active', btn.dataset.sex === sex);
}
function getSexToggleValue() {
  return pSexToggle.querySelector('.is-active')?.dataset.sex || 'U';
}
pSexToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.sex-btn');
  if (!btn || !personMenuId) return;
  setSexToggle(btn.dataset.sex);
  tree.people[personMenuId].sex = btn.dataset.sex;
  refresh();
});
pLineage.addEventListener('change', () => {
  if (!personMenuId) return;
  tree.people[personMenuId].lineageId = pLineage.value || null;
  refresh();
});
pBirthDate.addEventListener('change', () => {
  if (!personMenuId) return;
  setPersonEvent(tree.people[personMenuId], 'birth', { date: pBirthDate.value });
  refresh();
});
pBirthPlace.addEventListener('change', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  setPersonEvent(person, 'birth', { place: pBirthPlace.value });
  updateGeoStatusUI('birth', person.birth.geocodeStatus, person.birth.inferredFrom);
  renderMiniMap('birth', pBirthMap, person.birth, (lat, lng) => setManualLocation(person, 'birth', lat, lng));
  refresh();
  geocodeAndRefresh(person, 'birth');
});
pDeathDate.addEventListener('change', () => {
  if (!personMenuId) return;
  setPersonEvent(tree.people[personMenuId], 'death', { date: pDeathDate.value });
  refresh();
});
pDeathPlace.addEventListener('change', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  setPersonEvent(person, 'death', { place: pDeathPlace.value });
  updateGeoStatusUI('death', person.death.geocodeStatus, person.death.inferredFrom);
  renderMiniMap('death', pDeathMap, person.death, (lat, lng) => setManualLocation(person, 'death', lat, lng));
  refresh();
  geocodeAndRefresh(person, 'death');
});
// Fills exactly one missing parent slot for `childId` (used by Cards view's "+ Add
// father"/"+ Add mother" placeholder cards) and opens the new person's edit card
// without shifting which person the tree is rooted on.
function addAncestorParent(childId, slot) {
  try {
    const indices = buildIndices(tree);
    const newParent = addSingleParent(tree, childId, indices, slot, { name: slot === 'father' ? 'New father' : 'New mother' });
    refresh();
    openPersonMenu(newParent.id, { keepFocus: true });
  } catch (err) {
    alert(err.message);
  }
}

pAddParentsBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  try {
    const indices = buildIndices(tree);
    addParentsToPerson(tree, personMenuId, indices, { father: { name: 'New father' }, mother: { name: 'New mother' } });
    personDialog.close();
    destroyChart();
    refresh();
  } catch (err) {
    alert(err.message);
  }
});
pAddSpouseBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const { spouse } = addSpouse(tree, personMenuId, { name: 'New spouse' });
  personDialog.close();
  destroyChart();
  refresh();
  openPersonMenu(spouse.id);
});
pAddChildBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const indices = buildIndices(tree);
  const unionIds = indices.unionsOf.get(personMenuId) || [];
  const unionId = unionIds.length ? unionIds[unionIds.length - 1] : addUnion(tree, [personMenuId, null], []).id;
  const child = addChildToUnion(tree, unionId, { name: 'New child' });
  personDialog.close();
  destroyChart();
  refresh();
  openPersonMenu(child.id);
});
pDeleteBtn.addEventListener('click', () => {
  if (!personMenuId) return;
  const person = tree.people[personMenuId];
  if (!confirm(`Delete ${person?.name || 'this person'} and their descendants? This cannot be undone.`)) return;
  const indices = buildIndices(tree);
  removePersonCascade(tree, personMenuId, indices);
  personDialog.close();
  destroyChart();
  refresh();
});
pCloseBtn.addEventListener('click', () => {
  personDialog.close();
});

// --- Starting (root) person --------------------------------------------------

addRootBtn.addEventListener('click', () => {
  rootName.value = '';
  rootDialog.showModal();
  rootName.focus();
});
rootCancelBtn.addEventListener('click', () => rootDialog.close());
rootCreateBtn.addEventListener('click', () => {
  const name = rootName.value.trim();
  if (!name) {
    rootName.focus();
    return;
  }
  const person = addRootPerson(tree, { name });
  rootDialog.close();
  destroyChart();
  refresh();
  openPersonMenu(person.id);
});

// Shared by the empty-state bubble's sample-data link and the onboarding dialog's
// walkthrough button - both drop in the same real sample tree (see sampleData.js).
function startWalkthrough() {
  tree = buildSampleTree();
  hiddenLineageIds = new Set();
  excludedOverlapLineageIds = new Set();
  focusPersonId = null;
  timelineActive = false;
  currentYear = null;
  userMovedMap = false;
  destroyChart();
  refresh();
  runGeocodingPass();
  // The guided tour explains the screen's layout, not the map's contents - it doesn't
  // need to wait on the geocoding pass above (which resolves this data's real places
  // into map dots in the background, same as any fresh import) before starting.
  startTour();
}

startSampleBtn.addEventListener('click', startWalkthrough);

// --- Guided tour -----------------------------------------------------------
//
// A "getting started" walkthrough in the literal order of actually doing it: add data,
// see it show up as a family tree, build/correct it, then watch it move on the map -
// deliberately separate from the onboarding dialog's text explanation, since reading
// what something IS doesn't answer "so which part of my screen is that." Runs
// automatically right after the sample walkthrough loads (that's the actual point of
// calling it a "walkthrough"), and is reachable any other time via the topbar's own
// "Take a tour" button, against whatever's currently on screen - sample or real data.
const TOUR_STEPS = [
  {
    target: () => document.getElementById('addPeopleSection'),
    title: 'Start by adding your data',
    body: 'Import a GEDCOM file, or build a family tree by hand with "+ Name a starting person" below.',
  },
  {
    target: () => document.getElementById('familyTreesSection'),
    title: 'Your family trees will show up here',
    body: 'Each one gets listed here in its own color, so you can tell them apart everywhere else in the app - on the tree, and on the map.',
  },
  {
    target: () => document.getElementById('treeView'),
    title: 'Add and clarify people right on the tree',
    body: "This is also where you add new people, or fill in and clarify birth and death cities - the more specific a city, the more useful a crossing found there is. Cards and Fan are two views of the same data; switch any time with the toggle up top.",
  },
  {
    target: () => document.getElementById('mapView'),
    title: 'Watch them move',
    body: 'Every dot here is someone from one of your family trees. Press ▶ and watch everyone move through time together - that\'s how a crossing between two separate trees actually gets spotted.',
    preview: true,
  },
];
let tourStepIndex = 0;

// Only the map step (see `preview` above) shows this - a tiny illustrative loop, not
// real data, since at this point in the tour there may not BE any data yet. Built once
// and reused rather than rebuilt from an HTML string on every visit to this step.
const TOUR_MAP_PREVIEW_HTML = `
  <span class="tour-map-demo-dot a"></span>
  <span class="tour-map-demo-dot b"></span>
  <span class="tour-map-demo-star">★</span>
`;

function positionTourStep() {
  const step = TOUR_STEPS[tourStepIndex];
  const target = step?.target();
  if (!target) {
    endTour();
    return;
  }
  // Instant, not smooth - a smooth scroll's duration scales with distance (e.g. the
  // jump from the map step back up to the first step), so a fixed short delay below
  // can fire before it finishes. That left the highlight box frozen at its measured
  // position while the page kept scrolling underneath it. Instant scroll completes
  // before the next paint, so the delay below always measures the settled layout.
  target.scrollIntoView({ behavior: 'auto', block: 'center' });
  // A short timeout, not requestAnimationFrame - rAF callbacks are paused entirely by
  // the browser for a tab that isn't currently the visible/focused one, which would
  // silently leave the whole tour blank (highlight box and callout both never
  // positioned) if this ever ran while backgrounded. setTimeout keeps firing
  // regardless.
  setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const pad = 6;
    tourHighlightBox.style.top = `${rect.top - pad}px`;
    tourHighlightBox.style.left = `${rect.left - pad}px`;
    tourHighlightBox.style.width = `${rect.width + pad * 2}px`;
    tourHighlightBox.style.height = `${rect.height + pad * 2}px`;

    tourStepLabel.textContent = `${tourStepIndex + 1} of ${TOUR_STEPS.length}`;
    tourTitle.textContent = step.title;
    tourPreview.hidden = !step.preview;
    tourPreview.innerHTML = step.preview ? TOUR_MAP_PREVIEW_HTML : '';
    tourBody.textContent = step.body;
    tourNextBtn.textContent = tourStepIndex === TOUR_STEPS.length - 1 ? 'Got it' : 'Next →';

    // Prefer just below the highlighted area; flip above it if that would run off the
    // bottom of the screen. Horizontally, align with the highlight's own left edge but
    // clamp so the callout itself never runs off either side. Measured AFTER the
    // content above is set (not a fixed guess) since the preview graphic makes this
    // step's callout meaningfully taller than the text-only ones.
    const calloutWidth = tourCallout.offsetWidth || 300;
    const calloutHeight = tourCallout.offsetHeight || 170;
    let top = rect.bottom + pad + 14;
    if (top + calloutHeight > window.innerHeight) top = Math.max(14, rect.top - pad - 14 - calloutHeight);
    const left = Math.min(Math.max(14, rect.left), window.innerWidth - calloutWidth - 14);
    tourCallout.style.top = `${top}px`;
    tourCallout.style.left = `${left}px`;
  }, 60);
}

function startTour() {
  tourStepIndex = 0;
  tourOverlay.hidden = false;
  positionTourStep();
}
function endTour() {
  tourOverlay.hidden = true;
  // The tour's own steps scroll the page down and, on its last step, leave the map
  // wherever it was left mid-tour - closing (any way: Got it, Skip, or the backdrop)
  // should hand back the same top-of-page, zoomed-to-fit-everything view someone would
  // see on a fresh load, not strand them wherever the walkthrough happened to stop.
  // timelineResetBtn's own handler already IS that "just loaded" reset (stop any
  // playback, clear the year filter, re-fit the camera to everything) - reused as-is.
  window.scrollTo({ top: 0, behavior: 'smooth' });
  timelineResetBtn.click();
}
tourNextBtn.addEventListener('click', () => {
  tourStepIndex++;
  if (tourStepIndex >= TOUR_STEPS.length) {
    endTour();
    return;
  }
  positionTourStep();
});
tourSkipBtn.addEventListener('click', endTour);
takeTourBtn.addEventListener('click', startTour);
// Same "click the backdrop to dismiss" convention as this app's <dialog>s (see the
// loop over them further down) - anywhere outside the callout itself ends the tour.
tourOverlay.addEventListener('click', (e) => {
  if (e.target === tourOverlay) endTour();
});
window.addEventListener('resize', () => {
  if (!tourOverlay.hidden) positionTourStep();
});

// --- Panel lightbox --------------------------------------------------------
//
// Expands #treeView or #mapView to fill the screen. The real panel element is moved
// into the lightbox (not cloned) so the live Leaflet map / D3 fan chart / family-chart
// instance inside keeps working untouched, then moved back to its original spot on
// close. Both keep their size purely via CSS (100% of their container - see
// .view-panel.is-lightboxed and each chart's own 100%-of-container svg), so the only
// thing a container-size change needs is a nudge to re-measure: a window 'resize' event
// covers Leaflet (it already listens for one - see initMapPanel), and refresh() covers
// the tree (it re-derives everything from current state, cheap enough to call anytime,
// already the app's standard "something changed" entry point).
let lightboxPanelEl = null;
let lightboxOriginalParent = null;
let lightboxOriginalNextSibling = null;

function openLightbox(panelEl) {
  if (lightboxPanelEl) closeLightbox();
  lightboxOriginalParent = panelEl.parentElement;
  lightboxOriginalNextSibling = panelEl.nextElementSibling;
  lightboxPanelEl = panelEl;
  panelEl.classList.add('is-lightboxed');
  panelLightboxContent.appendChild(panelEl);
  panelLightbox.hidden = false;
  document.body.classList.add('lightbox-open');
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    refresh();
  });
}
function closeLightbox() {
  if (!lightboxPanelEl) return;
  const panelEl = lightboxPanelEl;
  panelEl.classList.remove('is-lightboxed');
  if (lightboxOriginalNextSibling) {
    lightboxOriginalParent.insertBefore(panelEl, lightboxOriginalNextSibling);
  } else {
    lightboxOriginalParent.appendChild(panelEl);
  }
  panelLightbox.hidden = true;
  document.body.classList.remove('lightbox-open');
  lightboxPanelEl = null;
  lightboxOriginalParent = null;
  lightboxOriginalNextSibling = null;
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    refresh();
  });
}
treeExpandBtn.addEventListener('click', () => openLightbox(treeViewEl));
mapExpandBtn.addEventListener('click', () => openLightbox(mapViewEl));
panelLightboxCloseBtn.addEventListener('click', closeLightbox);
panelLightbox.addEventListener('click', (e) => {
  if (e.target === panelLightbox) closeLightbox();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panelLightbox.hidden) closeLightbox();
});

// --- Map readiness --------------------------------------------------------
//
// A per-family-tree summary of how many people are actually IN each tree, and how many
// of THEM are ready to map - sits right above the map so it's obvious, before trusting
// a dot's position, how many people a lineage's count even refers to and whether a
// given tree is still mid-geocode or has places that only ever resolved to a vague
// state/country centroid. Event-place counts (pending/broad/failed) only count events
// that have place text at all (a genuinely blank event isn't a "readiness" problem, just
// a gap in the research itself) - see needsInference/hasBroadRegionToMatch in
// locationInference.js for the related but distinct question of which events qualify to
// borrow a relative's city. A person counts as "ready to map" once at least ONE of
// their own events has resolved to a real, city-precision point - that's all it takes
// for them to show up as a dot.
function computeLineageReadiness() {
  const stats = new Map();
  for (const lineage of Object.values(tree.lineages)) {
    stats.set(lineage.id, { pending: 0, broad: 0, failed: 0, ready: 0, total: 0, peopleTotal: 0, peopleReady: 0 });
  }
  for (const person of Object.values(tree.people)) {
    const s = stats.get(person.lineageId);
    if (!s) continue;
    s.peopleTotal += 1;
    let personReady = false;
    for (const ev of [person.birth, person.death, ...(person.events || [])]) {
      if (!ev || !ev.place) continue;
      s.total += 1;
      if (ev.geocodeStatus === 'pending') s.pending += 1;
      else if (ev.geocodeStatus === 'failed') s.failed += 1;
      else if (ev.precision === 'broad') s.broad += 1;
      else {
        s.ready += 1;
        personReady = true;
      }
    }
    if (personReady) s.peopleReady += 1;
  }
  return stats;
}

function readinessLabel(s) {
  const total = s.peopleTotal;
  const peopleWord = total === 1 ? 'person' : 'people';
  if (total === 0) return { text: 'No people in this family tree yet', cls: 'is-empty' };
  if (s.total === 0) return { text: `${total} ${peopleWord} — no places recorded yet`, cls: 'is-empty' };
  if (s.pending > 0) {
    return {
      text: `⏳ Still loading — ${s.pending} place${s.pending === 1 ? '' : 's'} left to look up (${s.peopleReady} of ${total} ${peopleWord} ready so far)`,
      cls: 'is-pending',
    };
  }
  if (s.broad > 0 || s.failed > 0) {
    const parts = [];
    if (s.broad > 0) parts.push(`${s.broad} place${s.broad === 1 ? '' : 's'} only vague (state/country-level)`);
    if (s.failed > 0) parts.push(`${s.failed} couldn't be found`);
    return { text: `⚠️ ${s.peopleReady} of ${total} ${peopleWord} ready to map — ${parts.join(', ')}`, cls: 'is-vague' };
  }
  return { text: `✅ All ${total} ${peopleWord} ready to map`, cls: 'is-ready' };
}

function renderMapReadiness() {
  const stats = computeLineageReadiness();
  const lineages = Object.values(tree.lineages);
  mapReadinessList.innerHTML = '';
  if (!lineages.length) {
    mapReadinessSummary.textContent = 'Add a family tree to see its mapping status here.';
    return;
  }
  let anyPending = false;
  let anyGaps = false;
  for (const lineage of lineages) {
    const s = stats.get(lineage.id);
    const { text, cls } = readinessLabel(s);
    if (cls === 'is-pending') anyPending = true;
    if (cls === 'is-vague') anyGaps = true;
    const row = document.createElement('div');
    row.className = 'readiness-row';
    row.innerHTML = `<span class="readiness-dot" style="background:${lineage.color}"></span><span class="readiness-name">${escapeHtml(
      lineage.name
    )} <span class="readiness-people-count">${s.peopleTotal} ${s.peopleTotal === 1 ? 'person' : 'people'}</span></span><span class="readiness-status ${cls}">${escapeHtml(
      text
    )}</span>`;
    // The "vague/couldn't be found" status text above used to be a dead end - nothing
    // on the page let you actually DO anything about it. This reuses the same
    // location-review flow the "Add city detail to N vague locations" button under
    // Possible overlaps already offers tree-wide, just scoped to this ONE lineage's own
    // people, and launched right from the row that's actually complaining about them.
    if (cls === 'is-vague') {
      const needsDetail = Object.keys(tree.people).filter(
        (id) => tree.people[id].lineageId === lineage.id && personNeedsCityDetail(id)
      );
      if (needsDetail.length) {
        const fixBtn = document.createElement('button');
        fixBtn.type = 'button';
        fixBtn.className = 'readiness-fix-btn';
        fixBtn.textContent = `Fix ${needsDetail.length} now →`;
        fixBtn.title = 'Walk through these people one at a time and add a specific city for each';
        fixBtn.addEventListener('click', () => {
          locationReviewQueue = needsDetail;
          locationReviewIndex = 0;
          advanceLocationReview();
        });
        row.appendChild(fixBtn);
      }
    }
    mapReadinessList.appendChild(row);
  }
  mapReadinessSummary.textContent = anyPending
    ? 'Some family trees are still loading places - the map may still be missing dots. Check back or use the refresh button below.'
    : anyGaps
    ? 'Everything that can resolve has - a few places only found a vague region, or none at all, and are noted below.'
    : 'All family trees are fully geocoded - the map below reflects everyone.';
}

// The one number that matters while watching a geocoding run: everyone currently
// loaded, across every family tree at once (not broken out per-lineage like the
// "Ready to map?" section below), and whether there's still anything left to look up.
// Lives right on the map itself - see .map-status-badge in layout.css - specifically so
// starting a big import or clicking "Refresh map data" gives a clear, watchable signal
// of progress and a definitive "done" state, without having to leave the map to check a
// clock buried in the sidebar. Called from refresh() for the normal case, and again on
// every tick of runGeocodingPass()'s own onProgress callback so it updates live during
// a run instead of only jumping at the very start and very end.
function updateMapStatusBadge() {
  const stats = computeLineageReadiness();
  let peopleTotal = 0;
  let peopleReady = 0;
  let pending = 0;
  let broad = 0;
  let failed = 0;
  for (const s of stats.values()) {
    peopleTotal += s.peopleTotal;
    peopleReady += s.peopleReady;
    pending += s.pending;
    broad += s.broad;
    failed += s.failed;
  }
  if (peopleTotal === 0) {
    mapStatusBadge.hidden = true;
    return;
  }
  mapStatusBadge.hidden = false;
  const peopleWord = peopleTotal === 1 ? 'person' : 'people';
  if (pending > 0) {
    mapStatusBadge.className = 'map-status-badge is-pending';
    mapStatusBadge.textContent = `⏳ Mapping ${peopleTotal} ${peopleWord} — ${peopleReady} ready so far, ${pending} place${
      pending === 1 ? '' : 's'
    } left to look up`;
    return;
  }
  mapStatusBadge.className = 'map-status-badge is-done';
  const gaps = broad + failed;
  mapStatusBadge.textContent = gaps
    ? `✅ Done mapping all ${peopleTotal} ${peopleWord} — ${gaps} place${gaps === 1 ? '' : 's'} only found a vague region or none at all`
    : `✅ Done — all ${peopleTotal} ${peopleWord} mapped`;
}

// A manual "check again" for the map - re-fits the camera to whatever's currently
// geocoded and re-kicks the geocoding pass, for whenever something feels stale (a big
// import still trickling in place-by-place, or a pass that stalled/never started for
// some reason). Switches to an amber, pulsing warning state whenever there's real
// pending work (countPendingGeocodes(tree) > 0), so it's obvious at a glance that more
// data is still on its way in, not just a plain always-there utility button.
function updateMapRefreshBtn() {
  const pending = countPendingGeocodes(tree);
  mapRefreshBtn.classList.toggle('has-pending', pending > 0);
  mapRefreshBtn.textContent = pending > 0 ? `⚠️ ${pending} place${pending === 1 ? '' : 's'} loading — refresh` : '🔄 Refresh map data';
  mapRefreshBtn.title =
    pending > 0
      ? `${pending} place${pending === 1 ? '' : 's'} still being looked up - click to check again and refresh the map with whatever's ready.`
      : 'Refresh the map with the latest data, and re-check anything still pending.';
}
mapRefreshBtn.addEventListener('click', () => {
  renderMap({ forceFitAll: true });
  // runGeocodingPass() itself calls refresh() (which updates this button, and the map
  // status badge) only once the pass actually finishes - update both right away too, so
  // clicking with nothing pending still visibly confirms something happened instead of
  // looking like a no-op.
  updateMapRefreshBtn();
  updateMapStatusBadge();
  if (countPendingGeocodes(tree)) runGeocodingPass();
});

// --- Onboarding ----------------------------------------------------------
//
// Shown automatically the very first time someone opens the app with nothing saved yet
// (see boot() below) - explains what the tool is for and offers the sample-data
// walkthrough as the fastest way to see it in action. Reachable again any time via the
// header's "? Help" button, or "Replay the intro" in the empty-state bubble once the
// tree is empty again.

helpBtn.addEventListener('click', () => onboardingDialog.showModal());
replayOnboardingBtn.addEventListener('click', () => onboardingDialog.showModal());
onboardingSkipBtn.addEventListener('click', () => onboardingDialog.close());
onboardingWalkthroughBtn.addEventListener('click', () => {
  onboardingDialog.close();
  startWalkthrough();
});
// Covers every way the dialog can close (either button, backdrop click, or Esc) with
// one listener, so "seen" is never left unmarked because of which path was used.
onboardingDialog.addEventListener('close', markOnboardingSeen);

emptyStateGedcomLink.addEventListener('click', (e) => {
  e.preventDefault();
  openGedcomImportBtn.click();
});
emptyStateHandLink.addEventListener('click', (e) => {
  e.preventDefault();
  addRootBtn.click();
});

// Downloads the current tree exactly as stored (people, unions, lineages - the same
// shape sampleData.js builds), so edits made here can be handed off and baked in as
// the new default sample data rather than redone by hand.
exportJsonBtn.addEventListener('click', () => {
  const json = JSON.stringify(tree, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (tree.title || 'genealogy-map').replace(/[^a-z0-9-_]+/gi, '-');
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

startOverBtn.addEventListener('click', () => {
  if (!confirm('Clear everything and start over? This deletes the map on this device and cannot be undone.')) return;
  tree = createEmptyTree();
  tree.id = null;
  cloudDirty = false;
  hiddenLineageIds = new Set();
  excludedOverlapLineageIds = new Set();
  focusPersonId = null;
  timelineActive = false;
  currentYear = null;
  userMovedMap = false;
  destroyChart();
  refresh();
  runGeocodingPass();
});

// --- GEDCOM import ---------------------------------------------------------
//
// GEDCOM exports from Ancestry/FamilySearch/etc. usually carry a whole shared tree -
// in-laws, cousins, unrelated branches someone else attached - not just one person's
// direct paper trail. "Only bring in direct ancestors" (on by default) walks backward
// from one chosen root through recorded parents only, matching how this app's own
// model works everywhere else: no siblings, no spouses beyond the direct-line couple,
// no descendants. Names collide often enough in real trees (two same-named people born 150
// years apart is a real example) that root selection shows birth date/place, not just
// a name, to tell them apart.

let gedcomText = '';
let gedcomParsed = null; // {indis, fams} once a file's been read
let gedcomRootId = null;

function updateGedcomImportButtonState() {
  const needsRoot = gedcomAncestorsOnly.checked;
  gedcomImportBtn.disabled = !gedcomParsed || (needsRoot && !gedcomRootId);
}

function gedcomPersonLabel(data) {
  return [data.birth?.date, data.birth?.place].filter(Boolean).join(' · ');
}

function renderGedcomRootResults() {
  const query = gedcomRootSearch.value.trim().toLowerCase();
  gedcomRootResults.innerHTML = '';
  if (!query || !gedcomParsed) return;

  const matches = [...gedcomParsed.indis.entries()]
    .filter(([, data]) => (data.name || '').toLowerCase().includes(query))
    .slice(0, 30);

  if (!matches.length) {
    gedcomRootResults.innerHTML = '<p class="empty-state">No one matches.</p>';
    return;
  }

  for (const [gid, data] of matches) {
    const meta = gedcomPersonLabel(data);
    const row = document.createElement('div');
    row.className = 'people-search-row';
    if (gid === gedcomRootId) row.classList.add('is-selected');
    row.innerHTML = `<span class="people-search-name">${escapeHtml(data.name || '(unnamed)')}</span><span class="people-search-meta">${escapeHtml(meta)}</span>`;
    row.addEventListener('click', () => {
      gedcomRootId = gid;
      gedcomRootSelected.hidden = false;
      gedcomRootSelected.textContent = `Root: ${data.name || '(unnamed)'}${meta ? ' — ' + meta : ''}`;
      renderGedcomRootResults();
      updateGedcomImportButtonState();
    });
    gedcomRootResults.appendChild(row);
  }
}
gedcomRootSearch.addEventListener('input', renderGedcomRootResults);

gedcomAncestorsOnly.addEventListener('change', () => {
  gedcomRootPickerRow.style.display = gedcomAncestorsOnly.checked ? '' : 'none';
  updateGedcomImportButtonState();
});

gedcomFileInput.addEventListener('change', async () => {
  gedcomImportMessage.hidden = true;
  gedcomParsed = null;
  gedcomRootId = null;
  gedcomRootSearch.value = '';
  gedcomRootResults.innerHTML = '';
  gedcomRootSelected.hidden = true;
  gedcomScopeSection.hidden = true;
  updateGedcomImportButtonState();

  const file = gedcomFileInput.files[0];
  if (!file) return;
  try {
    gedcomText = await file.text();
    gedcomParsed = parseGedcom(gedcomText);
    gedcomScopeSection.hidden = false;
    updateGedcomImportButtonState();
  } catch (err) {
    showMsg(gedcomImportMessage, `Couldn't read that file: ${err.message}`);
  }
});

openGedcomImportBtn.addEventListener('click', () => {
  populateLineageSelect(gedcomLineageSelect);
  gedcomFileInput.value = '';
  gedcomText = '';
  gedcomParsed = null;
  gedcomRootId = null;
  gedcomScopeSection.hidden = true;
  gedcomAncestorsOnly.checked = true;
  gedcomRootPickerRow.style.display = '';
  gedcomRootSearch.value = '';
  gedcomRootResults.innerHTML = '';
  gedcomRootSelected.hidden = true;
  gedcomImportMessage.hidden = true;
  gedcomImportBtn.disabled = true;
  gedcomImportDialog.showModal();
});
gedcomImportCancelBtn.addEventListener('click', () => gedcomImportDialog.close());
gedcomImportBtn.addEventListener('click', async () => {
  if (!gedcomParsed) {
    showMsg(gedcomImportMessage, 'Choose a .ged file first.');
    return;
  }
  const ancestorsOnly = gedcomAncestorsOnly.checked;
  if (ancestorsOnly && !gedcomRootId) {
    showMsg(gedcomImportMessage, 'Search for and select a root person first.');
    return;
  }
  const lineageId = resolveLineageSelection(gedcomLineageSelect);
  if (!lineageId) return;
  gedcomImportBtn.disabled = true;
  try {
    const beforeIds = new Set(Object.keys(tree.people));
    const rawTotal = gedcomParsed.indis.size;
    const result = ancestorsOnly
      ? importGedcomAncestorsIntoTree(tree, gedcomText, { rootGedcomId: gedcomRootId, lineageId, addPerson, addUnion, setPersonEvent, addLifeEvent })
      : importGedcomIntoTree(tree, gedcomText, { lineageId, addPerson, addUnion, setPersonEvent, addLifeEvent });
    gedcomImportDialog.close();
    destroyChart();
    refresh();
    if (!result.peopleImported) {
      showMsg(gedcomImportMessage, "Didn't find any individuals in that file.");
    } else {
      const lineageName = escapeHtml(tree.lineages[lineageId]?.name || 'this family tree');
      if (ancestorsOnly && result.peopleImported < rawTotal) {
        showImportSummary(
          `📥 Your GEDCOM had <strong>${rawTotal}</strong> people. Imported <strong>${result.peopleImported}</strong> into "${lineageName}" - the direct ancestor line of the root you picked. The other <strong>${
            rawTotal - result.peopleImported
          }</strong> (siblings, cousins, DNA matches, etc.) were left out on purpose - re-import with "entire file" instead of "ancestors only" to bring in everyone.`
        );
      } else {
        showImportSummary(`📥 Imported all <strong>${result.peopleImported}</strong> people from your GEDCOM into "${lineageName}".`);
      }
      maybeShowGeocodeNotice(countPendingGeocodes(tree));
      await runGeocodingPass();
      maybePromptForLocationDetail(Object.keys(tree.people).filter((id) => !beforeIds.has(id)));
    }
  } catch (err) {
    showMsg(gedcomImportMessage, `Couldn't import that file: ${err.message}`);
  } finally {
    gedcomImportBtn.disabled = false;
  }
});

// --- CSV import --------------------------------------------------------------

let csvParsedRows = null;
let csvHeaderMap = {};

openCsvImportBtn.addEventListener('click', () => {
  populateLineageSelect(csvLineageSelect);
  csvFileInput.value = '';
  csvMappingArea.innerHTML = '';
  csvImportBtn.disabled = true;
  csvImportMessage.hidden = true;
  csvParsedRows = null;
  csvImportDialog.showModal();
});
csvImportCancelBtn.addEventListener('click', () => csvImportDialog.close());

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

// Common real-world header spellings that don't literally match a field's own label
// (e.g. a plain "ID" column, or "DOB") - checked in addition to the exact-label match.
const CSV_HEADER_ALIASES = {
  localId: ['id', 'personid', 'rowid', 'recordid'],
  birthDate: ['dob', 'born', 'birthyear', 'yearofbirth'],
  birthPlace: ['pob', 'placeofbirth', 'birthlocation'],
  deathDate: ['dod', 'died', 'deathyear', 'yearofdeath'],
  deathPlace: ['pod', 'placeofdeath', 'deathlocation'],
  fatherId: ['father', 'dad', 'fatherid'],
  motherId: ['mother', 'mom', 'motherid'],
};

function renderCsvMapping() {
  const headers = csvParsedRows[0];
  csvMappingArea.innerHTML = '';
  csvHeaderMap = {};
  for (const field of ROW_FIELDS) {
    const row = document.createElement('div');
    row.className = 'csv-mapping-row';
    const label = document.createElement('label');
    label.textContent = field.label;
    row.appendChild(label);

    const select = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '-1';
    noneOpt.textContent = '— none —';
    select.appendChild(noneOpt);
    headers.forEach((h, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = h || `Column ${idx + 1}`;
      select.appendChild(opt);
    });

    const aliases = CSV_HEADER_ALIASES[field.key] || [];
    const guessIdx = headers.findIndex((h) => {
      const n = normalizeHeader(h);
      return n === normalizeHeader(field.label) || n === field.key.toLowerCase() || aliases.includes(n);
    });
    select.value = guessIdx >= 0 ? String(guessIdx) : '-1';
    csvHeaderMap[field.key] = guessIdx;
    select.addEventListener('change', () => {
      csvHeaderMap[field.key] = parseInt(select.value, 10);
    });
    row.appendChild(select);
    csvMappingArea.appendChild(row);
  }
}

csvFileInput.addEventListener('change', async () => {
  const file = csvFileInput.files[0];
  if (!file) return;
  const text = await file.text();
  csvParsedRows = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!csvParsedRows.length) {
    showMsg(csvImportMessage, 'That file looks empty.');
    return;
  }
  csvImportMessage.hidden = true;
  renderCsvMapping();
  csvImportBtn.disabled = false;
});

csvImportBtn.addEventListener('click', async () => {
  if (!csvParsedRows) return;
  const lineageId = resolveLineageSelection(csvLineageSelect);
  if (!lineageId) return;
  const beforeIds = new Set(Object.keys(tree.people));
  const dataRows = csvParsedRows.slice(1);
  const rows = dataRows.map((r) => {
    const get = (key) => {
      const idx = csvHeaderMap[key];
      return idx != null && idx >= 0 ? r[idx] || '' : '';
    };
    return {
      localId: get('localId'),
      name: get('name'),
      sex: get('sex'),
      birthDate: get('birthDate'),
      birthPlace: get('birthPlace'),
      deathDate: get('deathDate'),
      deathPlace: get('deathPlace'),
      fatherId: get('fatherId'),
      motherId: get('motherId'),
      notes: get('notes'),
    };
  });
  const { peopleImported } = importRowsIntoTree(tree, rows, { lineageId, addPerson, addUnion, setPersonEvent });
  csvImportDialog.close();
  destroyChart();
  refresh();
  if (!peopleImported) {
    showMsg(csvImportMessage, "Didn't find any rows with data.");
  } else {
    const lineageName = escapeHtml(tree.lineages[lineageId]?.name || 'this family tree');
    if (peopleImported < rows.length) {
      showImportSummary(
        `📥 Your file had <strong>${rows.length}</strong> rows. Imported <strong>${peopleImported}</strong> people into "${lineageName}" - the other <strong>${
          rows.length - peopleImported
        }</strong> had no name or place filled in, so they were skipped.`
      );
    } else {
      showImportSummary(`📥 Imported all <strong>${peopleImported}</strong> people from your spreadsheet into "${lineageName}".`);
    }
    maybeShowGeocodeNotice(countPendingGeocodes(tree));
    await runGeocodingPass();
    maybePromptForLocationDetail(Object.keys(tree.people).filter((id) => !beforeIds.has(id)));
  }
});

// --- Bulk paste grid -----------------------------------------------------------

const GRID_COLUMNS = ['localId', 'name', 'sex', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'fatherId', 'motherId', 'notes'];

function addGridRow(values = {}) {
  const tr = document.createElement('tr');
  GRID_COLUMNS.forEach((col, colIdx) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = values[col] || '';
    input.addEventListener('paste', (e) => handleGridPaste(e, tr, colIdx));
    td.appendChild(input);
    tr.appendChild(td);
  });
  bulkGridBody.appendChild(tr);
}

function handleGridPaste(e, startRow, startColIdx) {
  const text = e.clipboardData?.getData('text/plain');
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
  e.preventDefault();
  const lines = text.replace(/\r/g, '').split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  let rowEl = startRow;
  lines.forEach((line, i) => {
    if (i > 0) {
      if (!rowEl.nextElementSibling) addGridRow();
      rowEl = rowEl.nextElementSibling;
    }
    const cells = line.split('\t');
    cells.forEach((val, j) => {
      const colIdx = startColIdx + j;
      if (colIdx >= GRID_COLUMNS.length) return;
      const input = rowEl.children[colIdx]?.querySelector('input');
      if (input) input.value = val;
    });
  });
}

openGridImportBtn.addEventListener('click', () => {
  populateLineageSelect(gridLineageSelect);
  bulkGridBody.innerHTML = '';
  for (let i = 0; i < 8; i++) addGridRow();
  gridImportMessage.hidden = true;
  gridImportDialog.showModal();
});
gridImportCancelBtn.addEventListener('click', () => gridImportDialog.close());
gridAddRowBtn.addEventListener('click', () => addGridRow());

gridImportBtn.addEventListener('click', async () => {
  const lineageId = resolveLineageSelection(gridLineageSelect);
  if (!lineageId) return;
  const beforeIds = new Set(Object.keys(tree.people));
  const rows = [...bulkGridBody.children].map((tr) => {
    const obj = {};
    GRID_COLUMNS.forEach((col, idx) => {
      obj[col] = tr.children[idx].querySelector('input').value;
    });
    return obj;
  });
  const { peopleImported } = importRowsIntoTree(tree, rows, { lineageId, addPerson, addUnion, setPersonEvent });
  gridImportDialog.close();
  destroyChart();
  refresh();
  if (!peopleImported) {
    showMsg(gridImportMessage, 'No rows had a name or place filled in.');
  } else {
    const lineageName = escapeHtml(tree.lineages[lineageId]?.name || 'this family tree');
    showImportSummary(`📥 Added <strong>${peopleImported}</strong> people to "${lineageName}" from your pasted rows.`);
    maybeShowGeocodeNotice(countPendingGeocodes(tree));
    await runGeocodingPass();
    maybePromptForLocationDetail(Object.keys(tree.people).filter((id) => !beforeIds.has(id)));
  }
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
    showMsg(signInMessage, `Couldn't start Google sign-in: ${err.message}`);
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
    showMsg(signInMessage, `Check ${email} for a sign-in link.`);
  } catch (err) {
    showMsg(signInMessage, `Couldn't send that: ${err.message}`);
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
    tree.id = null;
    cloudDirty = false;
  }
  updateSaveStatus();
  if (signInDialog.open) signInDialog.close();
}

// --- Save to cloud -------------------------------------------------------

async function performCloudSave(name) {
  saveMapSubmitBtn.disabled = true;
  saveMapBtn.disabled = true;
  try {
    if (!tree.id) {
      tree.id = await cloud.createMap(currentSession.user.id, name, tree);
      tree.title = name;
    } else {
      if (name) tree.title = name;
      await cloud.updateMap(tree.id, tree.title, tree);
    }
    cloudDirty = false;
    updateSaveStatus();
    if (saveMapDialog.open) saveMapDialog.close();
  } catch (err) {
    showMsg(saveMapMessage, `Couldn't save: ${err.message}`);
    saveStatusEl.textContent = `Save failed: ${err.message}`;
  } finally {
    saveMapSubmitBtn.disabled = false;
    saveMapBtn.disabled = false;
  }
}

// The header's "Save" button only, now - the Family trees panel's "Save this grouping"
// used to point here too (saving the whole cloud map, confusingly, under a button that
// looked like it was about the sidebar's own lineage selection), but now does what its
// name always implied: see openComparisonDialog below. Signing in is required since a
// cloud save is tied to an account (currentSession.user.id below) - nudge into the
// sign-in dialog instead of failing silently or throwing.
function openSaveFlow() {
  if (!cloudConfigured) {
    alert("Cloud save isn't set up for this app yet, so there's nowhere to save a named map to. Your work is still saved locally on this device.");
    return;
  }
  if (!currentSession) {
    signInBtn.click();
    return;
  }
  if (tree.id) {
    performCloudSave();
    return;
  }
  saveMapName.value = tree.title === 'Untitled map' ? '' : tree.title;
  saveMapMessage.hidden = true;
  saveMapDialog.showModal();
}

saveMapBtn.addEventListener('click', openSaveFlow);
saveMapCancelBtn.addEventListener('click', () => saveMapDialog.close());
saveMapForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = saveMapName.value.trim() || 'Untitled map';
  performCloudSave(name);
});

// --- My maps --------------------------------------------------------------

function renderMyMapsList(maps) {
  myMapsList.innerHTML = '';
  if (!maps.length) {
    myMapsList.innerHTML = '<p class="empty-state">You haven\'t saved any maps to the cloud yet.</p>';
    return;
  }
  for (const m of maps) {
    const row = document.createElement('div');
    row.className = 'tree-list-item';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tree-list-main';
    main.innerHTML = `<span class="tree-list-name">${escapeHtml(m.name)}</span><span class="tree-list-updated">${relativeTime(m.updatedAt)}</span>`;
    main.addEventListener('click', () => openCloudMap(m.id));
    row.appendChild(main);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'node-btn-icon node-btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this map';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${m.name}"? This cannot be undone.`)) return;
      await cloud.deleteMap(m.id);
      if (tree.id === m.id) {
        tree.id = null;
        cloudDirty = false;
        updateSaveStatus();
      }
      openMyMapsDialog();
    });
    row.appendChild(delBtn);

    myMapsList.appendChild(row);
  }
}

async function openMyMapsDialog() {
  myMapsDialog.showModal();
  myMapsList.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    renderMyMapsList(await cloud.listMyMaps());
  } catch (err) {
    myMapsList.innerHTML = `<p class="empty-state">Couldn't load your maps: ${escapeHtml(err.message)}</p>`;
  }
}

async function openCloudMap(id) {
  try {
    const data = await cloud.loadMap(id);
    tree = data;
    tree.id = id;
    // A cloud map saved before comparisons existed simply won't have this field yet.
    tree.comparisons = tree.comparisons || [];
    purgeExpiredTrash(tree);
    cloudDirty = false;
    hiddenLineageIds = new Set();
    excludedOverlapLineageIds = new Set();
    focusPersonId = null;
    timelineActive = false;
    currentYear = null;
    userMovedMap = false;
    destroyChart();
    refresh();
    myMapsDialog.close();
  } catch (err) {
    alert(`Couldn't open that map: ${err.message}`);
  }
}

myMapsBtn.addEventListener('click', openMyMapsDialog);
myMapsCloseBtn.addEventListener('click', () => myMapsDialog.close());
newMapBtn.addEventListener('click', () => {
  tree = createEmptyTree();
  cloudDirty = false;
  hiddenLineageIds = new Set();
  excludedOverlapLineageIds = new Set();
  focusPersonId = null;
  timelineActive = false;
  currentYear = null;
  userMovedMap = false;
  destroyChart();
  refresh();
  myMapsDialog.close();
});

// --- Comparisons -----------------------------------------------------------
//
// A comparison is a named, saved SELECTION of which of the current tree's own family
// trees to look at together - not a copy of them, not a separate project (see
// addComparison in model/graph.js). It reuses the exact same visibility/overlap-
// inclusion switches each lineage row already has (hiddenLineageIds,
// excludedOverlapLineageIds); saving a comparison just remembers a name for whatever
// combination is currently switched on, and applying one flips those same switches back
// to match - the underlying family trees and people are never touched.

function renderComparisonChecklist(preselectedIds) {
  comparisonLineageChecklist.innerHTML = '';
  const lineages = Object.values(tree.lineages);
  if (!lineages.length) {
    comparisonLineageChecklist.innerHTML = '<p class="empty-state">Add a family tree first.</p>';
    return;
  }
  for (const lineage of lineages) {
    const row = document.createElement('label');
    row.className = 'comparison-checklist-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = lineage.id;
    cb.checked = preselectedIds.has(lineage.id);
    row.appendChild(cb);

    const swatch = document.createElement('span');
    swatch.className = 'comparison-checklist-swatch';
    swatch.style.background = lineage.color;
    row.appendChild(swatch);

    const label = document.createElement('span');
    label.textContent = lineage.name;
    row.appendChild(label);

    comparisonLineageChecklist.appendChild(row);
  }
}

function selectedComparisonLineageIds() {
  return new Set(
    Array.from(comparisonLineageChecklist.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value)
  );
}

// preselectAll: the topbar's big "+ Create a New Comparison" starts from "everything
// I've currently got loaded," letting someone uncheck what they don't want - the
// sidebar's "Save this grouping" instead starts from whatever's ALREADY
// visible/included via each lineage row's own switches, since at that point someone's
// typically already arranged the view they want and is just naming it to keep.
// "Turned on" everywhere in the app means the same thing: both switches on a lineage's
// own row are active (visible on the map AND included in the overlap search) - shared
// here rather than each feature computing its own version of "which lines count right
// now" so a line excluded from one overlap-style search is consistently excluded from
// every other one too.
function activeLineageIds() {
  return new Set(Object.keys(tree.lineages).filter((id) => !hiddenLineageIds.has(id) && !excludedOverlapLineageIds.has(id)));
}

function openComparisonDialog({ preselectAll = false } = {}) {
  const preselected = preselectAll ? new Set(Object.keys(tree.lineages)) : activeLineageIds();
  renderComparisonChecklist(preselected);
  comparisonNameInput.value = '';
  comparisonDialogMessage.hidden = true;
  comparisonDialog.showModal();
}

// Lineages IN the set become fully active (visible + included in the overlap search);
// every other currently-loaded lineage becomes fully inactive in both - applying a
// comparison is just setting these two switches back to wherever they were when it was
// saved, never touching a person or a family tree itself. A lineageId the comparison
// remembers that no longer exists (its family tree was since deleted) is silently
// skipped - nothing to apply it to.
function applyComparisonSelection(lineageIds) {
  const idSet = new Set(lineageIds);
  hiddenLineageIds = new Set();
  excludedOverlapLineageIds = new Set();
  for (const id of Object.keys(tree.lineages)) {
    if (!idSet.has(id)) {
      hiddenLineageIds.add(id);
      excludedOverlapLineageIds.add(id);
    }
  }
  refresh();
}

createComparisonBtn.addEventListener('click', () => openComparisonDialog({ preselectAll: true }));
saveGroupingBtn.addEventListener('click', () => openComparisonDialog({ preselectAll: false }));
comparisonCancelBtn.addEventListener('click', () => comparisonDialog.close());
comparisonSaveBtn.addEventListener('click', () => {
  const ids = selectedComparisonLineageIds();
  if (!ids.size) {
    showMsg(comparisonDialogMessage, 'Pick at least one family tree to compare.');
    return;
  }
  const name = comparisonNameInput.value.trim() || 'Untitled comparison';
  addComparison(tree, { name, lineageIds: [...ids] });
  applyComparisonSelection(ids);
  persist();
  comparisonDialog.close();
});

function renderMyComparisonsList() {
  const comparisons = tree.comparisons || [];
  myComparisonsList.innerHTML = '';
  if (!comparisons.length) {
    myComparisonsList.innerHTML =
      '<p class="empty-state">You haven\'t saved any comparisons yet - pick which family trees to compare, then save it here to switch back to it anytime.</p>';
    return;
  }
  for (const c of comparisons) {
    const row = document.createElement('div');
    row.className = 'tree-list-item';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tree-list-main';
    const names = c.lineageIds.map((id) => tree.lineages[id]?.name).filter(Boolean);
    main.innerHTML = `<span class="tree-list-name">${escapeHtml(c.name)}</span><span class="tree-list-updated comparison-list-lineages">${escapeHtml(names.join(', ') || 'no family trees left')}</span>`;
    main.title = `Switch to comparing: ${names.join(', ') || '(none of these family trees exist anymore)'}`;
    main.addEventListener('click', () => {
      applyComparisonSelection(c.lineageIds);
      myComparisonsDialog.close();
    });
    row.appendChild(main);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'node-btn-icon node-btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this comparison';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
      removeComparison(tree, c.id);
      persist();
      renderMyComparisonsList();
    });
    row.appendChild(delBtn);

    myComparisonsList.appendChild(row);
  }
}

function openMyComparisonsDialog() {
  renderMyComparisonsList();
  myComparisonsDialog.showModal();
}

myComparisonsBtn.addEventListener('click', openMyComparisonsDialog);
myComparisonsCloseBtn.addEventListener('click', () => myComparisonsDialog.close());
newComparisonFromDialogBtn.addEventListener('click', () => {
  myComparisonsDialog.close();
  openComparisonDialog({ preselectAll: true });
});

// --- Overlapping ancestors ---------------------------------------------------
//
// A different question from the map's own "Possible overlaps" section: not "were
// these two DIFFERENT people ever in the same place at the same time" (map/overlap.js),
// but "are these actually the SAME person, recorded two different ways by two
// different lines' own research" - see model/ancestorMatch.js for the actual fuzzy
// name/date matching this runs.

function ancestorMatchPersonHtml(person) {
  const lineage = tree.lineages[person.lineageId];
  const years = [person.birth.year, person.death.year].filter((y) => y != null).join('–');
  return `<span class="ancestor-match-dot" style="background:${lineage?.color || '#7d8f95'}"></span>
    <span class="ancestor-match-name-years"><span class="ancestor-match-name">${escapeHtml(person.name || '(unnamed)')}</span>${
    years ? ` <span class="ancestor-match-years">${escapeHtml(years)}</span>` : ''
  }</span>`;
}

// Spells out WHY two records were flagged, since a bare percentage means nothing to
// someone deciding whether to go verify it by hand - "birth years agree" or "birth
// year unknown on one side" is the actual, checkable claim.
function matchReasonText(match) {
  const parts = [`${Math.round(match.nameScore * 100)}% name match`];
  if (match.birthAgree === true) parts.push('birth years agree');
  else if (match.birthAgree === null) parts.push('birth year unknown on one side');
  if (match.deathAgree === true) parts.push('death years agree');
  return parts.join(' · ');
}

function renderAncestorMatchList(matches) {
  ancestorMatchList.innerHTML = '';
  if (!matches.length) {
    ancestorMatchList.innerHTML = '<p class="empty-state">No likely matches found among the family trees currently turned on.</p>';
    return;
  }
  for (const match of matches) {
    const personA = tree.people[match.personAId];
    const personB = tree.people[match.personBId];
    if (!personA || !personB) continue;

    const row = document.createElement('div');
    row.className = 'ancestor-match-row';

    const pair = document.createElement('div');
    pair.className = 'ancestor-match-pair';

    for (const person of [personA, personB]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ancestor-match-person';
      btn.innerHTML = ancestorMatchPersonHtml(person);
      // Closes this dialog first - openPersonMenu opens the (also modal) person editor,
      // and only one modal <dialog> can sensibly hold the "top layer" at a time.
      btn.addEventListener('click', () => {
        ancestorMatchDialog.close();
        openPersonMenu(person.id);
      });
      pair.appendChild(btn);
      if (person === personA) {
        const vs = document.createElement('span');
        vs.className = 'ancestor-match-vs';
        vs.textContent = '≈';
        pair.appendChild(vs);
      }
    }
    row.appendChild(pair);

    const reason = document.createElement('p');
    reason.className = 'ancestor-match-reason';
    reason.textContent = matchReasonText(match);
    row.appendChild(reason);

    ancestorMatchList.appendChild(row);
  }
}

findAncestorMatchesBtn.addEventListener('click', () => {
  // Runs immediately across every LOADED family tree, regardless of the map's own
  // visible/included toggles on each lineage row - those two switches control what the
  // MAP shows, which has nothing to do with what's worth comparing for a shared
  // ancestor. The only real precondition is having something to compare AT ALL - one
  // family tree by itself has no second line to cross-check against.
  const allIds = new Set(Object.keys(tree.lineages));
  if (allIds.size < 2) {
    ancestorMatchIntro.textContent = 'Add at least one more family tree to search for an ancestor it might share with this one.';
    ancestorMatchList.innerHTML = '';
    ancestorMatchDialog.showModal();
    return;
  }
  const matches = findOverlappingAncestors(tree, allIds);
  const lineageNames = [...allIds].map((id) => tree.lineages[id]?.name).filter(Boolean).join(', ');
  ancestorMatchIntro.textContent = `Comparing all of your family trees: ${lineageNames}. Names don't need to match exactly, and dates are allowed to land a few years apart - two lines' independent research on the same person rarely agrees on either.`;
  renderAncestorMatchList(matches);
  ancestorMatchDialog.showModal();
});
ancestorMatchCloseBtn.addEventListener('click', () => ancestorMatchDialog.close());

// --- Dialogs: click the backdrop to dismiss without applying anything ------

for (const dialog of [
  personDialog,
  rootDialog,
  gedcomImportDialog,
  csvImportDialog,
  gridImportDialog,
  signInDialog,
  saveMapDialog,
  myMapsDialog,
  comparisonDialog,
  myComparisonsDialog,
  ancestorMatchDialog,
  onboardingDialog,
  geocodeNoticeDialog,
  locationPrecisionDialog,
]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// --- Boot --------------------------------------------------------------

async function boot() {
  const cloudReady = await cloud.isCloudConfigured();
  cloudConfigured = cloudReady;
  const session = cloudReady ? await cloud.getSession() : null;

  const draft = loadDraft();
  if (draft) tree = draft;
  // A draft saved before comparisons existed simply won't have this field yet.
  tree.comparisons = tree.comparisons || [];
  purgeExpiredTrash(tree);

  updateAccountUI(session);
  initMapPanel();
  refresh();
  if (countPendingGeocodes(tree)) runGeocodingPass();

  // Only for a genuinely fresh visitor: nothing saved locally yet (no draft above) and
  // the intro's never been dismissed before - not shown again just because someone
  // cleared their tree back down to empty with Start Over.
  if (!draft && !hasSeenOnboarding()) onboardingDialog.showModal();

  if (cloudReady) cloud.onAuthChange(handleAuthChange);
}

boot();
