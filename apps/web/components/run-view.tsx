import type { RunRecord } from '@railwalker/scanner';
import { STAGE_LABELS } from '../lib/labels';
import { formatWhen, groupVerdicts, runFindings, splitUrl } from '../lib/view-models';
import { CopyLink } from './copy-link';
import { FindingList } from './finding-list';
import { RunStage } from './run-stage';
import { VerdictRows } from './verdict-rows';

/** One run, for its own page and for the drawer that slides in over the map: the address, the replay, the verdicts and the findings. */
export function RunView({ run, as: Heading = 'h1' }: { run: RunRecord; as?: 'h1' | 'h2' }) {
  const { confirmed, predicted } = groupVerdicts(run);
  const { issues, notes } = runFindings(run);
  const { host, path } = splitUrl(run.endpoint.url);
  return (
    <div className="run">
      <header className="run-head">
        <div className="run-url">
          <span className="pill pill-line">{run.endpoint.method}</span>
          <Heading className="mono">
            <span className="muted">{host}</span>
            {path}
          </Heading>
        </div>
        <div className="tags">
          <span className={run.kind === 'fixture' ? 'pill self' : 'pill'}>{STAGE_LABELS[run.kind]}</span>
          <span>{formatWhen(run.startedAt)}</span>
          <span className="mono">{run.id}</span>
          <CopyLink />
        </div>
      </header>

      <RunStage run={run} />

      <section className="results">
        <div className="card result-card">
          <h3 className="h3">Verdict</h3>
          {confirmed.length > 0 ? (
            <>
              <p className="kind">
                <i className="swatch solid" /> Paid
              </p>
              <VerdictRows verdicts={confirmed} />
            </>
          ) : null}
          {predicted.length > 0 ? (
            <>
              <p className="kind">
                <i className="swatch hatched" /> Predicted
              </p>
              <VerdictRows verdicts={predicted} />
            </>
          ) : null}
        </div>
        <div className="card result-card">
          <h3 className="h3">Findings</h3>
          {issues.length === 0 ? <p className="muted">Nothing wrong found.</p> : <FindingList findings={issues} />}
          {notes > 0 ? (
            <p className="report-notes">
              + {notes} {notes === 1 ? 'note' : 'notes'}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
