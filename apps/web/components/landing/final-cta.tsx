'use client';

import { Bird } from '../bird';
import { Icon } from '../icons';
import { useWallet } from '../wallet/wallet-provider';

export function FinalCta() {
  const wallet = useWallet();
  return (
    <div className="final card">
      <div className="final-bird">
        <Bird size={150} />
      </div>
      <div className="final-copy">
        <h2 className="h2">Ready to see what breaks?</h2>
        <div className="final-actions">
          <a className="btn btn-lg" href="#top">
            Check a link <Icon name="arrowRight" size={20} />
          </a>
          <button type="button" className="btn btn-yellow btn-lg" onClick={wallet.status === 'connected' ? undefined : wallet.openConnect} disabled={wallet.status === 'connected'}>
            <Icon name="wallet" size={22} /> {wallet.status === 'connected' ? 'Wallet connected' : 'Connect wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}
