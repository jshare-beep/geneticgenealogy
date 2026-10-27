import { el } from '../util/dom.js';

export function matchListItemEl(match, personName, opts) {
  const { onDelete } = opts;
  const node = el('div', { className: 'match-list-item' });
  node.appendChild(
    el('div', { className: 'match-list-main' }, [el('div', { className: 'match-list-name', text: personName })])
  );
  node.appendChild(el('div', { className: 'match-list-cm', text: `${match.cM} cM` }));
  node.appendChild(el('button', { className: 'node-btn node-btn-icon node-btn-danger', text: '✕', onClick: onDelete }));
  return node;
}
