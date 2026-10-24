import type { CSSProperties } from 'react';
import type { AssetSymbol } from '@railwalker/core';
import { COINS } from '../lib/coins';

/** A token as a small coin. The symbol is for a screen reader unless the coin is only decoration next to its own name. */
export function Coin({ symbol, size = 24, label = false }: { symbol: AssetSymbol; size?: number; label?: boolean }) {
  const coin = COINS[symbol];
  const style = { '--c': coin.color, '--s': `${size}px` } as CSSProperties;
  return (
    <span className="coin" style={style} role={label ? 'img' : undefined} aria-label={label ? symbol : undefined} aria-hidden={label ? undefined : true}>
      {coin.glyph}
    </span>
  );
}
