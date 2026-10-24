import type { Finding } from '@railwalker/core';
import { FINDING_LABELS, FINDING_PLAIN } from '../lib/labels';
import { Coin } from './coin';
import { Icon } from './icons';

/** Findings as a short list: a few words and an icon for how serious each is; the sentence behind each opens when asked for. */
export function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="finding-list">
      {findings.map((f, i) => (
        <li key={`${f.code}-${f.assetSymbol ?? ''}-${i}`}>
          <details className={`finding sev-${f.severity}`}>
            <summary>
              <span className="bar-ico">{f.severity === 'error' ? <Icon name="x" size={14} strokeWidth={2.6} /> : <b>!</b>}</span>
              <span className="finding-title">{FINDING_PLAIN[f.code]}</span>
              {f.assetSymbol ? <Coin symbol={f.assetSymbol} size={18} label /> : null}
              <Icon name="chevronDown" size={16} />
            </summary>
            <p>
              <b>{FINDING_LABELS[f.code]}.</b> {f.message}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
