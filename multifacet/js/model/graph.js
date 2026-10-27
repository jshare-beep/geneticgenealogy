// Pedigree graph data model.
//
// A "tree" document is a normalized graph, not a single-parent tree: Persons don't
// point at their parents directly, Unions own that relationship via childIds. This is
// what makes it possible to represent a married-in spouse's own independent ancestry
// ("the other side" / a facet) hanging off any Person, in any direction, without the
// document needing a single root.

import { newId } from '../util/id.js';

export const SCHEMA_VERSION = 1;

export function createEmptyTree(title = 'Untitled tree') {
  return {
    id: null,
    schemaVersion: SCHEMA_VERSION,
    title,
    people: {},
    unions: {},
    matches: {},
    possibilities: {},
    nextPossibilityNumber: 1,
    branches: {},
    layoutOverrides: {},
    viewState: null,
  };
}

// Bold, high-contrast colors for branch-flagged cards - deliberately distinct from the
// muted possibility purple and the warm accent, so a branch card reads as its own
// visual category at a glance. Assigned in order as branches are designated and stored
// on the branch record, so a given branch keeps its color across sessions.
export const BRANCH_PALETTE = ['#1f6f6b', '#8a3f8f', '#2f5fa8', '#a85f1f', '#3f7a3f', '#a83f5e'];

// --- Indices (derived, never persisted) ---------------------------------

export function buildIndices(tree) {
  const parentUnionOf = new Map(); // personId -> unionId (the union that is this person's own parents)
  const unionsOf = new Map(); // personId -> unionId[] (unions where this person is a partner)
  const childrenOf = new Map(); // personId -> personId[] (this person's children, across all their unions)
  const spouseOf = new Map(); // personId -> personId[] (partners across all unions)

  for (const union of Object.values(tree.unions)) {
    for (const childId of union.childIds) {
      parentUnionOf.set(childId, union.id);
    }
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

// --- Mutations ------------------------------------------------------------

export function addPerson(tree, { name = '', sex = 'U', birthYear = null, deathYear = null, notes = '' } = {}) {
  const id = newId('p');
  tree.people[id] = { id, name, sex, birthYear, deathYear, notes };
  return tree.people[id];
}

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

// "Pivot to the other side": give an existing person (who has no parents in this
// document yet) a new parent couple. This is the one primitive that lets a
// married-in spouse's own ancestry become a new facet, arbitrarily deep.
export function addParentsToPerson(tree, personId, indices, { parent1 = {}, parent2 = {} } = {}) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  if (indices.parentUnionOf.has(personId)) {
    throw new Error('This person already has parents in this tree.');
  }
  const p1 = addPerson(tree, parent1);
  const p2 = addPerson(tree, parent2);
  const union = addUnion(tree, [p1.id, p2.id], [personId]);
  return { union, parent1: p1, parent2: p2 };
}

// Add a new spouse union for an existing person (no children yet).
export function addSpouse(tree, personId, spouseInfo = {}) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  const spouse = addPerson(tree, spouseInfo);
  const union = addUnion(tree, [personId, spouse.id], []);
  return { union, spouse };
}

export function addMatch(tree, { personId, cM }) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  if (typeof cM !== 'number' || Number.isNaN(cM) || cM < 0) {
    throw new Error('cM must be a non-negative number.');
  }
  const id = newId('m');
  tree.matches[id] = { id, personId, cM };
  return tree.matches[id];
}

// A Possibility is a flag on a real Person: "this could be where my unplaced DNA
// match actually belongs." Flagging/unflagging doesn't move or create anyone - the
// person is added to the tree like any other (a normal child, a new founding person,
// etc.), then designated as a possibility from their own menu. At most one Possibility
// per person - designating twice is a no-op that returns the existing one.
export function addPossibility(tree, { personId }) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  const existing = getPossibilityForPerson(tree, personId);
  if (existing) return existing;
  const id = newId('h');
  // A stable, permanent number - most possibilities never get a real name (they
  // represent an open position, not a known person), so this is how they get
  // referred to consistently between the tree and the sidebar. Assigned once at
  // creation and never reused or renumbered, even if other possibilities are removed.
  const number = tree.nextPossibilityNumber || 1;
  tree.nextPossibilityNumber = number + 1;
  tree.possibilities[id] = { id, personId, number };
  return tree.possibilities[id];
}

export function getPossibilityForPerson(tree, personId) {
  return Object.values(tree.possibilities).find((p) => p.personId === personId) || null;
}

// A Branch is a flag on a real Person marking them as a distinct, independently
// explorable line of ancestry (typically a married-in spouse whose own family isn't
// blood-related to the main line). Purely a UI/navigation aid - it doesn't change
// scoring - but it gets a bold, stable color and can be jumped into directly from the
// canvas via the branch-focus view.
export function addBranch(tree, { personId }) {
  if (!tree.people[personId]) throw new Error(`Person not found: ${personId}`);
  const existing = getBranchForPerson(tree, personId);
  if (existing) return existing;
  const id = newId('b');
  const color = BRANCH_PALETTE[Object.keys(tree.branches).length % BRANCH_PALETTE.length];
  tree.branches[id] = { id, personId, color };
  return tree.branches[id];
}

export function getBranchForPerson(tree, personId) {
  return Object.values(tree.branches).find((b) => b.personId === personId) || null;
}

// Whether a person needs their own visible card rather than being folded into a
// partner's - true once there's something specific to them worth seeing on its own:
// they're a designated branch, a possibility, or they already have their own parents
// entered (an ancestral couple with nothing else going on renders as one shared pill,
// like WATO does, until one side becomes worth exploring on its own).
export function isPersonExpanded(tree, indices, personId) {
  if (getBranchForPerson(tree, personId)) return true;
  if (getPossibilityForPerson(tree, personId)) return true;
  if (indices.parentUnionOf.has(personId)) return true;
  return false;
}

// Used for the couple-merge rendering decision: a union renders as one shared pill
// only if NEITHER partner has any other union anywhere, and at least one of them is
// otherwise unremarkable (not a branch/possibility, no parents of their own) so there's
// someone eligible to fold into the other. The "no other union" half applies to BOTH
// sides regardless of which one folds - it's not enough to check the partner who'd fold
// in, because if the OTHER partner (who stays primary/visible either way) has a second
// marriage elsewhere, merging this union into a single pill still hides the folded
// partner's identity right when that second marriage's own connector line needs an
// unambiguous card to attach to, not just a name folded into someone else's pill. The
// "at least one unremarkable" half stays per-partner as before: the blood-line
// descendant who connects the rest of the tree is allowed to have their own parents on
// record and still be the visible primary card - only the person actually folding in
// needs to have nothing else going on.
export function canUnionMerge(tree, indices, unionId) {
  const union = tree.unions[unionId];
  if (!union) return false;
  const partners = union.partnerIds.filter(Boolean);
  if (partners.length !== 2) return false;
  const hasNoOtherUnion = (personId) => !(indices.unionsOf.get(personId) || []).some((uid) => uid !== unionId);
  if (!partners.every(hasNoOtherUnion)) return false;
  return partners.some((personId) => !isPersonExpanded(tree, indices, personId));
}

export function removeBranch(tree, branchId) {
  delete tree.branches[branchId];
}

export function removeMatch(tree, matchId) {
  delete tree.matches[matchId];
}

export function removePossibility(tree, possibilityId) {
  delete tree.possibilities[possibilityId];
}

// Creates a brand-new person and grafts them onto the tree as a full sibling (same
// union, i.e. same two parents) or half-sibling (shares exactly one named parent) of
// an existing, already-placed person. Sibling-adding always starts from an existing
// person's own menu (never from a floating unconnected node) because family-chart only
// draws the component reachable from its root - an orphan with no relations at all
// would never render as a clickable card in the first place.
export function addSiblingOf(tree, indices, { referencePersonId, relation, sharedParentId, personInfo = {} }) {
  const unionId = indices.parentUnionOf.get(referencePersonId);
  if (!unionId || !tree.unions[unionId]) {
    throw new Error('This person has no parents in this tree yet.');
  }
  const refUnion = tree.unions[unionId];
  const newPerson = addPerson(tree, personInfo);

  if (relation === 'full') {
    addChildToUnion(tree, refUnion.id, newPerson);
    return newPerson;
  }

  if (relation === 'half') {
    const parentId = sharedParentId || refUnion.partnerIds.filter(Boolean)[0];
    if (!parentId) throw new Error('No known parent to share yet - add at least one parent first.');
    // Reuse an existing "this parent + not-yet-entered partner" union if the reference
    // person already has one, so two half-siblings added this way end up half-siblings
    // of each other too, instead of each getting their own disconnected phantom union.
    let targetUnion = Object.values(tree.unions).find(
      (u) => u.id !== refUnion.id && u.partnerIds.includes(parentId) && u.partnerIds.some((pid) => !pid)
    );
    if (!targetUnion) targetUnion = addUnion(tree, [parentId, null], []);
    addChildToUnion(tree, targetUnion.id, newPerson);
    return newPerson;
  }

  throw new Error(`Unknown relation: ${relation}`);
}

export function getDescendantPersonIds(tree, personId, indices) {
  const result = new Set();
  const queue = [personId];
  while (queue.length) {
    const pid = queue.shift();
    const unionIds = indices.unionsOf.get(pid) || [];
    for (const uid of unionIds) {
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

// Deletes a person and cascades to their descendants (and any matches/possibilities that
// were anchored on them), mirroring the "delete this branch" expectation a user has
// when removing someone from the tree. Ancestors and spouses are left intact; a
// spouse-union that loses a partner keeps its other partner and children.
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

  for (const pid of toRemove) delete tree.people[pid];

  for (const [mid, match] of Object.entries(tree.matches)) {
    if (toRemove.has(match.personId)) delete tree.matches[mid];
  }
  for (const [possId, poss] of Object.entries(tree.possibilities)) {
    if (toRemove.has(poss.personId)) delete tree.possibilities[possId];
  }
  for (const [branchId, branch] of Object.entries(tree.branches)) {
    if (toRemove.has(branch.personId)) delete tree.branches[branchId];
  }
}

export function findConnectedComponents(tree, indices) {
  const seen = new Set();
  const components = [];
  for (const personId of Object.keys(tree.people)) {
    if (seen.has(personId)) continue;
    const component = new Set();
    const queue = [personId];
    while (queue.length) {
      const pid = queue.shift();
      if (component.has(pid)) continue;
      component.add(pid);
      seen.add(pid);
      const neighbors = [
        ...(indices.spouseOf.get(pid) || []),
        ...(indices.childrenOf.get(pid) || []),
      ];
      const parentUnionId = indices.parentUnionOf.get(pid);
      if (parentUnionId) neighbors.push(...tree.unions[parentUnionId].partnerIds.filter(Boolean));
      for (const n of neighbors) if (!component.has(n)) queue.push(n);
    }
    components.push(component);
  }
  return components;
}
