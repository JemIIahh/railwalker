import type { LedgerService, LedgerSigner } from '@railwalker/data';
import { REASON_LABELS, REASON_SHORT } from '../lib/labels';
import { explorerTxUrl, formatUsd, shortHash } from '../lib/view-models';
import { Address } from './address';
import { Icon } from './icons';

/** What we bought and from whom, a card for each service, with the transactions that prove it. Our own fixtures are marked self. */
export function ServiceCards({ rows }: { rows: LedgerService[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <span className="ico">
          <Icon name="receipt" size={22} />
        </span>
        <p>No payments yet</p>
      </div>
    );
  }
  return (
    <ul className="service-grid">
      {rows.map((row) => {
        const self = row.name.startsWith('self');
        return (
          <li key={row.name} className="service card">
            <div className="service-top">
              <span className="service-name mono" title={row.name}>
                {row.name}
              </span>
              {self ? (
                <span className="pill self" title="Paid to one of our own wallets: neither spent nor earned">
                  self
                </span>
              ) : null}
            </div>
            <div className="service-nums">
              <span className={self ? 'service-usd mono muted' : 'service-usd mono'}>{formatUsd(row.usd)}</span>
              <span className="service-calls mono">
                {row.calls} {row.calls === 1 ? 'call' : 'calls'}
              </span>
            </div>
            <div className="proofs">
              {row.proofs.length === 0 ? <span className="muted">no settled transaction yet</span> : null}
              {row.proofs.slice(0, 12).map((hash) => {
                const href = explorerTxUrl(hash);
                return href ? (
                  <a key={hash} className="proof mono" href={href} rel="noreferrer noopener" target="_blank">
                    <Icon name="link" size={12} /> {shortHash(hash)}
                  </a>
                ) : null;
              })}
              {row.proofs.length > 12 ? <span className="muted">+{row.proofs.length - 12} more</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Everyone who paid us, and whether the hackathon's rule counts them: a few words each, the full reason on hover. */
export function SignerRows({ rows }: { rows: LedgerSigner[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <span className="ico">
          <Icon name="wallet" size={22} />
        </span>
        <p>Nobody outside our own wallets has paid us</p>
      </div>
    );
  }
  return (
    <ul className="signers card card-pad-0">
      {rows.map((row) => (
        <li key={row.address} className="signer" title={REASON_LABELS[row.reason]}>
          <span className={row.counted ? 'signer-mark yes' : 'signer-mark no'} aria-hidden="true">
            <Icon name={row.counted ? 'check' : 'x'} size={14} strokeWidth={2.8} />
          </span>
          <Address value={row.address} />
          <span className={row.counted ? 'pill counted' : 'pill pill-line'}>{row.counted ? 'counted' : 'not counted'}</span>
          <span className="signer-why">{row.counted ? '' : REASON_SHORT[row.reason]}</span>
          <span className="sr-only">{REASON_LABELS[row.reason]}</span>
        </li>
      ))}
    </ul>
  );
}
