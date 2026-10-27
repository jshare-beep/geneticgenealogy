// Scoring engine: for each Possibility, combine the likelihood of every DNA Match's cM
// value across ALL branches/facets of the pedigree graph into one score, extending the
// usual single-line combined-probability approach to a bigger, multi-branch graph. Also
// produces a per-facet (per branch) sub-score breakdown.

import {
  ancestorDepthsForPerson,
  findCommonAncestors,
  classifyRelationship,
  relationshipToCmKey,
  relationshipLabel,
  computeFacetPath,
} from '../model/relationships.js';
import { getRange } from '../model/cmTable.js';

export function normalPdf(x, mean, sd) {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

// Score a single (possibility, match) pair.
// status: 'ok' | 'infeasible' | 'not-connected' | 'unmodeled'
//   ok           - cM falls within the implied relationship's range; density computed
//   infeasible   - cM falls outside the range; this match rules the possibility out
//   not-connected - the match's branch hasn't been linked to this possibility yet in
//                   the tree; excluded from scoring, not treated as infeasible
//   unmodeled    - relationship is more distant than anything in the cM table;
//                  non-eliminating, contributes no density
export function scoreMatch(possibility, match, tree, indices) {
  const depthsPoss = ancestorDepthsForPerson(possibility.personId, indices, tree);
  const depthsMatch = ancestorDepthsForPerson(match.personId, indices, tree);
  const common = findCommonAncestors(depthsPoss, depthsMatch);
  if (!common) return { status: 'not-connected', matchId: match.id };

  const relationship = classifyRelationship(common, tree);
  const key = relationshipToCmKey(relationship);
  const cmRange = getRange(key);
  const facetPath = computeFacetPath(possibility.personId, match.personId, indices, tree);
  const label = relationshipLabel(relationship);

  if (!cmRange) {
    return { status: 'unmodeled', matchId: match.id, key, relationship, label, facetPath };
  }

  const feasible = match.cM >= cmRange.min && match.cM <= cmRange.max;
  if (!feasible) {
    return { status: 'infeasible', matchId: match.id, key, relationship, label, range: cmRange, facetPath };
  }

  const sd = Math.max(cmRange.sd, 1e-6);
  const density = normalPdf(match.cM, cmRange.mean, sd);
  // How well this one match's cM fits the relationship, as a 0-1 share of the best
  // possible fit (the density right at the mean) - lets a single match be ranked and
  // compared on its own, independent of how many other matches a possibility has.
  const peakDensity = normalPdf(cmRange.mean, cmRange.mean, sd);
  const fitRatio = density / peakDensity;
  return { status: 'ok', matchId: match.id, key, relationship, label, range: cmRange, density, fitRatio, facetPath };
}

export function scorePossibility(possibility, matches, tree, indices) {
  const perMatch = matches.map((match) => ({ match, result: scoreMatch(possibility, match, tree, indices) }));

  const infeasible = perMatch.filter((r) => r.result.status === 'infeasible');
  // Best-fitting match first, so "list the probability of each match" reads in order.
  const ok = perMatch.filter((r) => r.result.status === 'ok').sort((a, b) => b.result.fitRatio - a.result.fitRatio);
  const notConnected = perMatch.filter((r) => r.result.status === 'not-connected');
  const unmodeled = perMatch.filter((r) => r.result.status === 'unmodeled');

  // Log-space accumulation avoids underflow when many matches contribute.
  const logScore = infeasible.length ? -Infinity : ok.reduce((sum, r) => sum + Math.log(r.result.density), 0);

  const facetsByPartner = new Map();
  for (const r of ok) {
    const topFacet = r.result.facetPath[0];
    const facetKey = topFacet?.partnerId ?? 'unassigned';
    const facetName = topFacet?.name || 'Unassigned branch';
    if (!facetsByPartner.has(facetKey)) {
      facetsByPartner.set(facetKey, { partnerId: facetKey, name: facetName, entries: [], logScore: 0 });
    }
    const facet = facetsByPartner.get(facetKey);
    facet.entries.push(r);
    facet.logScore += Math.log(r.result.density);
  }

  return {
    possibility,
    logScore,
    infeasible,
    ok,
    notConnected,
    unmodeled,
    facets: [...facetsByPartner.values()],
    hasEvidence: infeasible.length + ok.length > 0,
  };
}

// Ranks all possibilities. Ruled-out ones always sort last (see the comparator below);
// among the rest, strongest first. Each result gets:
//   - ratioVsLowest: likelihood relative to the lowest still-viable possibility ("N
//     times more likely"), kept for the per-facet breakdown math.
//   - probability: a proper 0-1 probability via softmax over every possibility that
//     currently has evidence - these sum to 1, i.e. "if it's one of these positions,
//     here's the actual % chance it's this one."
//   - strength: where this possibility's score falls between the weakest and
//     strongest currently-evidenced one (0-1) - drives the color gradient; kept
//     separate from `probability` because probability's absolute scale shrinks as
//     more candidates compete, which would wrongly dim an obvious front-runner just
//     for having more rivals.
export function rankPossibilities(possibilities, matches, tree, indices) {
  const results = possibilities.map((h) => scorePossibility(h, matches, tree, indices));

  results.sort((a, b) => {
    const aOut = a.logScore === -Infinity;
    const bOut = b.logScore === -Infinity;
    if (aOut !== bOut) return aOut ? 1 : -1;
    if (aOut && bOut) return 0;
    return b.logScore - a.logScore;
  });

  const viable = results.filter((r) => r.logScore > -Infinity);
  const lowestViable = viable.length ? viable[viable.length - 1] : null;
  // Only possibilities with at least one connected match compete for "top viable" -
  // otherwise every possibility ties at logScore 0 and one would win by array order
  // alone, which reads as a confident answer when really nothing's been evaluated yet.
  const viableWithEvidence = viable.filter((r) => r.hasEvidence);

  const probabilityById = new Map();
  const strengthById = new Map();
  if (viableWithEvidence.length) {
    const logScores = viableWithEvidence.map((r) => r.logScore);
    const maxLog = Math.max(...logScores);
    const minLog = Math.min(...logScores);
    const logRange = maxLog - minLog;

    const weights = viableWithEvidence.map((r) => Math.exp(r.logScore - maxLog));
    const sumWeights = weights.reduce((sum, w) => sum + w, 0);

    viableWithEvidence.forEach((r, i) => {
      probabilityById.set(r.possibility.id, weights[i] / sumWeights);
      strengthById.set(r.possibility.id, logRange > 0 ? (r.logScore - minLog) / logRange : 1);
    });
  }

  return results.map((r) => ({
    ...r,
    ratioVsLowest:
      lowestViable && r.logScore > -Infinity && r.hasEvidence ? Math.exp(r.logScore - lowestViable.logScore) : null,
    isTopViable: viableWithEvidence.length > 0 && r === viableWithEvidence[0],
    probability: probabilityById.get(r.possibility.id) ?? null,
    strength: strengthById.get(r.possibility.id) ?? null,
  }));
}
