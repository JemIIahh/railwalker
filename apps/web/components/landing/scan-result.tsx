'use client';

import type { CheckReport } from '@railwalker/scanner';
import { FINDING_LABELS, FINDING_PLAIN } from '../../lib/labels';
import { statusOf } from '../../lib/status';
import { Coin } from '../coin';
import { CopyButton } from '../copy-button';
import { Icon } from '../icons';
import { StatusBadge } from '../status-badge';
import { useWallet } from '../wallet/wallet-provider';

const ORDER = { AMBIGUOUS: 4, FAIL: 3, PASS_WITH_WARNINGS: 2, PASS: 1, SKIPPED: 0 } as const;

/** What a free check found, in plain words: how it did overall, what to fix and how, and what a paid test would add. */
export function ScanResult({ report, truncated }: { report: CheckReport; truncated: boolean }) {
  const wallet = useWallet();
  const overall = report.verdicts.reduce((worst, v) => (ORDER[v.kind] > ORDER[worst.kind] ? v : worst), report.verdicts[0] ?? { kind: 'SKIPPED' as const, basis: 'PREDICTED' as const, findings: [] });
  const status = statusOf(overall.kind, overall.basis);
  const issues = report.findings.filter((f) => f.severity !== 'info');
  const notes = new Set(report.findings.filter((f) => f.severity === 'info').map((f) => f.code)).size;
  let where = report.endpoint.url;
  try {
    const u = new URL(report.endpoint.url);
    where = u.host + u.pathname;
  } catch {
    /* shown as written */
  }

  return (
    <section className="result" aria-label="Result of the check">
      <header className="result-head">
        <StatusBadge verdict={overall.kind} basis={overall.basis} big />
        <div className="result-who">
          <p className="result-sentence">{status.sentence}</p>
          <p className="result-url mono" title={report.endpoint.url}>
            {report.endpoint.method} {where}
          </p>
        </div>
        <CopyButton text={report.endpoint.url} label="Copy link" />
      </header>

      {report.verdicts.some((v) => v.assetSymbol) ? (
        <ul className="token-results" aria-label="By token">
          {report.verdicts.map((v, i) =>
            v.assetSymbol ? (
              <li key={`${v.assetSymbol}-${i}`} className={`token-result tone-${statusOf(v.kind, v.basis).tone}`}>
                <Coin symbol={v.assetSymbol} size={26} label />
                <span>{v.assetSymbol}</span>
                <span className="token-state">{statusOf(v.kind, v.basis).word}</span>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}

      {issues.length === 0 ? (
        <p className="result-clean">
          <Icon name="sparkle" size={18} /> We found nothing to fix.
        </p>
      ) : (
        <ul className="finds">
          {issues.map((f, i) => (
            <li key={`${f.code}-${f.assetSymbol ?? ''}-${i}`}>
              <details className={`find sev-${f.severity}`}>
                <summary>
                  <span className="find-ico">{f.severity === 'error' ? <Icon name="x" size={15} strokeWidth={2.8} /> : <Icon name="alert" size={16} strokeWidth={2.4} />}</span>
                  <span className="find-title">{FINDING_PLAIN[f.code]}</span>
                  {f.assetSymbol ? <Coin symbol={f.assetSymbol} size={20} label /> : null}
                  <Icon name="chevronDown" size={18} />
                </summary>
                <p>
                  <b>{FINDING_LABELS[f.code]}.</b> {f.message}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {notes > 0 ? (
        <p className="muted result-notes">
          Plus {notes} small {notes === 1 ? 'note' : 'notes'} for information.
        </p>
      ) : null}

      {report.patches.length > 0 ? (
        <div className="fixes">
          <h3 className="h3">How to fix it</h3>
          {report.patches.map((p) => (
            <details key={`${p.code}-${p.title}`} className="fix">
              <summary>
                <span className="find-ico fix-ico">
                  <Icon name="bolt" size={15} />
                </span>
                <span className="find-title">{p.title}</span>
                <Icon name="chevronDown" size={18} />
              </summary>
              <p>{p.why}</p>
              <div className="code-box">
                <pre>{p.after}</pre>
                <CopyButton text={p.after} label="Copy fix" />
              </div>
            </details>
          ))}
        </div>
      ) : null}
      {truncated ? <p className="muted result-notes">The report was large, so the seller’s own data was left out.</p> : null}

      <footer className="result-next">
        <div>
          <strong>This was a quick look.</strong>
          <span>A paid test sends a real payment and checks what comes back.</span>
        </div>
        <button type="button" className="btn btn-yellow" onClick={wallet.status === 'connected' ? undefined : wallet.openConnect} disabled={wallet.status === 'connected'}>
          <Icon name="wallet" size={20} />
          {wallet.status === 'connected' ? 'Paid tests open soon' : 'Connect wallet for a paid test'}
        </button>
      </footer>
    </section>
  );
}
