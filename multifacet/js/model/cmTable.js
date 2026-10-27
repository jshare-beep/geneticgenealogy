// Shared cM Project relationship -> cM statistics table, keyed by the shorthand codes
// produced by relationships.js (relationshipToCmKey).
//
// Source: mean/SD/min/max extracted directly from DNA Painter's own Shared cM Project
// v4 tool (dnapainter.com/tools/sharedcmv4, popularized by Blaine Bettinger /
// thegeneticgenealogist.com, interactive version by Jonny Perl, CC 4.0 Attribution
// License) - i.e. the actual per-relationship submission statistics the tool itself
// uses, not a hand-derived approximation. Relationships too rare to have that
// underlying histogram data (very distant cousins/great-*-aunts, beyond what the tool
// tracks) are extrapolated from the confirmed entries instead, and marked
// `approx: true` so the UI can flag them and so they're easy to replace with exact
// figures later if DNA Painter adds coverage.

const range = (mean, sd, min, max, approx = false) => ({ mean, sd, min, max, approx });

export const CM_TABLE = {
  P: range(3485, 114, 2376, 4000),
  GP: range(1754, 236, 984, 2462),
  GGP: range(887, 181, 485, 1486),
  '2xGGP': range(437, 139, 139, 1000, true),
  '3xGGP': range(218, 90, 0, 536, true),
  '4xGGP': range(109, 60, 0, 268, true),

  S: range(2613, 203, 1613, 3488),
  AU: range(1741, 180, 1201, 2282),
  GAU: range(850, 118, 330, 1467),
  '2xGGAU': range(420, 121, 186, 713),
  '3xGGAU': range(211, 70, 0, 478, true),

  HS: range(1759, 207, 1160, 2436),
  HAU: range(871, 165, 492, 1315),
  HGAU: range(431, 105, 184, 668),
  H2xGGAU: range(208, 43, 103, 284),
  H3xGGAU: range(104, 35, 0, 200, true),

  '1C': range(866, 161, 396, 1397),
  '2C': range(229, 86, 41, 592),
  '3C': range(73, 43, 0, 234),
  '4C': range(35, 23, 0, 139),
  '5C': range(25, 18, 0, 117),
  '6C': range(18, 13, 0, 71),
  '7C': range(14, 9, 0, 57),
  '8C': range(11, 5, 0, 42),

  '1C1R': range(433, 123, 102, 980),
  '2C1R': range(122, 59, 14, 353),
  '3C1R': range(48, 32, 0, 192),
  '4C1R': range(28, 20, 0, 126),
  '5C1R': range(21, 15, 0, 80),
  '6C1R': range(15, 9, 0, 56),
  '7C1R': range(12, 7, 0, 50),

  '1C2R': range(221, 83, 33, 471),
  '2C2R': range(71, 42, 0, 244),
  '3C2R': range(36, 27, 0, 166),
  '4C2R': range(22, 16, 0, 93),
  '5C2R': range(18, 12, 0, 65),
  '6C2R': range(13, 8, 0, 45),

  '1C3R': range(117, 48, 25, 238),
  '2C3R': range(51, 32, 0, 154),
  '3C3R': range(27, 19, 0, 98),
  '4C3R': range(19, 12, 0, 60),
  '5C3R': range(13, 7, 0, 30),

  H1C: range(449, 134, 156, 979),
  H2C: range(120, 62, 10, 325),
  H3C: range(48, 33, 0, 168),
  H4C: range(24, 17, 0, 100, true),
  H5C: range(18, 13, 0, 80, true),

  H1C1R: range(224, 80, 62, 469),
  H2C1R: range(66, 39, 0, 190),
  H3C1R: range(37, 24, 0, 139, true),
  H4C1R: range(20, 14, 0, 90, true),

  H1C2R: range(125, 54, 16, 269),
  H2C2R: range(48, 32, 0, 144),
  H3C2R: range(27, 15, 0, 78),

  H1C3R: range(60, 32, 0, 120),
  H2C3R: range(30, 20, 0, 120, true),
  // DNA Painter's own submissions round to mean=0/sd=0 here (too few samples to be
  // meaningful) - substituting an estimated spread rather than using degenerate stats.
  H3C3R: range(15, 12, 0, 50, true),
};

export const ATTRIBUTION =
  'cM statistics: Shared cM Project data, popularized by Blaine Bettinger ' +
  '(thegeneticgenealogist.com) and the DNA Painter interactive tool by Jonny Perl. ' +
  'CC 4.0 Attribution License.';

export function getRange(key) {
  return CM_TABLE[key] || null;
}
