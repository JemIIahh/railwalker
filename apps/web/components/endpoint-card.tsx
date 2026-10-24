import Link from 'next/link';
import type { EndpointCard } from '../lib/endpoint-cards';
import { statusOf } from '../lib/status';
import { Coin } from './coin';
import { Icon } from './icons';
import { StatusBadge } from './status-badge';
import { TimeAgo } from './time-ago';

/** One endpoint as a card: how it did in a few words, what it is, the tokens it takes, and whether a real payment was made. */
export function EndpointCardView({ card }: { card: EndpointCard }) {
  const s = statusOf(card.verdict, card.basis);
  return (
    <Link href={`/run/${card.runId}`} className={`ep card card-hover tone-${s.tone}`}>
      <div className="ep-top">
        <StatusBadge verdict={card.verdict} basis={card.basis} />
        <Icon name="arrowUpRight" size={20} />
      </div>
      <h3 className="ep-title">{card.title}</h3>
      <p className="ep-where">
        {card.where} · <TimeAgo iso={card.at} />
      </p>
      <div className="ep-foot">
        <span className="coins" aria-label={`Tried with ${card.tokens.join(', ')}`}>
          {card.tokens.map((t) => (
            <Coin key={t} symbol={t} size={26} />
          ))}
        </span>
        <span className="basis">
          <Icon name={card.paidTest ? 'coins' : 'eye'} size={14} /> {card.paidTest ? 'Paid test' : 'Quick look'}
        </span>
      </div>
    </Link>
  );
}
