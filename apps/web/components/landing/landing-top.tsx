'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COINS } from '../../lib/coins';
import { gatesForScan, type Outcome } from '../../lib/diorama';
import { Bird } from '../bird';
import { Icon } from '../icons';
import { CheckCard } from './check-card';
import { RailScene } from './rail-scene';
import { ScanResult } from './scan-result';
import { useScan } from './use-scan';

/**
 * The top of the home page: the headline, the box to check a link, the little bird walking its railway, and, once a check has been
 * made, the result. The bird tells the story of recorded walks until you check something; then it walks yours.
 */
export function LandingTop({ demo, example = false }: { demo: Outcome[]; example?: boolean }) {
  const { state, scan } = useScan();
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [restart, setRestart] = useState(0);

  const live = useMemo<Outcome[] | null>(() => {
    if (state.phase !== 'done') return null;
    const first = state.report.verdicts.find((v) => v.assetSymbol)?.assetSymbol ?? 'USDC';
    const coin = COINS[first];
    return [{ gates: gatesForScan(state.report), symbol: first, glyph: coin.glyph, color: coin.color }];
  }, [state]);

  useEffect(() => {
    if (state.phase === 'done') {
      setRestart((n) => n + 1);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state]);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="pill pill-yellow">
              <Icon name="sparkle" size={14} /> Pays APIs in pesos and dollars on Celo
            </span>
            <h1 className="display">
              Does your API really get paid?
            </h1>
            <p className="lede">Paste a link. Our little bird pays it with real money, in pesos or dollars, then tells you what breaks.</p>
            <CheckCard state={state} onCheck={(u, m, b) => void scan(u, m, b)} />
          </div>
          <div className="hero-art">
            <div className="stage">
              <RailScene outcomes={live ?? demo} restartKey={restart} example={example && !live} label="A small yellow bird walks along a rail past five stops, Price, Rules, Pay, Answer and Result, and each stop gets a mark as the bird reaches it." />
              {live ? <span className="stage-live">Your check</span> : null}
            </div>
          </div>
        </div>
      </section>

      {state.phase === 'done' || state.phase === 'loading' ? (
        <section className="result-band" ref={resultRef} id="result">
          <div className="container">
            {state.phase === 'loading' ? (
              <div className="result result-loading" role="status">
                <Bird size={72} />
                <p>The bird is looking at your link…</p>
              </div>
            ) : (
              <ScanResult report={state.report} truncated={state.truncated} onCheckAs={(m) => void scan(state.report.endpoint.url, m, '')} />
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
