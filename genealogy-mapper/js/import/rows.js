// Shared importer for both the CSV upload and the bulk-paste grid, since after mapping
// they produce the exact same shape: one row per person, with plain-text father/mother
// IDs that are only meaningful *within this import batch* (not this app's own person
// ids) linking children to parents. That local-id indirection is what makes it possible
// to paste "row 7's father is row 3" straight out of a spreadsheet without the user
// ever seeing or caring about this app's internal ids.
//
// Row shape: { localId, name, sex, birthDate, birthPlace, deathDate, deathPlace,
//              fatherId, motherId, notes }

export function importRowsIntoTree(tree, rows, { lineageId, addPerson, addUnion, setPersonEvent } = {}) {
  const idMap = new Map(); // local row id (string) -> this app's person id
  const persons = [];

  for (const row of rows) {
    const hasContent = row.name || row.birthPlace || row.deathPlace || row.birthDate || row.deathDate;
    if (!hasContent) continue;
    const person = addPerson(tree, { name: row.name || '', sex: normalizeSex(row.sex), lineageId });
    setPersonEvent(person, 'birth', { date: row.birthDate || '', place: row.birthPlace || '' });
    setPersonEvent(person, 'death', { date: row.deathDate || '', place: row.deathPlace || '' });
    person.notes = row.notes || '';
    persons.push(person);
    if (row.localId != null && String(row.localId).trim() !== '') {
      idMap.set(String(row.localId).trim(), person.id);
    }
  }

  const unionByParents = new Map(); // "fatherPersonId|motherPersonId" -> unionId
  let linked = 0;

  for (const row of rows) {
    const localId = row.localId != null ? String(row.localId).trim() : '';
    const childId = localId ? idMap.get(localId) : null;
    if (!childId) continue;
    const fatherId = row.fatherId ? idMap.get(String(row.fatherId).trim()) : null;
    const motherId = row.motherId ? idMap.get(String(row.motherId).trim()) : null;
    if (!fatherId && !motherId) continue;

    const key = `${fatherId || ''}|${motherId || ''}`;
    let unionId = unionByParents.get(key);
    if (!unionId) {
      unionId = addUnion(tree, [fatherId || null, motherId || null], []).id;
      unionByParents.set(key, unionId);
    }
    if (!tree.unions[unionId].childIds.includes(childId)) {
      tree.unions[unionId].childIds.push(childId);
      linked++;
    }
  }

  return { peopleImported: persons.length, relationshipsLinked: linked };
}

function normalizeSex(value) {
  const s = String(value || '').trim().toUpperCase();
  if (s.startsWith('M')) return 'M';
  if (s.startsWith('F')) return 'F';
  return 'U';
}

export const ROW_FIELDS = [
  { key: 'localId', label: 'Row ID' },
  { key: 'name', label: 'Name' },
  { key: 'sex', label: 'Sex' },
  { key: 'birthDate', label: 'Birth date' },
  { key: 'birthPlace', label: 'Birth place' },
  { key: 'deathDate', label: 'Death date' },
  { key: 'deathPlace', label: 'Death place' },
  { key: 'fatherId', label: "Father's row ID" },
  { key: 'motherId', label: "Mother's row ID" },
  { key: 'notes', label: 'Notes' },
];
