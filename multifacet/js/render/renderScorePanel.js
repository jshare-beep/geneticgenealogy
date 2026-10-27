import { el, clear } from '../util/dom.js';
import { matchListItemEl } from './nodeTemplates.js';
import { strengthToPlum } from '../util/color.js';

export function renderScorePanel(container, rankedResults, tree) {
  clear(container);

  if (!rankedResults.length) {
    container.appendChild(
      el('p', {
        className: 'empty-state',
        text: 'Open a person\'s menu and choose "Designate as possibility" to see rankings here.',
      })
    );
    return;
  }

  for (const result of rankedResults) {
    const eliminated = result.logScore === -Infinity;
    const classes = ['result-card'];
    if (result.isTopViable) classes.push('is-top');
    if (eliminated) classes.push('is-eliminated');

    const personName = tree.people[result.possibility.personId]?.name || '';
    const card = el('div', {
      className: classes.join(' '),
      // Strongest possibilities get the darkest border, weaker ones a paler tint of
      // the same hue - ruled-out ones keep their own fixed color (see .is-eliminated).
      attrs: eliminated ? {} : { style: `border-color: ${strengthToPlum(result.strength)}` },
    });
    card.appendChild(
      el('div', {
        className: 'result-title',
        text: `Possibility #${result.possibility.number ?? '?'}${personName ? ` — ${personName}` : ''}`,
      })
    );

    const scoreText = eliminated
      ? 'Not statistically feasible'
      : !result.hasEvidence
      ? 'No DNA matches connected to this position yet'
      : result.probability != null
      ? `${Math.round(result.probability * 100)}% probability`
      : 'No evidence connected yet';
    card.appendChild(el('div', { className: 'result-score', text: scoreText }));

    const connectedEntries = [...result.ok, ...result.infeasible];
    if (connectedEntries.length) {
      // Count distinct branches by the deepest connecting ancestor reached, not just
      // the possibility's immediate parent - two matches can both route through the
      // same immediate parent (e.g. the other parent has no ancestry entered yet) while
      // still coming from genuinely independent lines further up (that parent's father
      // vs. that parent's mother's family).
      const branchNames = new Set(
        connectedEntries.map((r) => {
          const path = r.result.facetPath;
          return path[path.length - 1]?.name || 'Unassigned branch';
        })
      );
      card.appendChild(
        el('div', {
          className: 'result-coverage',
          text: `Combines ${connectedEntries.length} match(es) across ${branchNames.size} branch(es)`,
        })
      );
    }

    if (result.ok.length) {
      // Already sorted best-fit first (see scoring.js) - listing them in that order
      // is the point, not just showing the set.
      card.appendChild(el('div', { className: 'result-facets-title', text: 'Matches, by fit' }));
      const list = el('ul', { className: 'result-detail-list' });
      for (const r of result.ok) {
        list.appendChild(
          el('li', {
            text: `${r.match.cM} cM as ${r.result.label} — ${Math.round(r.result.fitRatio * 100)}% fit`,
          })
        );
      }
      card.appendChild(list);
    }

    if (result.infeasible.length) {
      const list = el('ul', { className: 'result-detail-list' });
      for (const r of result.infeasible) {
        list.appendChild(
          el('li', {
            text: `${r.match.cM} cM doesn't fit as ${r.result.label} — expected ${r.result.range.min}–${r.result.range.max} cM`,
          })
        );
      }
      card.appendChild(list);
    }

    if (result.facets.length) {
      const facetsEl = el('div', { className: 'result-facets' });
      facetsEl.appendChild(el('div', { className: 'result-facets-title', text: 'Per-facet breakdown' }));
      for (const facet of result.facets) {
        facetsEl.appendChild(
          el('div', {
            className: 'facet-row',
            text: `${facet.name || 'Unassigned branch'} — ${facet.entries.length} match(es), log-score ${facet.logScore.toFixed(2)}`,
          })
        );
      }
      card.appendChild(facetsEl);
    }

    if (result.notConnected.length) {
      card.appendChild(
        el('div', {
          className: 'result-note',
          text: `${result.notConnected.length} match(es) not yet connected to this possibility — extend the tree to use them.`,
        })
      );
    }

    if (result.unmodeled.length) {
      card.appendChild(
        el('div', {
          className: 'result-note',
          text: `${result.unmodeled.length} match(es) too distantly related to be informative.`,
        })
      );
    }

    container.appendChild(card);
  }
}

export function renderMatchesList(container, tree, actions) {
  clear(container);
  const matches = Object.values(tree.matches);
  if (!matches.length) {
    container.appendChild(
      el('p', { className: 'empty-state', text: 'No DNA matches yet. Click ✎ on a person to add one.' })
    );
    return;
  }
  for (const match of matches) {
    const person = tree.people[match.personId];
    container.appendChild(
      matchListItemEl(match, person?.name || '(unknown)', { onDelete: () => actions.onDeleteMatch(match.id) })
    );
  }
}

// Lists each designated branch by its lead individual - clicking either this item or
// that person's card on the tree does the same thing (see main.js toggleBranchFocus):
// jumps into viewing just that branch, with whatever matches/possibilities live there.
// The founding person/couple is branch #1 like any other (see the addFoundingCoupleBtn
// / addFoundingPersonBtn handlers in main.js) - there's no separate synthetic "main"
// entry, since a branch created off of, say, a spouse of that founder's child is no
// more or less "the" branch than the founder's own.
export function renderBranchesList(container, tree, { onSelectBranch, focusPersonId }) {
  clear(container);
  const branches = Object.values(tree.branches);
  if (!branches.length) {
    container.appendChild(
      el('p', {
        className: 'empty-state',
        text: 'Open a person\'s menu and choose "Add spouse / New branch" to see branches here.',
      })
    );
    return;
  }
  for (const branch of branches) {
    const person = tree.people[branch.personId];
    if (!person) continue;
    const isActive = focusPersonId === branch.personId;
    const item = el('button', {
      className: `branch-list-item${isActive ? ' is-active' : ''}`,
      attrs: { type: 'button', style: `border-color: ${branch.color}` },
      onClick: () => onSelectBranch(branch.personId),
    });
    item.appendChild(el('span', { className: 'branch-list-dot', attrs: { style: `background: ${branch.color}` } }));
    item.appendChild(
      el('span', { className: 'branch-list-main' }, [
        el('span', { className: 'branch-list-name', text: person.name || '(unnamed)' }),
        el('span', { className: 'branch-list-hint', text: isActive ? 'Viewing this branch' : 'View this branch →' }),
      ])
    );
    container.appendChild(item);
  }
}
