// Ahnentafel ("ancestor table") numbering for the fan chart: the focus person is 1,
// father of n is 2n, mother is 2n+1 - following this app's
// partnerIds[0]=father/partnerIds[1]=mother convention used everywhere else.

// Walks the tree from `rootId`, building an ahnentafel number -> personId map (null
// where an ancestor isn't recorded in the tree, which is the normal/expected case for
// most real trees - the fan chart is supposed to show the gaps, not hide them). `maxGen`
// is ancestor generations *beyond* the root (root itself is gen 0, so maxGen=5 reaches
// great-great-grandparents), matching the fan chart's "Generations" dropdown.
export function buildAhnentafel(tree, indices, rootId, maxGen) {
  const map = new Map();
  function walk(personId, n, gen) {
    map.set(n, personId);
    if (gen >= maxGen) return;
    let fatherId = null;
    let motherId = null;
    if (personId) {
      const unionId = indices.parentUnionOf.get(personId);
      const union = unionId ? tree.unions[unionId] : null;
      if (union) {
        fatherId = union.partnerIds[0] || null;
        motherId = union.partnerIds[1] || null;
      }
    }
    walk(fatherId, 2 * n, gen + 1);
    walk(motherId, 2 * n + 1, gen + 1);
  }
  walk(rootId, 1, 0);
  return map;
}

const MAX_ANCESTOR_GEN_CAP = 20; // real genealogical data can't have a true cycle, but a corrupted/hand-edited tree could - this bounds the walk regardless

// The deepest generation (same 0-indexed-at-root convention as buildAhnentafel) that
// actually has a recorded person in this person's direct ancestor line - what "All"
// means in the fan chart's generations picker, as opposed to a fixed number.
export function computeMaxAncestorGen(tree, indices, rootId) {
  let maxGen = 0;
  function walk(personId, gen) {
    if (!personId || gen > MAX_ANCESTOR_GEN_CAP) return;
    maxGen = Math.max(maxGen, gen);
    const unionId = indices.parentUnionOf.get(personId);
    const union = unionId ? tree.unions[unionId] : null;
    if (!union) return;
    walk(union.partnerIds[0] || null, gen + 1);
    walk(union.partnerIds[1] || null, gen + 1);
  }
  walk(rootId, 0);
  return maxGen;
}
