import type { AssetSymbol } from '@railwalker/core';

/** What each token looks like as a coin: its colour and the one letter on its face. Made up for the page, not the issuers' own marks. */
export const COINS: Record<AssetSymbol, { color: string; glyph: string }> = {
  USDC: { color: '#2775ca', glyph: '$' },
  USDT: { color: '#26a17b', glyph: '₮' },
  USAT: { color: '#2b2f38', glyph: '₮' },
  wARS: { color: '#62aee8', glyph: '$' },
  wBRL: { color: '#19a15f', glyph: 'R' },
  wMXN: { color: '#c0392b', glyph: '$' },
  wCOP: { color: '#e6a817', glyph: '$' },
  wPEN: { color: '#d6455d', glyph: 'S' },
  wCLP: { color: '#5b6ee1', glyph: '$' },
  cNGN: { color: '#0b7f4a', glyph: '₦' },
};
