import type { LedgerFile } from '@railwalker/data';
import { Address } from '../../components/address';
import { Icon } from '../../components/icons';
import { ServiceCards, SignerRows } from '../../components/ledger';
import { Notice } from '../../components/notice';
import { StatCard } from '../../components/stat-cards';
import { getData } from '../../lib/data';
import { loadLedger } from '../../lib/load';
import { formatUsd, formatWhen } from '../../lib/view-models';

export const revalidate = 300;
export const metadata = { title: 'Proof' };

export default async function LedgerPage() {
  const loaded = await loadLedger(getData());
  return (
    <div className="container section-tight page">
      {loaded.state !== 'ready' ? (
        <>
          <header className="page-head">
            <h1 className="page-title">Proof</h1>
          </header>
          <Notice loaded={loaded} what="ledger" />
        </>
      ) : (
        <Books file={loaded.value} />
      )}
    </div>
  );
}

/** The money in and out as a line: who paid us, our wallet, what we paid. The loop on the wallet is money that never left. */
function Flow({ file }: { file: LedgerFile }) {
  const { ledger, agent } = file;
  const counted = ledger.signers.filter((s) => s.counted).length;
  return (
    <div className="flow card" role="img" aria-label={`In ${formatUsd(ledger.earnedUsd)} from ${ledger.signers.length} payers, out ${formatUsd(ledger.spentUsd)} to services`}>
      <div className="flow-node">
        <span className="flow-ico">
          <Icon name="coins" size={22} />
        </span>
        <span className="flow-title">Payers</span>
        <span className="flow-sub mono">
          {counted} of {ledger.signers.length} count
        </span>
      </div>
      <div className="flow-arrow in">
        <span className="mono">{formatUsd(ledger.earnedUsd)}</span>
        <i />
      </div>
      <div className="flow-node flow-core">
        <span className="flow-ico">
          <Icon name="wallet" size={22} />
        </span>
        <span className="flow-title">Our wallet</span>
        <span className="flow-sub">
          <Address value={agent} />
        </span>
        <span className="flow-loop mono" title="Moved between our own wallets: neither spent nor earned">
          <Icon name="replay" size={13} /> {ledger.selfTransfers} self
        </span>
      </div>
      <div className="flow-arrow out">
        <span className="mono">{formatUsd(ledger.spentUsd)}</span>
        <i />
      </div>
      <div className="flow-node">
        <span className="flow-ico">
          <Icon name="gate" size={22} />
        </span>
        <span className="flow-title">Services</span>
        <span className="flow-sub mono">{ledger.byService.filter((s) => !s.name.startsWith('self')).length} paid</span>
      </div>
    </div>
  );
}

function Books({ file }: { file: LedgerFile }) {
  const { ledger, hackathonStart, generatedAt } = file;
  const counted = ledger.signers.filter((s) => s.counted).length;
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Proof</h1>
        <p className="stamp-line">Every payment, with the transaction behind it. Updated {formatWhen(generatedAt)}.</p>
      </header>
      <div className="stats stats-4">
        <StatCard icon="arrowUpRight" label="Spent" hint="Paid to services we do not control." value={ledger.spentUsd} decimals={2} prefix="$" />
        <StatCard icon="arrowDownLeft" label="Earned" hint="Paid to us by anyone else." value={ledger.earnedUsd} decimals={2} prefix="$" />
        <StatCard icon="shield" label="Independent payers" hint={`Of ${ledger.signers.length} wallets that paid us.`} value={counted} />
        <StatCard icon="replay" label="Between our own wallets" hint="Transfers that count as neither spent nor earned." value={ledger.selfTransfers} />
      </div>

      <Flow file={file} />

      <section className="section-block" aria-labelledby="svc-h">
        <h2 id="svc-h" className="h2">
          What we bought
        </h2>
        <ServiceCards rows={ledger.byService} />
      </section>

      <section className="section-block" aria-labelledby="sig-h">
        <div className="head-row">
          <h2 id="sig-h" className="h2">
            Who paid us
          </h2>
          <span className="rule muted">
            <Icon name="info" size={14} /> Counts if active on Celo before {formatWhen(hackathonStart)} and not first funded by us
          </span>
        </div>
        <SignerRows rows={ledger.signers} />
      </section>
    </>
  );
}
