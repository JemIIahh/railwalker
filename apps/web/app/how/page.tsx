import { DEFAULT_POLICY } from '@railwalker/core';
import type { VerdictKind } from '@railwalker/core';
import { CopyButton } from '../../components/copy-button';
import { Icon, type IconName } from '../../components/icons';
import { Stamp } from '../../components/stamp';
import { VERDICT_LABELS } from '../../lib/labels';
import { formatUsd, formatUsdShort } from '../../lib/view-models';

export const metadata = { title: 'How it works' };

const KINDS: VerdictKind[] = ['PASS', 'PASS_WITH_WARNINGS', 'FAIL', 'AMBIGUOUS', 'SKIPPED'];

export default function How() {
  const p = DEFAULT_POLICY;
  const safety: { icon: IconName; title: string; note: string }[] = [
    { icon: 'wallet', title: formatUsd(p.reserveUsd), note: 'wallet floor, never below' },
    { icon: 'eye', title: 'Reads only', note: 'nothing that acts in the world' },
    { icon: 'coins', title: `${p.unsolicitedMaxSettlementsPerSeller} payments`, note: 'at most, per registered seller' },
    { icon: 'tag', title: formatUsdShort(p.unsolicitedMinPriceUsd), note: 'cheapest price we will pay' },
    { icon: 'lock', title: 'Private is refused', note: 'local, internal and credentialed addresses' },
    { icon: 'shield', title: 'Sandbox is skipped', note: 'testnet entries are never paid' },
  ];
  return (
    <div className="container section-tight page">
      <header className="page-head">
        <h1 className="page-title">How it works</h1>
      </header>

      <section className="section-block" aria-labelledby="two">
        <h2 id="two" className="h2">
          Two checks
        </h2>
        <div className="split">
          <article className="mode card">
            <div className="mode-top">
              <span className="mode-ico">
                <Icon name="eye" size={24} />
              </span>
              <Stamp verdict="PASS" basis="PREDICTED" />
            </div>
            <h3>Free scan</h3>
            <ul>
              <li>
                <Icon name="arrowRight" size={16} /> One unpaid request
              </li>
              <li>
                <Icon name="tag" size={16} /> Reads the price tag
              </li>
              <li>
                <Icon name="checklist" size={16} /> Predicts what a buyer hits
              </li>
            </ul>
          </article>
          <article className="mode card">
            <div className="mode-top">
              <span className="mode-ico">
                <Icon name="coins" size={24} />
              </span>
              <Stamp verdict="PASS" basis="CONFIRMED" />
            </div>
            <h3>Paid check</h3>
            <ul>
              <li>
                <Icon name="coins" size={16} /> Pays a few cents
              </li>
              <li>
                <Icon name="box" size={16} /> Checks what came back
              </li>
              <li>
                <Icon name="link" size={16} /> Proves it on chain
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section className="section-block" aria-labelledby="five">
        <h2 id="five" className="h2">
          Five verdicts
        </h2>
        <div className="stamps">
          {KINDS.map((kind) => (
            <div key={kind} className="stamp-card card">
              <Stamp verdict={kind} basis="CONFIRMED" large />
              <p>{VERDICT_LABELS[kind]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block" aria-labelledby="safe">
        <h2 id="safe" className="h2">
          Safety rails
        </h2>
        <ul className="safety">
          {safety.map((s) => (
            <li key={s.title} className="safe card">
              <span className="ico">
                <Icon name={s.icon} size={20} />
              </span>
              <div>
                <strong>{s.title}</strong>
                <span>{s.note}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section-block" aria-labelledby="out">
        <h2 id="out" className="h2">
          Opt out
        </h2>
        <p className="opt-row">
          <span className="code-chip">/.well-known/railwalker-optout</span>
          <CopyButton text="/.well-known/railwalker-optout" label="Copy path" />
        </p>
      </section>
    </div>
  );
}
