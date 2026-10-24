import { DEFAULT_POLICY } from '@railwalker/core';
import Link from 'next/link';
import { EndpointCardView } from '../components/endpoint-card';
import { Icon } from '../components/icons';
import { FinalCta } from '../components/landing/final-cta';
import { HowSteps } from '../components/landing/how-steps';
import { LandingTop } from '../components/landing/landing-top';
import { Stickers } from '../components/landing/stickers';
import { Tiers } from '../components/landing/tiers';
import { Trust } from '../components/landing/trust';
import { Reveal } from '../components/motion';
import { Notice } from '../components/notice';
import { COINS } from '../lib/coins';
import { getData } from '../lib/data';
import { gatesFor, type Outcome } from '../lib/diorama';
import { endpointCards, featuredCards } from '../lib/endpoint-cards';
import { loadLedger, loadMap, loadRun, loadSummary } from '../lib/load';
import { formatUsd, formatUsdShort } from '../lib/view-models';
import { pickWalkRuns, walkToken } from '../lib/walk';

/** The numbers change once an hour at most, so a few minutes of staleness costs nothing and saves a fetch on every visit. */
export const revalidate = 300;

/** What the little bird walks when there are no recorded runs to tell: one that works, one that breaks after paying, one that needs polish. */
const STORY: Outcome[] = [
  { gates: ['ok', 'ok', 'ok', 'ok', 'ok'], symbol: 'USAT', glyph: COINS.USAT.glyph, color: COINS.USAT.color },
  { gates: ['ok', 'ok', 'ok', 'fail', 'fail'], symbol: 'USDC', glyph: COINS.USDC.glyph, color: COINS.USDC.color },
  { gates: ['ok', 'warn', 'ok', 'ok', 'warn'], symbol: 'USDT', glyph: COINS.USDT.glyph, color: COINS.USDT.color },
];

export default async function Home() {
  const store = getData();
  const [summary, map, ledger] = await Promise.all([loadSummary(store), loadMap(store), loadLedger(store)]);
  const walked = map.state === 'ready' ? pickWalkRuns(map.value.cells) : [];
  const runs = (await Promise.all(walked.map((id) => loadRun(store, id)))).flatMap((r) => (r.state === 'ready' ? [r.value] : []));
  const told: Outcome[] = runs.map((run) => {
    const symbol = walkToken(run);
    return { gates: gatesFor(run), symbol, glyph: COINS[symbol].glyph, color: COINS[symbol].color };
  });
  const cards = map.state === 'ready' ? featuredCards(endpointCards(map.value.cells), 6) : [];
  const policy = DEFAULT_POLICY;

  return (
    <>
      <LandingTop demo={told.length > 0 ? told : STORY} example={told.length === 0} />

      {summary.state === 'ready' ? (
        <section className="section-tight">
          <div className="container">
            <Stickers
              items={[
                { icon: 'scan', label: 'Links checked', value: summary.value.endpointsScanned, tint: 'tint-lilac' },
                { icon: 'receipt', label: 'Paid tests', value: summary.value.confirmedProbes, tint: 'tint-butter' },
                { icon: 'unlock', label: 'Could be paid-tested', value: summary.value.payablePct, decimals: 1, suffix: '%', tint: 'tint-mint' },
              ]}
            />
          </div>
        </section>
      ) : null}

      <section className="section" id="how">
        <div className="container">
          <div className="head">
            <h2 className="h2">How it works</h2>
          </div>
          <Reveal>
            <HowSteps />
          </Reveal>
        </div>
      </section>

      <section className="section band" id="recent">
        <div className="container">
          <div className="head">
            <h2 className="h2">Recently tested</h2>
            <Link href="/explore" className="head-link">
              See them all <Icon name="arrowRight" size={18} />
            </Link>
          </div>
          {map.state === 'ready' ? (
            <div className="ep-grid">
              {cards.map((card, i) => (
                <Reveal key={card.key} delay={i * 60}>
                  <EndpointCardView card={card} />
                </Reveal>
              ))}
            </div>
          ) : (
            <Notice loaded={map} what="test results" />
          )}
        </div>
      </section>

      <section className="section" id="tests">
        <div className="container">
          <div className="head">
            <h2 className="h2">Pick a test</h2>
          </div>
          <Reveal>
            <Tiers />
          </Reveal>
        </div>
      </section>

      <section className="section night" id="safe">
        <div className="container">
          <div className="head">
            <h2 className="h2">Safe by design</h2>
          </div>
          <Trust
            items={[
              { icon: 'coins', value: formatUsdShort(policy.perProbeMaxUsd), of: 'most per payment' },
              { icon: 'clock', value: formatUsdShort(policy.perEndpointDayMaxUsd), of: 'most per seller, per day' },
              { icon: 'wallet', value: formatUsdShort(policy.eventMaxUsd), of: 'most in total' },
            ]}
            guards={[
              { icon: 'wallet', text: `Always keeps ${formatUsd(policy.reserveUsd)}` },
              { icon: 'eye', text: 'Never pays to change anything' },
              { icon: 'lock', text: 'Opt-out honoured' },
            ]}
            budget={ledger.state === 'ready' ? { used: ledger.value.ledger.spentUsd, of: policy.eventMaxUsd, usedText: formatUsd(ledger.value.ledger.spentUsd), ofText: formatUsdShort(policy.eventMaxUsd) } : null}
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <FinalCta />
        </div>
      </section>
    </>
  );
}
