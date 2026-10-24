'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MapCell } from '@railwalker/data';
import { VERDICT_LABELS, shortLabel } from '../lib/labels';
import { NO_FILTER, filterView, isFiltering, toggleAsset, toggleBasis, type MapFilter } from '../lib/map-filter';
import { placePopover, type Box } from '../lib/popover';
import { timeAgo } from '../lib/time';
import { describeVerdict, splitRow, type MapView } from '../lib/view-models';
import { Coin } from './coin';
import { Icon } from './icons';
import { Stamp } from './stamp';

const GROUP_TITLE = { fixture: 'Our fixtures', buy: 'buy routes' } as const;
const GROUP_NOTE = { fixture: 'broken on purpose', buy: 'real services' } as const;

function Glyph({ verdict }: { verdict: MapCell['verdict'] }) {
  if (verdict === 'PASS') return <Icon name="check" size={18} strokeWidth={2.8} />;
  if (verdict === 'FAIL') return <Icon name="x" size={17} strokeWidth={2.8} />;
  return <b>{verdict === 'PASS_WITH_WARNINGS' ? '!' : verdict === 'AMBIGUOUS' ? '?' : '–'}</b>;
}

function explain(cell: MapCell): string {
  const what = cell.code ? shortLabel(cell.code) : VERDICT_LABELS[cell.verdict];
  const how = cell.basis === 'CONFIRMED' ? 'confirmed with a real payment' : 'predicted, nothing paid';
  return `${cell.row}, ${cell.asset}: ${describeVerdict(cell)}. ${what}. ${how}.`;
}

/** What a cell says when it is pointed at: the token, the stamp, a few words on why, and how long ago. Kept on screen whatever the scroll. */
function CellTip({ cell, box }: { cell: MapCell; box: Box }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number; side: 'above' | 'below' } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    setAt(placePopover(box, { width, height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [box]);
  const { dir, leaf } = splitRow(cell.row);
  return (
    <div ref={ref} className="tip" role="tooltip" data-side={at?.side} style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }}>
      <div className="tip-top">
        <Coin symbol={cell.asset} size={30} />
        <div className="tip-who">
          <strong>{cell.asset}</strong>
          <span>{cell.group === 'fixture' ? 'Our fixture' : 'buy route'}</span>
        </div>
        <Stamp verdict={cell.verdict} basis={cell.basis} />
      </div>
      <div className="tip-row mono">
        <span className="muted">{dir}</span>
        {leaf}
      </div>
      <div className="tip-why">{cell.code ? shortLabel(cell.code) : VERDICT_LABELS[cell.verdict]}</div>
      <div className="tip-foot">
        <span>
          <Icon name="clock" size={14} /> {timeAgo(cell.at, new Date())}
        </span>
        <span className="tip-go">
          Replay <Icon name="arrowRight" size={14} />
        </span>
      </div>
    </div>
  );
}

/**
 * The reality map: a row for each of our endpoints, a column for each token, one cell where they meet. Tokens and the kind of
 * result can be picked to narrow it, a cell says more when it is pointed at, and a click replays the run behind it.
 */
export function ReachMap({ view }: { view: MapView }) {
  const [filter, setFilter] = useState<MapFilter>(NO_FILTER);
  const [tip, setTip] = useState<{ cell: MapCell; box: Box } | null>(null);
  const shown = useMemo(() => filterView(view, filter), [view, filter]);

  useEffect(() => {
    if (tip === null) return;
    const off = () => setTip(null);
    window.addEventListener('scroll', off, { passive: true, capture: true });
    window.addEventListener('resize', off);
    return () => {
      window.removeEventListener('scroll', off, { capture: true });
      window.removeEventListener('resize', off);
    };
  }, [tip]);

  if (view.groups.length === 0) {
    return (
      <div className="empty">
        <span className="ico">
          <Icon name="coins" size={22} />
        </span>
        <p>No payments yet</p>
      </div>
    );
  }

  const point = (cell: MapCell, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ cell, box: { left: r.left, top: r.top, width: r.width, height: r.height } });
  };

  return (
    <section className="card map-card" aria-label="Reality map">
      <header className="map-head">
        <span className="map-count mono" aria-live="polite">
          {isFiltering(filter) ? `${shown.shown} of ${shown.total}` : shown.total} endpoints
        </span>
        <div className="map-filters">
          <div className="chips" role="group" aria-label="Tokens">
            {view.assets.map((asset) => (
              <button key={asset} type="button" className="chip" aria-pressed={filter.assets.includes(asset)} onClick={() => setFilter((f) => toggleAsset(f, asset))}>
                <Coin symbol={asset} size={20} />
                {asset}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Kind of result">
            <button type="button" className="chip chip-plain" aria-pressed={filter.basis === 'CONFIRMED'} onClick={() => setFilter((f) => toggleBasis(f, 'CONFIRMED'))}>
              <i className="swatch solid" /> Confirmed
            </button>
            <button type="button" className="chip chip-plain" aria-pressed={filter.basis === 'PREDICTED'} onClick={() => setFilter((f) => toggleBasis(f, 'PREDICTED'))}>
              <i className="swatch hatched" /> Predicted
            </button>
          </div>
        </div>
      </header>

      {shown.groups.length === 0 ? (
        <div className="map-none">
          <p>Nothing matches</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_FILTER)}>
            <Icon name="replay" size={16} /> Reset
          </button>
        </div>
      ) : (
        <div className="map-scroll">
          <table className="map" style={{ '--cols': shown.assets.length } as CSSProperties}>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Endpoint</span>
                </th>
                {shown.assets.map((asset) => (
                  <th scope="col" key={asset}>
                    <span className="col-head">
                      <Coin symbol={asset} size={22} />
                      {asset}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {shown.groups.map((g) => (
              <tbody key={g.group}>
                <tr className="group">
                  <th colSpan={shown.assets.length + 1} scope="colgroup">
                    <span className="group-name">{GROUP_TITLE[g.group]}</span>
                    <span className="pill pill-line">{g.rows.length}</span>
                    <span className="group-note">{GROUP_NOTE[g.group]}</span>
                  </th>
                </tr>
                {g.rows.map((row) => {
                  const { dir, leaf } = splitRow(row.label);
                  return (
                    <tr key={row.label}>
                      <th scope="row" className="rowname mono" title={row.label}>
                        <span className="rn">
                          <span className="rt">
                            <span className="muted">{dir}</span>
                            {leaf}
                          </span>
                          <i className="leader" aria-hidden="true" />
                        </span>
                      </th>
                      {shown.assets.map((asset) => {
                        const cell = row.cells[asset];
                        return (
                          <td key={asset} data-asset={asset}>
                            {cell ? (
                              <Link
                                className={`cell v-${cell.verdict.toLowerCase()} ${cell.basis === 'CONFIRMED' ? 'confirmed' : 'predicted'}`}
                                href={`/run/${cell.runId}`}
                                aria-label={explain(cell)}
                                onPointerEnter={(e) => e.pointerType === 'mouse' && point(cell, e.currentTarget)}
                                onPointerLeave={() => setTip(null)}
                                onFocus={(e) => point(cell, e.currentTarget)}
                                onBlur={() => setTip(null)}
                              >
                                <Glyph verdict={cell.verdict} />
                              </Link>
                            ) : (
                              <span className="gap" aria-label="not tried">
                                ·
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <footer className="map-foot">
        <span className="hint">
          <Icon name="cursor" size={14} /> Point for detail, click to replay
        </span>
        <ul className="keys" aria-label="Marks">
          <li>
            <b className="k-pass">✓</b> pass
          </li>
          <li>
            <b className="k-warn">!</b> warn
          </li>
          <li>
            <b className="k-fail">✕</b> fail
          </li>
          <li>
            <b className="k-odd">?</b> unsure
          </li>
        </ul>
      </footer>
      {tip ? <CellTip cell={tip.cell} box={tip.box} /> : null}
    </section>
  );
}
