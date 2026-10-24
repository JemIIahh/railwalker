'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { formatUsdShort } from '../../lib/view-models';
import { Icon } from '../icons';
import { useWallet } from '../wallet/wallet-provider';
import type { ScanState } from './use-scan';

export type CheckMode = 'free' | 'paid';

export const TIERS = [
  { id: 'quick', name: 'Quick test', usd: 0.02, line: 'One real payment' },
  { id: 'full', name: 'Full test', usd: 0.25, line: 'Every token, three tries' },
] as const;
export type TierId = (typeof TIERS)[number]['id'];

/** Whether paid tests can be taken yet. Off until the runner is funded and its endpoint is live. */
const PAID_OPEN = process.env.NEXT_PUBLIC_PAID_CHECKS === '1';

/**
 * The one thing to do on the page: paste a link and check it for free, or switch to a paid test, which asks for a wallet. Everything
 * else on the page is here to explain this box.
 */
export function CheckCard({ state, onCheck }: { state: ScanState; onCheck: (url: string, method: 'GET' | 'POST', body: string) => void }) {
  const wallet = useWallet();
  const [mode, setMode] = useState<CheckMode>('free');
  const [tier, setTier] = useState<TierId>('quick');
  const [url, setUrl] = useState('');
  const [more, setMore] = useState(false);
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [body, setBody] = useState('');
  const [origin, setOrigin] = useState<string | null>(null);

  // our own demo sellers are offered only where they can be reached: a page on localhost cannot check itself
  useEffect(() => {
    const { hostname, origin: here } = window.location;
    setOrigin(/^(localhost|127\.|\[::1\])/.test(hostname) ? null : here);
  }, []);

  const loading = state.phase === 'loading';
  const chosen = TIERS.find((t) => t.id === tier)!;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'free') onCheck(url, method, body);
    else if (wallet.status !== 'connected') wallet.openConnect();
    else if (!wallet.onCelo) void wallet.switchToCelo();
  }

  const action =
    mode === 'free'
      ? { label: loading ? 'Checking…' : 'Check it free', icon: 'arrowRight' as const, disabled: loading }
      : wallet.status !== 'connected'
        ? { label: 'Connect wallet', icon: 'wallet' as const, disabled: false }
        : !wallet.onCelo
          ? { label: 'Switch to Celo', icon: 'globe' as const, disabled: false }
          : PAID_OPEN
            ? { label: `Pay ${formatUsdShort(chosen.usd)} and test`, icon: 'coins' as const, disabled: false }
            : { label: 'Paid tests open soon', icon: 'clock' as const, disabled: true };

  return (
    <form className="checker" onSubmit={submit}>
      <div className="seg" role="radiogroup" aria-label="Kind of check">
        <button type="button" role="radio" aria-checked={mode === 'free'} onClick={() => setMode('free')}>
          <Icon name="eye" size={16} /> Free check
        </button>
        <button type="button" role="radio" aria-checked={mode === 'paid'} onClick={() => setMode('paid')}>
          <Icon name="coins" size={16} /> Paid test
        </button>
      </div>

      <label className="field">
        <Icon name="link" size={20} />
        <span className="sr-only">Link to the API</span>
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the link to your API" autoComplete="off" spellCheck={false} />
      </label>

      {mode === 'paid' ? (
        <div className="tiers-mini" role="radiogroup" aria-label="Which paid test">
          {TIERS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={tier === t.id} className="tier-mini" onClick={() => setTier(t.id)}>
              <span className="tier-price">{formatUsdShort(t.usd)}</span>
              <span className="tier-name">{t.name}</span>
              <span className="tier-line">{t.line}</span>
            </button>
          ))}
        </div>
      ) : null}

      {more ? (
        <div className="more">
          <div className="seg seg-small" role="radiogroup" aria-label="Method">
            {(['GET', 'POST'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}>
                {m}
              </button>
            ))}
          </div>
          {method === 'POST' ? <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder='What to send, like {"query":"test"}' aria-label="What to send" /> : null}
        </div>
      ) : null}

      <button type="submit" className="btn btn-yellow btn-lg checker-go" disabled={action.disabled}>
        <Icon name={action.icon} size={22} />
        {action.label}
      </button>

      <div className="checker-foot">
        {mode === 'free' ? (
          <span>
            <Icon name="lock" size={14} /> Free. Nothing is paid.
          </span>
        ) : wallet.status === 'connected' ? (
          <span>
            <Icon name="shield" size={14} /> We spend at most half of it on testing your API.
          </span>
        ) : (
          <span>
            <Icon name="lock" size={14} /> Connecting never moves money.
          </span>
        )}
        <button type="button" className="linkish" onClick={() => setMore((m) => !m)}>
          {more ? 'Fewer options' : 'More options'}
        </button>
      </div>

      {origin && mode === 'free' ? (
        <div className="examples">
          Try
          <button type="button" className="chip chip-plain" onClick={() => setUrl(`${origin}/api/fixtures/ok`)}>
            a good one
          </button>
          <button type="button" className="chip chip-plain" onClick={() => setUrl(`${origin}/api/fixtures/bad/decimals`)}>
            a broken one
          </button>
        </div>
      ) : null}
      {state.phase === 'error' ? (
        <p className="checker-error" role="alert">
          <Icon name="alert" size={18} /> {state.message}
        </p>
      ) : null}
    </form>
  );
}
