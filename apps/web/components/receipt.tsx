import { assetByAddress } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { explorerTxUrl, formatPaid, shortHash } from '../lib/view-models';
import { walkVerdict } from '../lib/walk';
import { Address } from './address';
import { Coin } from './coin';
import { Icon } from './icons';
import { Stamp } from './stamp';

/**
 * What the payment left behind: the amount, who got it, and the transaction that proves it, with the verdict stamped on at the
 * end. A run that paid nothing gets an empty slip instead, so it is plain that the verdicts are only predictions.
 */
export function Receipt({ run, shown, stamped }: { run: RunRecord; shown: boolean; stamped: boolean }) {
  const verdict = walkVerdict(run);
  const pay = run.payments[0];

  if (pay === undefined) {
    return (
      <aside className="receipt none" aria-label="Receipt">
        <span className="rc-ico">
          <Icon name="receipt" size={22} />
        </span>
        <p className="rc-none">No payment</p>
        <p className="rc-sub">Predicted only</p>
        {verdict ? <Stamp verdict={verdict.kind} basis={verdict.basis} /> : null}
      </aside>
    );
  }

  const symbol = assetByAddress(pay.asset)?.symbol;
  const href = pay.txHash === undefined ? null : explorerTxUrl(pay.txHash);
  const settled = run.steps.find((s) => s.stage === 'settle');
  return (
    <aside className="receipt" data-shown={shown ? '' : undefined} aria-label="Receipt" aria-hidden={shown ? undefined : true}>
      <div className="rc-top">
        {symbol ? <Coin symbol={symbol} size={40} label /> : <span className="coin-blank">·</span>}
        <div>
          <div className="rc-amt mono">{formatPaid(pay.asset, pay.amountAtomic)}</div>
          <div className="rc-sub">{symbol ?? 'token'} · Celo</div>
        </div>
      </div>
      <dl className="rc-rows">
        <div>
          <dt>To</dt>
          <dd>
            <Address value={pay.payTo} />
          </dd>
        </div>
        <div>
          <dt>Proof</dt>
          <dd>
            {pay.txHash === undefined ? (
              <span className="muted">not settled</span>
            ) : href ? (
              <a className="mono" href={href} rel="noreferrer noopener" target="_blank">
                {shortHash(pay.txHash)} <Icon name="arrowUpRight" size={13} />
              </a>
            ) : (
              <span className="mono muted">{shortHash(pay.txHash)}</span>
            )}
          </dd>
        </div>
        {settled ? (
          <div>
            <dt>Took</dt>
            <dd className="mono">{(settled.t / 1000).toFixed(1)} s</dd>
          </div>
        ) : null}
        {run.payments.length > 1 ? (
          <div>
            <dt>More</dt>
            <dd className="mono">+{run.payments.length - 1}</dd>
          </div>
        ) : null}
      </dl>
      <div className="rc-stamp">{stamped && verdict ? <Stamp verdict={verdict.kind} basis={verdict.basis} large tilt animate /> : <span className="rc-wait mono">…</span>}</div>
    </aside>
  );
}
