'use client';

import { useState, type FormEvent } from 'react';
import type { CheckReport } from '@railwalker/scanner';

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; report: CheckReport; truncated: boolean };

const label = (v: CheckReport['verdicts'][number]) => (v.code ? `${v.kind}:${v.code}` : v.kind);

export function TryIt() {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [body, setBody] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ phase: 'loading' });
    const query = new URLSearchParams({ url: url.trim(), method, ...(method === 'POST' && body.trim() ? { body } : {}) });
    try {
      const res = await fetch(`/api/scan?${query}`);
      const data = await res.json();
      if (!res.ok) {
        setState({ phase: 'error', message: res.status === 429 ? `Too many scans. Try again in ${data.retryAfterSec} seconds.` : (data.error ?? 'Something went wrong.') });
      } else {
        setState({ phase: 'done', report: data as CheckReport, truncated: data.truncated === true });
      }
    } catch {
      setState({ phase: 'error', message: 'Could not reach the scanner.' });
    }
  }

  return (
    <section>
      <form onSubmit={submit} className="scan">
        <label>
          Endpoint URL
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seller.example/api/data" />
        </label>
        <div className="row">
          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}>
              <option>GET</option>
              <option>POST</option>
            </select>
          </label>
          <button type="submit" disabled={state.phase === 'loading'}>
            {state.phase === 'loading' ? 'Scanning…' : 'Scan, free'}
          </button>
        </div>
        {method === 'POST' && (
          <label>
            JSON body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder='{"query":"test"}' />
          </label>
        )}
      </form>

      <div aria-live="polite">
        {state.phase === 'error' && <p className="error">{state.message}</p>}
        {state.phase === 'done' && <Report report={state.report} truncated={state.truncated} />}
      </div>
    </section>
  );
}

function Report({ report, truncated }: { report: CheckReport; truncated: boolean }) {
  const attention = report.findings.filter((f) => f.severity !== 'info');
  return (
    <div className="report">
      <h2>{report.endpoint.method} {report.endpoint.url}</h2>
      <ul className="verdicts">
        {report.verdicts.map((v, i) => (
          <li key={i}>
            <strong>{v.assetSymbol ?? 'endpoint'}</strong> <span className={`chip ${v.kind.toLowerCase()}`}>{label(v)}</span>{' '}
            <span className="basis" title={v.basis === 'PREDICTED' ? 'Predicted from the 402 challenge. Nothing was paid.' : 'Confirmed with a real payment.'}>
              {v.basis === 'PREDICTED' ? 'predicted' : 'confirmed'}
            </span>
          </li>
        ))}
      </ul>
      {attention.length > 0 && (
        <ul className="findings">
          {attention.map((f, i) => (
            <li key={i}>
              <code>{f.code}</code>
              {f.assetSymbol ? ` (${f.assetSymbol})` : ''}: {f.message}
            </li>
          ))}
        </ul>
      )}
      {report.patches.map((p) => (
        <details key={`${p.code}-${p.title}`}>
          <summary>Fix: {p.title}</summary>
          <p>{p.why}</p>
          <pre>{p.after}</pre>
        </details>
      ))}
      {truncated && <p className="note">This report was very large, so the seller&apos;s own data was left out.</p>}
      <p className="note">
        Nothing was paid. <button type="button" disabled title="Coming soon">Confirm with a real payment</button>
      </p>
    </div>
  );
}
