'use client';

import { useRef } from 'react';
import { shortAddress } from '../../lib/wallet-core';
import { Bird } from '../bird';
import { Icon } from '../icons';
import { useDialog } from '../use-dialog';
import { Avatar } from './connect-button';
import { useWallet } from './wallet-provider';

const GET_A_WALLET = [
  { name: 'MetaMask', href: 'https://metamask.io/download' },
  { name: 'Rabby', href: 'https://rabby.io' },
  { name: 'Coinbase Wallet', href: 'https://www.coinbase.com/wallet' },
];

/** Connect a wallet: pick one, and say yes in it. Nothing here moves money, and it says so. */
export function WalletModal() {
  const w = useWallet();
  const panel = useRef<HTMLDivElement | null>(null);
  useDialog(w.modalOpen, panel, w.closeConnect);
  if (!w.modalOpen) return null;
  const connected = w.status === 'connected' && w.address;

  return (
    <div className="modal-root">
      <div className="modal-scrim" onClick={w.closeConnect} aria-hidden="true" />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" tabIndex={-1} ref={panel}>
        <button type="button" className="icon-btn modal-x" onClick={w.closeConnect} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
        <div className="modal-head">
          <div className="modal-bird">
            <Bird size={84} />
          </div>
          {connected ? (
            <>
              <h2 id="wallet-title">{w.onCelo ? 'You’re connected' : 'One more step'}</h2>
              <p>{w.onCelo ? 'You can run paid tests now.' : 'Switch your wallet to the Celo network to continue.'}</p>
            </>
          ) : (
            <>
              <h2 id="wallet-title">Connect your wallet</h2>
              <p>Pay a few cents for a real paid test, in USDC, USDT or USA₮ on Celo.</p>
            </>
          )}
        </div>

        {connected ? (
          <div className="wallet-list">
            <div className="wallet-row" style={{ cursor: 'default' }}>
              <Avatar address={w.address!} size={40} />
              <span>
                {shortAddress(w.address!)}
                <br />
                <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>
                  {w.wallet?.name}
                </span>
              </span>
              <Icon name="check" size={20} strokeWidth={2.6} />
            </div>
            {w.onCelo ? (
              <button type="button" className="btn btn-yellow btn-lg" onClick={w.closeConnect}>
                Done
              </button>
            ) : (
              <button type="button" className="btn btn-yellow btn-lg" onClick={() => void w.switchToCelo()}>
                Switch to Celo
              </button>
            )}
          </div>
        ) : w.wallets.length > 0 ? (
          <div className="wallet-list">
            {w.wallets.map((wallet, i) => (
              <button key={wallet.rdns} type="button" className="wallet-row" onClick={() => void w.connect(wallet)} disabled={w.status === 'connecting'}>
                {wallet.icon ? <img src={wallet.icon} alt="" width={40} height={40} /> : <span className="avatar" style={{ width: 40, height: 40, background: 'var(--yellow)' }} aria-hidden="true" />}
                {wallet.name}
                {i === 0 && w.wallets.length > 1 ? <span className="tag">Recommended</span> : <Icon name="arrowRight" size={18} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="wallet-list">
            <div className="empty" style={{ padding: 24 }}>
              <span>No wallet found in this browser.</span>
              <div className="get-wallets">
                {GET_A_WALLET.map((g) => (
                  <a key={g.name} className="chip chip-plain" href={g.href} target="_blank" rel="noreferrer noopener">
                    {g.name} <Icon name="arrowUpRight" size={14} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {w.error ? (
          <p className="modal-error" role="alert">
            {w.error}
          </p>
        ) : null}
        <p className="modal-note">
          <Icon name="lock" size={16} />
          <span>Connecting never moves money. You approve every payment yourself, in your own wallet.</span>
        </p>
      </div>
    </div>
  );
}
