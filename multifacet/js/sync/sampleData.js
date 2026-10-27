// Pre-built demo tree so a first-time user can see Multifacet's scoring, branch, and
// half-sibling features working on real data without entering anything by hand.
//
// Structure: Roy Calder has two marriages (a half-sibling line between them) and
// three grandchild-generation possibilities that each land differently once scored -
// one clearly ruled out, one clearly the strongest, one also ruled out through a
// different route - plus a branch-flagged second wife with her own ancestry to explore.

import { createEmptyTree, addPerson, addUnion, addChildToUnion, addMatch, addPossibility, addBranch } from '../model/graph.js';

export function buildSampleTree() {
  const tree = createEmptyTree('Calder family (sample)');

  const roy = addPerson(tree, { name: 'Roy Calder', sex: 'M', birthYear: 1900 });
  const edna = addPerson(tree, { name: 'Edna Sutter', sex: 'F' });
  const unionRoyEdna = addUnion(tree, [roy.id, edna.id], []);
  // The founder is branch #1 like any other - there's no separate "main tree" concept,
  // just whichever branches exist and a lead individual to name and focus each by.
  addBranch(tree, { personId: roy.id });

  const lowell = addChildToUnion(tree, unionRoyEdna.id, { name: 'Lowell Calder', sex: 'M', birthYear: 1936 });
  const marion = addChildToUnion(tree, unionRoyEdna.id, { name: 'Marion Calder', sex: 'F', birthYear: 1946 });
  const dorothea = addChildToUnion(tree, unionRoyEdna.id, { name: 'Dorothea Calder', sex: 'F' });

  // Roy's second marriage: a half-sibling line (their child gets its own connector
  // color, distinct from the Roy+Edna line) and Lenora's own independent ancestry -
  // designated as a branch so it can be viewed on its own.
  const lenora = addPerson(tree, { name: 'Lenora Birch', sex: 'F' });
  const unionRoyLenora = addUnion(tree, [roy.id, lenora.id], []);
  addChildToUnion(tree, unionRoyLenora.id, { name: 'Gordon Calder', sex: 'M' });
  addBranch(tree, { personId: lenora.id });

  const wendell = addPerson(tree, { name: 'Wendell Birch', sex: 'M' });
  const odessa = addPerson(tree, { name: 'Odessa Birch', sex: 'F' });
  const unionBirch = addUnion(tree, [wendell.id, odessa.id], []);
  addChildToUnion(tree, unionBirch.id, { id: lenora.id });

  // Lowell's line: an unplaced possibility ruled out by three matches through Maribel's
  // side, all far too low in cM for the relationship they'd imply if this were right.
  const maribel = addPerson(tree, { name: 'Maribel Quade', sex: 'F', birthYear: 1958 });
  const unionLowellMaribel = addUnion(tree, [lowell.id, maribel.id], []);
  const possibility1 = addChildToUnion(tree, unionLowellMaribel.id, { name: '', sex: 'U' });
  addPossibility(tree, { personId: possibility1.id });

  const hollis = addPerson(tree, { name: 'Hollis Quade', sex: 'M' });
  const agnes = addPerson(tree, { name: 'Agnes Linden', sex: 'F' });
  const unionQuade = addUnion(tree, [hollis.id, agnes.id], []);
  addChildToUnion(tree, unionQuade.id, { id: maribel.id });
  const corinne = addChildToUnion(tree, unionQuade.id, { name: 'Corinne Linden', sex: 'F' });
  const katrina = addChildToUnion(tree, unionQuade.id, { name: 'Katrina Holloway Pierce', sex: 'F' });
  addMatch(tree, { personId: corinne.id, cM: 46 });
  addMatch(tree, { personId: katrina.id, cM: 44 });

  const unionCorinneSolo = addUnion(tree, [corinne.id, null], []);
  const daphne = addChildToUnion(tree, unionCorinneSolo.id, { name: 'Daphne Rivers', sex: 'F' });
  addMatch(tree, { personId: daphne.id, cM: 33 });

  // Marion's line: the strongest result in this sample - Anson's match cM lands right
  // in the full-sibling range, and since the other two lines below get ruled out, this
  // possibility ends up the only viable one, so it comes out on top.
  const howard = addPerson(tree, { name: 'Howard Stokes', sex: 'M' });
  const unionMarionHoward = addUnion(tree, [marion.id, howard.id], []);
  const anson = addChildToUnion(tree, unionMarionHoward.id, { name: 'Anson Stokes', sex: 'M' });
  addChildToUnion(tree, unionMarionHoward.id, { name: 'Rory Stokes', sex: 'M' });
  const possibility2 = addChildToUnion(tree, unionMarionHoward.id, { name: '', sex: 'U' });
  addPossibility(tree, { personId: possibility2.id });
  addMatch(tree, { personId: anson.id, cM: 2650 });

  // Dorothea's line: ruled out a different way - a match on Marvin himself (the
  // possibility's father through this line, if this were right) that's far too low to
  // be a parent/child pair. Deliberately NOT on Roy: he's every branch's grandparent,
  // so a bad match there would rule out all three lines at once instead of just this one.
  const marvin = addPerson(tree, { name: 'Marvin Lyle', sex: 'M' });
  const unionDorotheaMarvin = addUnion(tree, [dorothea.id, marvin.id], []);
  const possibility3 = addChildToUnion(tree, unionDorotheaMarvin.id, { name: '', sex: 'U' });
  addPossibility(tree, { personId: possibility3.id });
  addMatch(tree, { personId: marvin.id, cM: 15 });

  return tree;
}
