'use client';

import { useMemo, useState } from 'react';
import { filterCards, sortCards, type CardFilter, type CardSort, type EndpointCard } from '../lib/endpoint-cards';
import { EndpointCardView } from './endpoint-card';
import { Icon } from './icons';

const FILTERS: { key: CardFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'works', label: 'Works' },
  { key: 'fix', label: 'Needs a fix' },
];
const SORTS: { key: CardSort; label: string }[] = [
  { key: 'recent', label: 'Newest' },
  { key: 'problems', label: 'Problems first' },
];

/** Every endpoint we tested, as cards. Pick what to see and in which order; a card opens the replay of its run. */
export function ExploreCards({ cards }: { cards: EndpointCard[] }) {
  const [filter, setFilter] = useState<CardFilter>('all');
  const [sort, setSort] = useState<CardSort>('recent');
  const shown = useMemo(() => sortCards(filterCards(cards, filter), sort), [cards, filter, sort]);
  const count = (key: CardFilter) => filterCards(cards, key).length;

  return (
    <div className="explore-cards">
      <div className="filter-row">
        <div className="chips" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="chip chip-plain" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="chip-n">{count(f.key)}</span>
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Order">
          {SORTS.map((s) => (
            <button key={s.key} type="button" className="chip chip-plain" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <span className="ico">
            <Icon name="search" size={22} />
          </span>
          <p>Nothing here yet</p>
        </div>
      ) : (
        <ul className="ep-grid" aria-live="polite">
          {shown.map((card) => (
            <li key={card.key}>
              <EndpointCardView card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
