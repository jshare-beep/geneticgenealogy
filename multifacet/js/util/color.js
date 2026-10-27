// Interpolates between a pale tint and the full accent plum based on a 0-1 strength
// value (see scoring.js `strength`) - used to visually rank possibilities by how
// strong their evidence is, from the same colors/render code in both the tree canvas
// and the sidebar, without hand-picking a discrete color per rank.

const LIGHT = { r: 246, g: 232, b: 242 }; // pale tint of the accent plum
const DARK = { r: 142, g: 69, b: 133 }; // #8e4585, the accent plum itself

export function strengthToPlum(strength) {
  const t = Math.max(0, Math.min(1, strength ?? 0));
  const r = Math.round(LIGHT.r + (DARK.r - LIGHT.r) * t);
  const g = Math.round(LIGHT.g + (DARK.g - LIGHT.g) * t);
  const b = Math.round(LIGHT.b + (DARK.b - LIGHT.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}
