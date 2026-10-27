// Translates this app's Person/Union/Possibility pedigree graph into family-chart's
// flat per-person array format ({id, data, rels}) for rendering. family-chart is used
// purely as a read-only layout/pan/zoom surface here - all edits go through this app's
// own person menu (main.js) and graph.js mutators, then flow back down through this
// same translation on the next refresh(), so there's no reverse (chart -> tree) path.
//
// A Possibility is just a flag on a real Person (see graph.js), so it needs no node of
// its own here - its score/badge is attached directly onto that person's `data`.
//
// An "ancestral couple" with nothing else going on (like WATO's founding-couple pill)
// renders as ONE shared card, not two: for each union, if the whole union is mergeable
// (see graph.js canUnionMerge - neither partner is a branch/possibility, has parents of
// their own, or has any OTHER union anywhere), the second-listed partner gets no node
// of their own here at all - their name/years are folded into their partner's card
// data instead, and they're dropped from spouse/parent rels entirely (family-chart then
// treats it as a single-parent union, which it already supports natively). The moment
// either partner has a second marriage, neither one folds - both stay fully visible so
// that marriage's own connector line has an unambiguous card to attach to.

import { canUnionMerge, isPersonExpanded } from '../model/graph.js';

// family-chart requires an M/F value per person and, internally, uses it to decide
// which side of a card its spouses fan out on ("M" always fans spouses to the right,
// putting the man on the left; anyone else fans them to the left) - a hardcoded rule
// in the library itself, not something we ever asked for. We don't use family-chart's
// own gender-based card coloring (removed earlier - every pill is plain regardless of
// sex) and nothing else in this app reads this field back, so it's free to repurpose:
// feed it a value derived from the person's id instead of their recorded sex, so which
// side a person's spouses land on is decided by nothing more meaningful than their id,
// never by their gender.
function layoutSideFor(personId) {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) hash = (hash * 31 + personId.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0 ? 'M' : 'F';
}

export function treeToF3Data(tree, indices, rankedResults) {
  const resultByPersonId = new Map(rankedResults.map((r) => [r.possibility.personId, r]));
  const branchByPersonId = new Map(Object.values(tree.branches).map((b) => [b.personId, b]));
  const matchesByPerson = new Map();
  for (const match of Object.values(tree.matches)) {
    if (!matchesByPerson.has(match.personId)) matchesByPerson.set(match.personId, []);
    matchesByPerson.get(match.personId).push(match);
  }

  // primaryOf: suppressedPersonId -> the partner they're folded into.
  // coSpouseOf: primaryPersonId -> the Person object folded into their card.
  const primaryOf = new Map();
  const coSpouseOf = new Map();
  for (const union of Object.values(tree.unions)) {
    const [a, b] = union.partnerIds;
    if (!a || !b) continue; // nothing to merge when the other partner isn't even known
    if (!canUnionMerge(tree, indices, union.id)) continue;
    // Whichever side has nothing else going on folds in, so the blood-line descendant
    // (the one with parents on record) stays as the visible card; if neither is
    // expanded (a plain founding couple), the first-listed partner stays primary.
    const aExpanded = isPersonExpanded(tree, indices, a);
    const bExpanded = isPersonExpanded(tree, indices, b);
    const [primaryId, secondaryId] = !aExpanded && bExpanded ? [b, a] : [a, b];
    primaryOf.set(secondaryId, primaryId);
    coSpouseOf.set(primaryId, tree.people[secondaryId]);
  }

  const nodes = [];

  for (const person of Object.values(tree.people)) {
    if (primaryOf.has(person.id)) continue; // rendered folded into their partner instead

    const parentUnionId = indices.parentUnionOf.get(person.id);
    const parentUnion = parentUnionId ? tree.unions[parentUnionId] : null;
    const parents = parentUnion
      ? parentUnion.partnerIds.filter(Boolean).filter((pid) => !primaryOf.has(pid))
      : [];
    const spouses = [...new Set(indices.spouseOf.get(person.id) || [])].filter((pid) => !primaryOf.has(pid));
    const children = [...new Set(indices.childrenOf.get(person.id) || [])];
    const matches = matchesByPerson.get(person.id) || [];

    const result = resultByPersonId.get(person.id);
    const isPossibility = !!result;
    const eliminated = isPossibility && result.logScore === -Infinity;
    const possBadge = !isPossibility
      ? ''
      : eliminated
      ? 'Ruled out'
      : !result.hasEvidence
      ? 'No evidence yet'
      : result.probability != null
      ? `${Math.round(result.probability * 100)}%`
      : '—';

    const branch = branchByPersonId.get(person.id);
    const coSpouse = coSpouseOf.get(person.id);
    const coSpouseYears =
      coSpouse && (coSpouse.birthYear || coSpouse.deathYear) ? `${coSpouse.birthYear ?? '?'}–${coSpouse.deathYear ?? '?'}` : '';

    const node = {
      id: person.id,
      data: {
        gender: layoutSideFor(person.id), // layout-only signal, decoupled from real sex - see comment above
        name: person.name || '',
        birthYear: person.birthYear ?? '',
        deathYear: person.deathYear ?? '',
        notes: person.notes || '',
        cmBadge: matches.map((m) => `${m.cM} cM`).join(', '),
        isPossibility,
        possNumber: isPossibility ? result.possibility.number : null,
        possBadge,
        possStrength: isPossibility ? result.strength : null,
        isTop: isPossibility && !!result.isTopViable,
        eliminated,
        isBranch: !!branch,
        branchColor: branch?.color || null,
        hasCoSpouse: !!coSpouse,
        coSpouseName: coSpouse?.name || '',
        coSpouseYears,
      },
      rels: { parents: [...parents], spouses, children },
    };
    nodes.push(node);
  }

  return nodes;
}
