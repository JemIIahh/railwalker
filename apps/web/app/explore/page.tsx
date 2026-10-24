import { ExploreCards } from '../../components/explore-cards';
import { FindingBars, TokenRings } from '../../components/breaks';
import { Notice } from '../../components/notice';
import { ReachMap } from '../../components/reach-map';
import { getData } from '../../lib/data';
import { endpointCards } from '../../lib/endpoint-cards';
import { loadMap, loadSummary } from '../../lib/load';
import { assetBars, findingBars, mapRows } from '../../lib/view-models';

/** The numbers change once an hour at most, so a few minutes of staleness costs nothing. */
export const revalidate = 300;
export const metadata = { title: 'Explore' };

export default async function Explore() {
  const store = getData();
  const [summary, map] = await Promise.all([loadSummary(store), loadMap(store)]);
  return (
    <div className="container section-tight page">
      <header className="page-head">
        <h1 className="page-title">Explore</h1>
        {summary.state === 'ready' ? (
          <p className="stamp-line">
            {summary.value.endpointsScanned} links checked, {summary.value.confirmedProbes} with a real payment.
          </p>
        ) : null}
      </header>

      {summary.state === 'ready' ? (
        <section className="explore-top" aria-label="What we found">
          <div className="card panel">
            <h2 className="h3">What breaks most</h2>
            <FindingBars bars={findingBars(summary.value)} />
          </div>
          <div className="card panel">
            <h2 className="h3">Tokens sellers accept</h2>
            <TokenRings bars={assetBars(summary.value)} />
          </div>
        </section>
      ) : (
        <Notice loaded={summary} what="scan results" />
      )}

      {map.state === 'ready' ? (
        <>
          <section className="section-block" aria-labelledby="all-h">
            <h2 id="all-h" className="h2">
              Everything we tested
            </h2>
            <ExploreCards cards={endpointCards(map.value.cells)} />
          </section>
          <section className="section-block" aria-labelledby="map-h">
            <h2 id="map-h" className="h2">
              Token by token
            </h2>
            <ReachMap view={mapRows(map.value.cells)} />
          </section>
        </>
      ) : (
        <Notice loaded={map} what="test results" />
      )}
    </div>
  );
}
