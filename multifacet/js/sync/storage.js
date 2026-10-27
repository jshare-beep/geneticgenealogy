// localStorage draft autosave. Always active, regardless of whether cloud sync is
// configured, so nothing is ever lost to a closed tab.

const STORAGE_KEY = 'multifacet.draftTree.v1';
const DEBOUNCE_MS = 400;

let debounceTimer = null;

export function saveDraft(tree) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    } catch (err) {
      console.error('Failed to autosave draft to localStorage:', err);
    }
  }, DEBOUNCE_MS);
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load draft from localStorage:', err);
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}
