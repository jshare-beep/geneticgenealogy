// Pedigree graph data model for Genealogy Mapper.
//
// Same normalized-graph shape as Multifacet's model (Persons don't point at parents
// directly - Unions own that via childIds), which is what makes multi-branch ancestry
// representable without a single root. This app drops the DNA-match/possibility/scoring
// concepts entirely and adds what a map+timeline needs instead: a birth and death
// *event* per person (date/place/lat/lng), a "lineage" (the colored group a person's
// dot belongs to), and a same-person link (the confirmed point where two lineages meet).

import { newId } from '../util/id.js';
import { nextLineageColor } from '../util/color.js';
import { parseFuzzyDate } from '../util/dates.js';

export const SCHEMA_VERSION = 1;

export function createEmptyTree(title = 'Untitled map') {
  return {
    id: null,
    schemaVersion: SCHEMA_VERSION,
    title,
    people: {},
    unions: {},
    lineages: {},
    trash: [],
    // Each is { id, name, lineageIds, createdAt } - a saved, named SELECTION of which
    // of this tree's own family trees to look at together, not a copy of them (deleting
    // a lineage a comparison points at just leaves that comparison pointing at one
    // fewer - see applyComparisonSelection in main.js, which silently skips missing
    // ids). Lets someone flip between "just these two lines" and "everything I've got"
    // without re-toggling each one's visibility/overlap switches by hand every time.
    comparisons: [],
  };
}

// A comparison is one more thing to remember alongside a name, not a fifth "family
// tree" concept of its own - it's exactly the set of lineageIds someone had active
// (visible + included in the overlap search) at the moment they saved it.
export function addComparison(tree, { name, lineageIds }) {
  if (!tree.comparisons) tree.comparisons = [];
  const comparison = { id: newId('cmp'), name, lineageIds: [...lineageIds], createdAt: new Date().toISOString() };
  tree.comparisons.push(comparison);
  return comparison;
}

export function removeComparison(tree, comparisonId) {
  if (!tree.comparisons) return;
  tree.comparisons = tree.comparisons.filter((c) => c.id !== comparisonId);
}

// --- Indices (derived, never persisted) -------------------------------------

export function buildIndices(tree) {
  const parentUnionOf = new Map(); // personId -> unionId (this person's own parents)
  const unionsOf = new Map(); // personId -> unionId[]
  const childrenOf = new Map(); // personId -> personId[]
  const spouseOf = new Map(); // personId -> personId[]

  for (const union of Object.values(tree.unions)) {
    for (const childId of union.childIds) parentUnionOf.set(childId, union.id);
    const partners = union.partnerIds.filter(Boolean);
    for (const pid of partners) {
      if (!unionsOf.has(pid)) unionsOf.set(pid, []);
      unionsOf.get(pid).push(union.id);
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(...union.childIds);
      const others = partners.filter((id) => id !== pid);
      if (!spouseOf.has(pid)) spouseOf.set(pid, []);
      spouseOf.get(pid).push(...others);
    }
  }

  return { parentUnionOf, unionsOf, childrenOf, spouseOf };
}

// --- People -------------------------------------------------------------

function emptyEvent() {
  // geocodeStatus: 'none' | 'pending' | 'ok' | 'failed' | 'manual' | 'inferred'
  // ('inferred': this event's own place only ever geocoded broad, and its lat/lng were
  // borrowed from a close relative's city-level place instead - see
  // applyLocationInference in model/locationInference.js. Carries an extra
  // `inferredFrom: { personId, name, via, place }` field, not listed in this shape
  // since every other status leaves it absent.)
  // precision: 'city' | 'broad' | null (null = not geocoded yet, or an older cached
  // result from before precision was tracked) - see classifyPrecision in geocode.js.
  return { date: '', year: null, approx: false, place: '', lat: null, lng: null, geocodeStatus: 'none', precision: null };
}

export function addPerson(tree, { name = '', sex = 'U', lineageId = null, isRoot = false, notes = '', birth, death, events } = {}) {
  const id = newId('p');
  tree.people[id] = {
    id,
    name,
    sex: sex === 'M' || sex === 'F' ? sex : 'U',
    lineageId,
    isRoot: !!isRoot,
    notes,
    birth: birth || emptyEvent(),
    death: death || emptyEvent(),
    // Other places lived, between birth and death - a person who moved is more than two
    // dots. Each entry has the same date/place/lat/lng/geocodeStatus shape as birth and
    // death, plus its own id so a specific one can be edited or removed.
    events: events || [],
  };
  return tree.people[id];
}

// Re-derives an event's parsed year/approx from raw date text, and resets geocoding
// whenever the place text actually changes (a stale lat/lng for the OLD place would
// otherwise silently survive under the new place name). Shared by birth/death and by
// the free-form life-events list below.
function applyEventFields(ev, { date, place } = {}) {
  if (date !== undefined) {
    const parsed = parseFuzzyDate(date);
    ev.date = parsed.raw;
    ev.year = parsed.year;
    ev.approx = parsed.approx;
  }
  if (place !== undefined) {
    const next = (place || '').trim();
    if (next !== ev.place) {
      ev.place = next;
      ev.lat = null;
      ev.lng = null;
      ev.geocodeStatus = next ? 'pending' : 'none';
      ev.precision = null;
      ev.inferredFrom = null;
    }
  }
}

// Updates a person's birth/death event from raw form input.
export function setPersonEvent(person, which, fields = {}) {
  applyEventFields(person[which], fields);
}

// --- Life events (places lived other than birth/death) ----------------------

export function addLifeEvent(person, fields = {}) {
  const event = { id: newId('ev'), ...emptyEvent() };
  applyEventFields(event, fields);
  if (!person.events) person.events = [];
  person.events.push(event);
  return event;
}

export function updateLifeEvent(person, eventId, fields = {}) {
  const event = (person.events || []).find((e) => e.id === eventId);
  if (event) applyEventFields(event, fields);
  return event || null;
}

export function removeLifeEvent(person, eventId) {
  person.events = (person.events || []).filter((e) => e.id !== eventId);
}

export function setPersonManualCoords(person, which, lat, lng) {
  const ev = person[which];
  ev.lat = lat;
  ev.lng = lng;
  ev.geocodeStatus = 'manual';
  // A hand-placed pin is exact by definition - counts as city-level precision for
  // overlap detection, same as a real city match.
  ev.precision = 'city';
  ev.inferredFrom = null;
}

// --- Unions / relationships --------------------------------------------------

export function addUnion(tree, partnerIds = [null, null], childIds = []) {
  const id = newId('u');
  tree.unions[id] = {
    id,
    partnerIds: [partnerIds[0] ?? null, partnerIds[1] ?? null],
    childIds: [...childIds],
  };
  return tree.unions[id];
}

export function addChildToUnion(tree, unionId, childPersonOrInfo) {
  const union = tree.unions[unionId];
  if (!union) throw new Error(`Union not found: ${unionId}`);
  const child = childPersonOrInfo.id ? childPersonOrInfo : addPerson(tree, childPersonOrInfo);
  if (!union.childIds.includes(child.id)) union.childIds.push(child.id);
  return child;
}

// "Pivot to the other side": ensure an existing person has a recorded parent union,
// creating one if needed, and fills in whichever slot(s) are still empty - so someone
// with only one parent recorded (e.g. a mother, father slot left blank because the
// father's name wasn't known) can still have the other parent added, instead of
// "already has parents" blocking any further edits just because a union exists at all.
// New parents inherit the child's lineage by default (extending the same colored line
// further back), and are sexed by the slot they fill unless told otherwise - father
// slot (partnerIds[0]) is male, mother slot (partnerIds[1]) is female.
export function addParentsToPerson(tree, personId, indices, { father = {}, mother = {} } = {}) {
  const person = tree.people[personId];
  if (!person) throw new Error(`Person not found: ${personId}`);

  const existingUnionId = indices.parentUnionOf.get(personId);
  let union = existingUnionId ? tree.unions[existingUnionId] : null;

  if (union && union.partnerIds[0] && union.partnerIds[1]) {
    throw new Error('This person already has both parents recorded.');
  }
  if (!union) {
    union = addUnion(tree, [null, null], [personId]);
  }

  const result = { union };
  if (!union.partnerIds[0]) {
    result.father = addPerson(tree, { sex: 'M', lineageId: person.lineageId, ...father });
    union.partnerIds[0] = result.father.id;
  }
  if (!union.partnerIds[1]) {
    result.mother = addPerson(tree, { sex: 'F', lineageId: person.lineageId, ...mother });
    union.partnerIds[1] = result.mother.id;
  }
  return result;
}

// Fills exactly one parent slot (father or mother) for a person, leaving the other
// slot untouched if it's still empty - Cards view's click-to-fill-one-box interaction,
// where father and mother are two independently clickable empty spaces rather than
// always being added as a pair. Errors if that specific slot is already filled (the
// box shouldn't have been clickable in that state).
export function addSingleParent(tree, personId, indices, slot, info = {}) {
  const person = tree.people[personId];
  if (!person) throw new Error(`Person not found: ${personId}`);
  if (slot !== 'father' && slot !== 'mother') throw new Error(`Invalid parent slot: ${slot}`);

  const existingUnionId = indices.parentUnionOf.get(personId);
  let union = existingUnionId ? tree.unions[existingUnionId] : null;
  if (!union) union = addUnion(tree, [null, null], [personId]);

  const idx = slot === 'father' ? 0 : 1;
  if (union.partnerIds[idx]) throw new Error(`This person already has a recorded ${slot}.`);

  const newPerson = addPerson(tree, { sex: slot === 'father' ? 'M' : 'F', lineageId: person.lineageId, ...info });
  union.partnerIds[idx] = newPerson.id;
  return newPerson;
}

// Keeps sex consistent with structural role: anyone sitting in a union's father slot
// (partnerIds[0]) with sex still unspecified ("—") becomes male, anyone in the mother
// slot (partnerIds[1]) becomes female. Only touches people whose sex is unspecified -
// an explicit M/F is never changed. Safe to call repeatedly - a no-op once everything's
// already consistent. Returns whether anything changed, so a caller can skip a
// re-render when it didn't.
export function inferMissingSexes(tree) {
  let changed = false;
  for (const union of Object.values(tree.unions)) {
    const father = union.partnerIds[0] ? tree.people[union.partnerIds[0]] : null;
    const mother = union.partnerIds[1] ? tree.people[union.partnerIds[1]] : null;
    if (father && father.sex === 'U') {
      father.sex = 'M';
      changed = true;
    }
    if (mother && mother.sex === 'U') {
      mother.sex = 'F';
      changed = true;
    }
  }
  return changed;
}

export function addSpouse(tree, personId, spouseInfo = {}) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  const spouse = addPerson(tree, spouseInfo);
  const union = addUnion(tree, [personId, spouse.id], []);
  return { union, spouse };
}

// Creates a brand-new root person (one of the "real, alive individuals" a paper trail
// starts from) plus a freshly-named lineage/color for them, so naming a root and
// getting a color to build their tree in is always a single step.
export function addRootPerson(tree, { name = '', lineageName = null, color = null } = {}) {
  const lineage = addLineage(tree, { name: lineageName || (name ? `${name}'s family tree` : 'New family tree'), color });
  return addPerson(tree, { name, lineageId: lineage.id, isRoot: true });
}

// --- Lineages (the colored groups) ------------------------------------------

export function addLineage(tree, { name = 'New family tree', color = null } = {}) {
  const id = newId('l');
  tree.lineages[id] = { id, name, color: color || nextLineageColor(tree.lineages) };
  return tree.lineages[id];
}

export function renameLineage(tree, lineageId, name) {
  if (tree.lineages[lineageId]) tree.lineages[lineageId].name = name;
}

export function recolorLineage(tree, lineageId, color) {
  if (tree.lineages[lineageId]) tree.lineages[lineageId].color = color;
}

export const TRASH_RETENTION_DAYS = 30;

// Deleting a line deletes the people in it - that's the point of removing a line, not
// just detaching its color. Soft-deleted, not gone outright: a full snapshot (the
// lineage, every person who belonged to it, and every union any of them touched, AS
// THEY WERE right before removal) goes into tree.trash, restorable for
// TRASH_RETENTION_DAYS (see restoreLineage/purgeExpiredTrash) before it's actually
// gone. A union with a partner OUTSIDE this line (a cross-line marriage, however that
// came about) isn't deleted outright either - just has this line's side of it cleared,
// so the surviving partner keeps their own remaining children and spouse slot intact.
export function removeLineage(tree, lineageId) {
  const lineage = tree.lineages[lineageId];
  if (!lineage) return null;

  const peopleIds = Object.values(tree.people)
    .filter((p) => p.lineageId === lineageId)
    .map((p) => p.id);
  const peopleIdSet = new Set(peopleIds);

  const affectedUnionIds = Object.entries(tree.unions)
    .filter(([, u]) => u.partnerIds.some((pid) => pid && peopleIdSet.has(pid)) || u.childIds.some((cid) => peopleIdSet.has(cid)))
    .map(([uid]) => uid);

  const trashEntry = {
    id: newId('trash'),
    lineageId,
    lineage: structuredClone(lineage),
    people: Object.fromEntries(peopleIds.map((pid) => [pid, structuredClone(tree.people[pid])])),
    unions: Object.fromEntries(affectedUnionIds.map((uid) => [uid, structuredClone(tree.unions[uid])])),
    deletedAt: new Date().toISOString(),
  };
  if (!tree.trash) tree.trash = [];
  tree.trash.push(trashEntry);

  for (const uid of affectedUnionIds) {
    const union = tree.unions[uid];
    if (!union) continue;
    union.partnerIds = union.partnerIds.map((pid) => (pid && peopleIdSet.has(pid) ? null : pid));
    union.childIds = union.childIds.filter((cid) => !peopleIdSet.has(cid));
    if (!union.partnerIds[0] && !union.partnerIds[1] && union.childIds.length === 0) delete tree.unions[uid];
  }
  for (const pid of peopleIds) {
    unlinkPerson(tree, pid);
    delete tree.people[pid];
  }
  delete tree.lineages[lineageId];

  return trashEntry;
}

// Puts a trashed line back exactly as it was: the lineage, every person, and for each
// affected union either the whole thing (if it was deleted outright) or just this
// line's slot/children merged back in (if it survived, trimmed, because a cross-line
// partner was still using it) - so anything added to that surviving union DURING the
// trash window (a new child, a new spouse slot) isn't clobbered by the restore.
export function restoreLineage(tree, trashId) {
  if (!tree.trash) return false;
  const idx = tree.trash.findIndex((e) => e.id === trashId);
  if (idx === -1) return false;
  const entry = tree.trash[idx];
  const restoredPersonIds = new Set(Object.keys(entry.people));

  tree.lineages[entry.lineageId] = entry.lineage;
  for (const [pid, person] of Object.entries(entry.people)) {
    tree.people[pid] = person;
  }
  for (const [uid, snapshotUnion] of Object.entries(entry.unions)) {
    const current = tree.unions[uid];
    if (!current) {
      tree.unions[uid] = snapshotUnion;
      continue;
    }
    current.partnerIds = current.partnerIds.map((pid, i) => pid ?? (restoredPersonIds.has(snapshotUnion.partnerIds[i]) ? snapshotUnion.partnerIds[i] : pid));
    for (const cid of snapshotUnion.childIds) {
      if (restoredPersonIds.has(cid) && !current.childIds.includes(cid)) current.childIds.push(cid);
    }
  }

  tree.trash.splice(idx, 1);
  return true;
}

// Called once at boot - trash entries older than the retention window are gone for
// real at that point, not just hidden from the list.
export function purgeExpiredTrash(tree) {
  if (!tree.trash || !tree.trash.length) return;
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  tree.trash = tree.trash.filter((e) => new Date(e.deletedAt).getTime() > cutoffMs);
}

// linkedPersonId itself is gone from the app's own UI (the "same real person in two
// lines" idea it modeled doesn't fit what this app is for - two DISTINCT paper trails
// with no confirmed common ancestor, where a crossed path is a candidate LEAD, not a
// duplicate record to merge) - this stays only to cleanly null out the other side of
// any link that already exists in data saved before that field was removed.
export function unlinkPerson(tree, personId) {
  const person = tree.people[personId];
  if (!person) return;
  const other = person.linkedPersonId;
  if (other && tree.people[other]) tree.people[other].linkedPersonId = null;
  person.linkedPersonId = null;
}

// --- Delete cascade ------------------------------------------------------

export function getDescendantPersonIds(tree, personId, indices) {
  const result = new Set();
  const queue = [personId];
  while (queue.length) {
    const pid = queue.shift();
    for (const uid of indices.unionsOf.get(pid) || []) {
      const union = tree.unions[uid];
      if (!union) continue;
      for (const childId of union.childIds) {
        if (!result.has(childId)) {
          result.add(childId);
          queue.push(childId);
        }
      }
    }
  }
  return result;
}

export function removePersonCascade(tree, personId, indices) {
  if (!tree.people[personId]) return;
  const descendants = getDescendantPersonIds(tree, personId, indices);
  const toRemove = new Set([personId, ...descendants]);

  const parentUnionId = indices.parentUnionOf.get(personId);
  if (parentUnionId && tree.unions[parentUnionId]) {
    tree.unions[parentUnionId].childIds = tree.unions[parentUnionId].childIds.filter((id) => id !== personId);
  }

  for (const [uid, union] of Object.entries(tree.unions)) {
    if (union.partnerIds.some((pid) => pid && toRemove.has(pid))) {
      delete tree.unions[uid];
      continue;
    }
    union.childIds = union.childIds.filter((id) => !toRemove.has(id));
  }

  for (const pid of toRemove) {
    unlinkPerson(tree, pid);
    delete tree.people[pid];
  }
}
