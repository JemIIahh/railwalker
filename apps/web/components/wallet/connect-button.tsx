'use client';

import { useEffect, useRef, useState } from 'react';
import { ASSETS } from '@railwalker/core';
import { avatarGradient, bestBalance, shortAddress } from '../../lib/wallet-core';
import { formatPaid } from '../../lib/view-models';
import { Coin } from '../coin';
import { CopyButton } from '../copy-button';
import { Icon } from '../icons';
import { useWallet } from './wallet-provider';

export function Avatar({ address, size = 36 }: { address: string; size?: number }) {
  const [a, b] = avatarGradient(address);
  return <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(135deg, ${a}, ${b})` }} aria-hidden="true" />;
}

/** The wallet button for the header: yellow and impossible to miss until a wallet is connected, then the account and what it holds. */
export function ConnectButton({ large = false }: { large?: boolean }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (w.status !== 'connected' || !w.address) {
    return (
      <button type="button" className={`btn btn-yellow${large ? ' btn-lg' : ''}`} onClick={w.openConnect} disabled={w.status === 'connecting'}>
        <Icon name="wallet" size={large ? 22 : 20} />
        {w.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  const best = bestBalance(w.balances);
  return (
    <div className="wallet-btn" ref={box}>
      <button type="button" className={`wallet-chip${w.onCelo ? '' : ' wrong'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Avatar address={w.address} />
        <span className="addr">{shortAddress(w.address)}</span>
        {w.onCelo ? best ? <span className="bal">{best.text}</span> : null : <span className="bal">Wrong network</span>}
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-top">
            <Avatar address={w.address} size={44} />
            <div className="menu-name">
              <strong>{shortAddress(w.address)}</strong>
              <span>{w.wallet?.name ?? 'Wallet'}</span>
            </div>
            <CopyButton text={w.address} label="Copy address" />
          </div>
          {w.onCelo ? (
            <>
              <div className="menu-net">
                <Icon name="check" size={16} strokeWidth={2.6} /> Connected to Celo
              </div>
              <ul className="menu-bal" aria-label="Balances">
                {w.balances.length === 0 ? <li className="muted">Looking up your balance…</li> : null}
                {w.balances.map((b) => (
                  <li key={b.symbol}>
                    <Coin symbol={b.symbol} size={22} />
                    <span>{b.symbol}</span>
                    <span className="mono">{b.atomic === 0n ? '$0.00' : formatPaid(ASSETS[b.symbol].address, b.atomic.toString())}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="menu-net wrong">
                <Icon name="alert" size={16} /> Your wallet is on another network
              </div>
              <button type="button" className="btn btn-yellow" onClick={() => void w.switchToCelo()}>
                Switch to Celo
              </button>
            </>
          )}
          <div className="menu-actions">
            <a href={`https://celo.blockscout.com/address/${w.address}`} target="_blank" rel="noreferrer noopener">
              <Icon name="arrowUpRight" size={18} /> View on the explorer
            </a>
            <button
              type="button"
              onClick={() => {
                w.disconnect();
                setOpen(false);
              }}
            >
              <Icon name="logout" size={18} /> Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
