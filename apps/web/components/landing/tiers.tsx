'use client';

import { formatUsdShort } from '../../lib/view-models';
import { Icon, type IconName } from '../icons';
import { useWallet } from '../wallet/wallet-provider';

const PAID_OPEN = process.env.NEXT_PUBLIC_PAID_CHECKS === '1';

const TIERS: { name: string; usd: number; tint: string; icon: IconName; lines: string[]; featured?: boolean }[] = [
  { name: 'Free check', usd: 0, tint: 'tint-mint', icon: 'eye', lines: ['Reads the price and the rules', 'In a few seconds', 'No wallet needed'] },
  { name: 'Quick test', usd: 0.02, tint: 'tint-butter', icon: 'coins', featured: true, lines: ['One real payment', 'Checks what comes back', 'A receipt you can verify'] },
  { name: 'Full test', usd: 0.25, tint: 'tint-sky', icon: 'sparkle', lines: ['Every token it accepts', 'Three tries each', 'Fresh wallets included'] },
];

/** What each kind of check costs and does. The paid ones ask for a wallet; the free one is a scroll back to the box. */
export function Tiers() {
  const wallet = useWallet();
  return (
    <div className="tiers">
      {TIERS.map((t) => (
        <article key={t.name} className={`tier card ${t.tint}${t.featured ? ' tier-featured' : ''}`}>
          {t.featured ? <span className="tier-flag">Most popular</span> : null}
          <span className="tier-ico">
            <Icon name={t.icon} size={24} />
          </span>
          <h3 className="h3">{t.name}</h3>
          <p className="tier-usd">{t.usd === 0 ? 'Free' : formatUsdShort(t.usd)}</p>
          <ul className="tier-lines">
            {t.lines.map((l) => (
              <li key={l}>
                <Icon name="check" size={18} strokeWidth={2.6} /> {l}
              </li>
            ))}
          </ul>
          {t.usd === 0 ? (
            <a className="btn btn-ghost" href="#top">
              Check a link
            </a>
          ) : (
            <button type="button" className={`btn ${t.featured ? 'btn-yellow' : ''}`} onClick={wallet.status === 'connected' ? undefined : wallet.openConnect} disabled={wallet.status === 'connected' && !PAID_OPEN}>
              <Icon name="wallet" size={20} />
              {wallet.status !== 'connected' ? 'Connect wallet' : PAID_OPEN ? 'Run it' : 'Opens soon'}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
