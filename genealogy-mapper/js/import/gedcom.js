// Parses a GEDCOM file (the standard export format from Ancestry, FamilySearch,
// MyHeritage, RootsMagic, and effectively every other genealogy program) and imports
// its individuals/families into this app's tree, all assigned to one chosen lineage.
//
// Covers what a map+timeline actually needs - name, sex, birth/death date+place,
// FAM-based parent/child/spouse links, and any other dated+placed event a source
// recorded for someone (a census residence, an obituary's last address, a burial
// elsewhere than the death place) as life events - deliberately not the full GEDCOM
// spec (sources/citations themselves, notes-with-CONC/CONT continuation, multimedia,
// custom tags without a place). Good enough for a first pass on 7-10 generations of
// real exports; anything it can't place still lands in the tree as a name, just
// without dates/places to plot.

function parseLine(rawLine) {
  const line = rawLine.replace(/\r$/, '');
  const firstSpace = line.indexOf(' ');
  if (firstSpace === -1) return null;
  const level = parseInt(line.slice(0, firstSpace), 10);
  if (Number.isNaN(level)) return null;
  let rest = line.slice(firstSpace + 1);
  let xref = null;
  if (rest.startsWith('@')) {
    const end = rest.indexOf('@', 1);
    if (end !== -1) {
      xref = rest.slice(1, end);
      rest = rest.slice(end + 2);
    }
  }
  const secondSpace = rest.indexOf(' ');
  const tag = secondSpace === -1 ? rest : rest.slice(0, secondSpace);
  const value = secondSpace === -1 ? '' : rest.slice(secondSpace + 1);
  return { level, xref, tag, value };
}

function buildRecordTree(lines) {
  const root = { level: -1, children: [] };
  const stack = [root];
  for (const line of lines) {
    const node = { ...line, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

function findChild(node, tag) {
  return node.children.find((c) => c.tag === tag) || null;
}
function findChildren(node, tag) {
  return node.children.filter((c) => c.tag === tag);
}

function stripAt(value) {
  return (value || '').replace(/@/g, '').trim();
}

// Tags that can carry a person's own dated+placed "where were they at this point"
// fact, beyond birth and death - RESI (residence, usually from a census or directory),
// CENS (census, some exporters use this tag instead of RESI), a placed EVEN (a custom
// event with a location), and BURI (burial - occasionally a different place than
// death, e.g. a body moved home). Every one of these becomes a life event, which is
// exactly what this app's "Other places lived" field already exists for.
const LIFE_EVENT_TAGS = ['RESI', 'CENS', 'EVEN', 'BURI'];

function collectLifeEvents(rec, birth, death) {
  const seen = new Set([birth.place && `${birth.date}|${birth.place}`, death.place && `${death.date}|${death.place}`].filter(Boolean));
  const events = [];
  for (const tag of LIFE_EVENT_TAGS) {
    for (const node of findChildren(rec, tag)) {
      const place = findChild(node, 'PLAC')?.value || '';
      if (!place) continue; // no location recorded - nothing for a map to do with it
      const date = findChild(node, 'DATE')?.value || '';
      const key = `${date}|${place}`;
      if (seen.has(key)) continue; // same date+place already covered by birth/death/an earlier tag
      seen.add(key);
      events.push({ date, place });
    }
  }
  return events;
}

export function parseGedcom(text) {
  const lines = text.split(/\r\n|\r|\n/).map(parseLine).filter(Boolean);
  const records = buildRecordTree(lines);

  const indis = new Map();
  const fams = new Map();

  const readEvent = (node) => {
    if (!node) return { date: '', place: '' };
    return {
      date: findChild(node, 'DATE')?.value || '',
      place: findChild(node, 'PLAC')?.value || '',
    };
  };

  for (const rec of records) {
    if (rec.tag === 'INDI' && rec.xref) {
      const nameValue = findChild(rec, 'NAME')?.value || '';
      const name = nameValue.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
      const sexRaw = (findChild(rec, 'SEX')?.value || '').trim().toUpperCase();
      const birth = readEvent(findChild(rec, 'BIRT'));
      const death = readEvent(findChild(rec, 'DEAT'));
      indis.set(rec.xref, {
        name,
        sex: sexRaw === 'M' ? 'M' : sexRaw === 'F' ? 'F' : 'U',
        birth,
        death,
        lifeEvents: collectLifeEvents(rec, birth, death),
      });
    } else if (rec.tag === 'FAM' && rec.xref) {
      fams.set(rec.xref, {
        husb: stripAt(findChild(rec, 'HUSB')?.value) || null,
        wife: stripAt(findChild(rec, 'WIFE')?.value) || null,
        chil: findChildren(rec, 'CHIL').map((c) => stripAt(c.value)).filter(Boolean),
      });
    }
  }

  return { indis, fams };
}

export function importGedcomIntoTree(tree, gedcomText, { lineageId, addPerson, addUnion, setPersonEvent, addLifeEvent } = {}) {
  const { indis, fams } = parseGedcom(gedcomText);
  const idMap = new Map();

  for (const [gid, data] of indis) {
    const person = addPerson(tree, { name: data.name, sex: data.sex, lineageId });
    setPersonEvent(person, 'birth', { date: data.birth.date, place: data.birth.place });
    setPersonEvent(person, 'death', { date: data.death.date, place: data.death.place });
    for (const ev of data.lifeEvents) addLifeEvent(person, { date: ev.date, place: ev.place });
    idMap.set(gid, person.id);
  }

  let unionCount = 0;
  for (const fam of fams.values()) {
    const husbandId = fam.husb ? idMap.get(fam.husb) : null;
    const wifeId = fam.wife ? idMap.get(fam.wife) : null;
    const childIds = fam.chil.map((c) => idMap.get(c)).filter(Boolean);
    if (!husbandId && !wifeId && !childIds.length) continue;
    addUnion(tree, [husbandId || null, wifeId || null], childIds);
    unionCount++;
  }

  return { peopleImported: indis.size, unionsImported: unionCount };
}

// Walks backward only, from one chosen root, following each person's recorded parents
// (FAMC) as far as the file goes - never a person's siblings (other CHIL in the same
// family), never anyone's spouse other than the direct-line parent couple itself, and
// never descendants (FAMS is never followed). This is what "just the direct ancestor
// line, no other branches" means structurally: a GEDCOM export from a big shared tree
// carries everyone the submitter ever attached - in-laws, cousins, whole unrelated
// lines - and most of that isn't this app's business for a given paper trail.
export function collectAncestorChain(indis, fams, rootGedcomId) {
  const childToFamc = new Map();
  for (const [famId, fam] of fams) {
    for (const childId of fam.chil) childToFamc.set(childId, famId);
  }

  const keepIds = new Set();
  const keepFamIds = new Set();
  const queue = [rootGedcomId];
  while (queue.length) {
    const id = queue.shift();
    if (!id || keepIds.has(id) || !indis.has(id)) continue;
    keepIds.add(id);
    const famcId = childToFamc.get(id);
    if (!famcId) continue;
    const fam = fams.get(famcId);
    if (!fam) continue;
    keepFamIds.add(famcId);
    if (fam.husb) queue.push(fam.husb);
    if (fam.wife) queue.push(fam.wife);
  }
  return { keepIds, keepFamIds };
}

export function importGedcomAncestorsIntoTree(tree, gedcomText, { rootGedcomId, lineageId, addPerson, addUnion, setPersonEvent, addLifeEvent } = {}) {
  const { indis, fams } = parseGedcom(gedcomText);
  if (!indis.has(rootGedcomId)) throw new Error('That root person was not found in this file.');
  const { keepIds, keepFamIds } = collectAncestorChain(indis, fams, rootGedcomId);

  const idMap = new Map();
  for (const gid of keepIds) {
    const data = indis.get(gid);
    const person = addPerson(tree, { name: data.name, sex: data.sex, lineageId, isRoot: gid === rootGedcomId });
    setPersonEvent(person, 'birth', { date: data.birth.date, place: data.birth.place });
    setPersonEvent(person, 'death', { date: data.death.date, place: data.death.place });
    for (const ev of data.lifeEvents) addLifeEvent(person, { date: ev.date, place: ev.place });
    idMap.set(gid, person.id);
  }

  let unionCount = 0;
  for (const famId of keepFamIds) {
    const fam = fams.get(famId);
    const husbandId = fam.husb ? idMap.get(fam.husb) : null;
    const wifeId = fam.wife ? idMap.get(fam.wife) : null;
    const childIds = fam.chil.filter((c) => keepIds.has(c)).map((c) => idMap.get(c)).filter(Boolean);
    if (!husbandId && !wifeId && !childIds.length) continue;
    addUnion(tree, [husbandId || null, wifeId || null], childIds);
    unionCount++;
  }

  return { peopleImported: keepIds.size, unionsImported: unionCount, rootPersonId: idMap.get(rootGedcomId) };
}
