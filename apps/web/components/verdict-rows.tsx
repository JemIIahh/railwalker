import type { Verdict } from '@railwalker/core';
import { VERDICT_LABELS, shortLabel } from '../lib/labels';
import { Coin } from './coin';
import { Stamp } from './stamp';

/** One row for each verdict: the token's coin, the stamp, and a few words on why. */
export function VerdictRows({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <ul className="verdict-list">
      {verdicts.map((v, i) => (
        <li key={`${v.assetSymbol ?? 'endpoint'}-${i}`} className="verdict-row">
          {v.assetSymbol ? <Coin symbol={v.assetSymbol} size={28} label /> : <span className="coin-blank" aria-hidden="true">·</span>}
          <span className="verdict-who">{v.assetSymbol ?? 'Endpoint'}</span>
          <Stamp verdict={v.kind} basis={v.basis} />
          <span className="verdict-why">{v.code ? shortLabel(v.code) : VERDICT_LABELS[v.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
