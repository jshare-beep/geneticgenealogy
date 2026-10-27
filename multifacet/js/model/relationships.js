// Relationship-path algorithm: given any two positions in the pedigree graph (a
// Possibility's implied position, or a Match's anchor Person), find their nearest
// common ancestor(s) and classify the genealogical relationship (degree + removal,
// half or full), then turn that into the shorthand code used to look up cM ranges.
//
// v1 scope: BFS ancestor-depth maps, single nearest-common-ancestor pair. Pedigree
// collapse (two people connected via more than one independent ancestor path, e.g.
// cousin marriages) is not handled - see plan for why that's an acceptable v1 gap.

const DEFAULT_MAX_DEPTH = 15;

// Map<personId, minGenerationsFromSeed>. Seeds start at `startDepth` (0 for an actual
// Person, 1 for a Possibility's implied parents, since the possibility itself is depth 0
// but has no Person node of its own).
export function computeAncestorDepths(seedPersonIds, indices, tree, startDepth = 0, maxDepth = DEFAULT_MAX_DEPTH) {
  const depths = new Map();
  let frontier = new Set(seedPersonIds.filter(Boolean));
  let depth = startDepth;
  while (frontier.size && depth <= maxDepth) {
    const next = new Set();
    for (const id of frontier) {
      if (!depths.has(id)) depths.set(id, depth);
      const unionId = indices.parentUnionOf.get(id);
      if (!unionId) continue;
      const union = tree.unions[unionId];
      if (!union) continue;
      for (const partnerId of union.partnerIds) {
        if (partnerId && !depths.has(partnerId)) next.add(partnerId);
      }
    }
    frontier = next;
    depth++;
  }
  return depths;
}

export function ancestorDepthsForPerson(personId, indices, tree, maxDepth = DEFAULT_MAX_DEPTH) {
  return computeAncestorDepths([personId], indices, tree, 0, maxDepth);
}

// Returns null if the two depth maps share no ancestor yet (the branches haven't been
// connected in the tree) - callers must treat that as "not evaluable", not as zero
// probability.
export function findCommonAncestors(depthsA, depthsB) {
  const commonIds = [...depthsA.keys()].filter((id) => depthsB.has(id));
  if (!commonIds.length) return null;

  let bestSum = Infinity;
  for (const id of commonIds) {
    const sum = depthsA.get(id) + depthsB.get(id);
    if (sum < bestSum) bestSum = sum;
  }
  const candidates = commonIds.filter((id) => depthsA.get(id) + depthsB.get(id) === bestSum);
  return {
    candidates,
    dA: depthsA.get(candidates[0]),
    dB: depthsB.get(candidates[0]),
  };
}

function candidatesFormACouple(candidates, tree) {
  if (candidates.length !== 2) return false;
  const [a, b] = candidates;
  return Object.values(tree.unions).some(
    (u) => u.partnerIds.includes(a) && u.partnerIds.includes(b)
  );
}

// { type: 'lineal'|'collateral', half: bool, degree: int, removal: int }
// degree/removal follow the standard genealogical formula:
//   degree   = min(dA, dB) - 1   (0 for siblings, 1 for aunt/uncle, 2 for 1st cousin, ...)
//   removal  = |dA - dB|
// A relationship is "lineal" (direct-line ancestor/descendant) when one side IS the
// common ancestor (min(dA, dB) === 0).
export function classifyRelationship({ candidates, dA, dB }, tree) {
  const half = !candidatesFormACouple(candidates, tree);
  const small = Math.min(dA, dB);
  const large = Math.max(dA, dB);
  if (small === 0) {
    return { type: 'lineal', half: false, degree: large, removal: 0 };
  }
  return { type: 'collateral', half, degree: small - 1, removal: large - small };
}

// Canonical shorthand key used to index the cM range table.
export function relationshipToCmKey({ type, half, degree, removal }) {
  if (type === 'lineal') {
    if (degree === 0) return 'SELF';
    if (degree === 1) return 'P';
    if (degree === 2) return 'GP';
    if (degree === 3) return 'GGP';
    return `${degree - 2}xGGP`;
  }
  let base;
  if (degree === 0) {
    if (removal === 0) base = 'S';
    else if (removal === 1) base = 'AU';
    else if (removal === 2) base = 'GAU';
    else base = `${removal - 1}xGGAU`;
  } else {
    base = removal === 0 ? `${degree}C` : `${degree}C${removal}R`;
  }
  return half ? `H${base}` : base;
}

const LINEAL_LABELS = ['Self', 'Parent/Child', 'Grandparent/Grandchild', 'Great-Grandparent/Great-Grandchild'];
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function relationshipLabel({ type, half, degree, removal }) {
  const prefix = half ? 'Half ' : '';
  if (type === 'lineal') {
    if (degree < LINEAL_LABELS.length) return LINEAL_LABELS[degree];
    return `${degree - 2}x Great-Grandparent/Great-Grandchild`;
  }
  if (degree === 0) {
    if (removal === 0) return `${prefix}Sibling`;
    if (removal === 1) return `${prefix}Aunt/Uncle or Niece/Nephew`;
    if (removal === 2) return `${prefix}Great-Aunt/Uncle or Great-Niece/Nephew`;
    return `${prefix}${removal - 1}x Great-Aunt/Uncle or Great-Niece/Nephew`;
  }
  const cousinDegree = `${ordinal(degree)} Cousin`;
  const removedSuffix = removal === 0 ? '' : ` ${removal}x Removed`;
  return `${prefix}${cousinDegree}${removedSuffix}`;
}

// Given a possibility's person and a match's anchor person, walk up from the
// possibility's own parent union toward the common ancestor, recording at each
// generation which partner's line the connection continues through. facetPath[0] is
// the top-level facet (which parent this match's evidence comes through) - used for
// the per-facet score breakdown. Returns [] if the two aren't connected.
export function computeFacetPath(possibilityPersonId, matchPersonId, indices, tree, maxDepth = DEFAULT_MAX_DEPTH) {
  const matchDepths = computeAncestorDepths([matchPersonId], indices, tree, 0, maxDepth);
  if (!matchDepths.size) return [];

  const path = [];
  let currentUnionId = indices.parentUnionOf.get(possibilityPersonId);
  const visited = new Set();
  while (currentUnionId && !visited.has(currentUnionId)) {
    visited.add(currentUnionId);
    const currentUnion = tree.unions[currentUnionId];
    if (!currentUnion) break;

    let chosenPartner = null;
    for (const partnerId of currentUnion.partnerIds) {
      if (!partnerId) continue;
      if (matchDepths.has(partnerId)) {
        chosenPartner = partnerId;
        break;
      }
      const partnerAncestors = computeAncestorDepths([partnerId], indices, tree, 0, maxDepth);
      if ([...partnerAncestors.keys()].some((id) => matchDepths.has(id))) {
        chosenPartner = partnerId;
        break;
      }
    }
    if (!chosenPartner) break;
    path.push({ unionId: currentUnionId, partnerId: chosenPartner, name: tree.people[chosenPartner]?.name || '' });
    currentUnionId = indices.parentUnionOf.get(chosenPartner);
  }
  return path;
}

export function classifyBetween(seedDepthsA, seedDepthsB, tree) {
  const common = findCommonAncestors(seedDepthsA, seedDepthsB);
  if (!common) return null;
  return classifyRelationship(common, tree);
}
