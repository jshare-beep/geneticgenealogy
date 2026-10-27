// Translates this app's Person/Union graph into family-chart's flat per-person array
// format ({id, data, rels}), same read-only-surface convention as Multifacet: all edits
// go through this app's own person dialog and graph.js mutators, then flow back down
// through this same translation on the next refresh().
//
// Every person always gets their own card, spouses included - each has their own
// dates and places (birth/death year, birthplace) worth seeing at a glance, which a
// shared "couple pill" would hide for whichever partner didn't get top billing.

// family-chart hardcodes which side a person's spouses fan out to based on this field
// ("M" fans right); we don't use its gender-based coloring at all, so repurpose it as a
// pure layout signal derived from id, decoupled from the person's actual recorded sex.
function layoutSideFor(personId) {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) hash = (hash * 31 + personId.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0 ? 'M' : 'F';
}

function yearsLabel(person) {
  const b = person.birth?.year;
  const d = person.death?.year;
  return b || d ? `${b ?? '?'}–${d ?? '?'}` : '';
}

// `ancestorRootId`/`maxAncestorGen` add a synthetic "+ Add father"/"+ Add mother" node
// for every missing parent slot within `maxAncestorGen` generations of that one person
// (root counted as generation 1, so 7 reaches great-great-great-great-grandparents -
// about the reach of useful shared-DNA matching). This is what makes gaps in the paper
// trail visible at a glance in Cards view instead of the
// tree just quietly stopping wherever the data runs out - family-chart's own
// setSingleParentEmptyCard only covers the case where exactly one parent is already
// known, not the far more common case of a person with neither parent recorded yet.
export function treeToF3Data(tree, indices, { ancestorRootId = null, maxAncestorGen = 7 } = {}) {
  const nodes = [];
  const nodeById = new Map();
  for (const person of Object.values(tree.people)) {
    const parentUnionId = indices.parentUnionOf.get(person.id);
    const parentUnion = parentUnionId ? tree.unions[parentUnionId] : null;
    const parents = parentUnion ? parentUnion.partnerIds.filter(Boolean) : [];
    const spouses = [...new Set(indices.spouseOf.get(person.id) || [])];
    const children = [...new Set(indices.childrenOf.get(person.id) || [])];
    const lineage = tree.lineages[person.lineageId];

    const node = {
      id: person.id,
      data: {
        gender: layoutSideFor(person.id),
        name: person.name || '',
        years: yearsLabel(person),
        isRoot: !!person.isRoot,
        lineageColor: lineage?.color || null,
        lineageName: lineage?.name || '',
      },
      rels: { parents: [...parents], spouses, children },
    };
    nodes.push(node);
    nodeById.set(person.id, node);
  }

  if (ancestorRootId && tree.people[ancestorRootId]) {
    injectAncestorPlaceholders(tree, indices, nodes, nodeById, ancestorRootId, maxAncestorGen);
  }

  return nodes;
}

function injectAncestorPlaceholders(tree, indices, nodes, nodeById, rootId, maxGen) {
  const visited = new Set();
  const queue = [{ id: rootId, gen: 1 }];
  while (queue.length) {
    const { id, gen } = queue.shift();
    if (visited.has(id) || gen >= maxGen) continue; // at maxGen, this person's own parents fall outside the window
    visited.add(id);

    const unionId = indices.parentUnionOf.get(id);
    const union = unionId ? tree.unions[unionId] : null;
    const fatherId = union?.partnerIds[0] || null;
    const motherId = union?.partnerIds[1] || null;

    if (fatherId) queue.push({ id: fatherId, gen: gen + 1 });
    else addPlaceholderParent(nodes, nodeById, id, 'father');

    if (motherId) queue.push({ id: motherId, gen: gen + 1 });
    else addPlaceholderParent(nodes, nodeById, id, 'mother');
  }
}

function addPlaceholderParent(nodes, nodeById, childId, slot) {
  const phId = `ph:${childId}:${slot}`;
  if (nodeById.has(phId)) return;
  const childNode = nodeById.get(childId);
  if (!childNode) return;

  const phNode = {
    id: phId,
    data: {
      gender: layoutSideFor(phId),
      name: '',
      years: '',
      isRoot: false,
      lineageColor: null,
      lineageName: '',
      isPlaceholder: true,
      placeholderSlot: slot,
    },
    rels: { parents: [], spouses: [], children: [childId] },
  };
  nodes.push(phNode);
  nodeById.set(phId, phNode);
  childNode.rels.parents.push(phId);
}
