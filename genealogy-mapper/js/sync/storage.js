// localStorage draft autosave - always on regardless of cloud sync, so nothing is lost
// to a closed tab while typing.

const STORAGE_KEY = 'genealogyMapper.draftTree.v1';
const ONBOARDING_KEY = 'genealogyMapper.onboardingSeen.v1';
const DEBOUNCE_MS = 400;

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    // Storage full or unavailable - onboarding just reappears next visit, harmless.
  }
}

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
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to load draft from localStorage:', err);
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}
