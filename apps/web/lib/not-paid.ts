export type NotPaidKind = 'website' | 'wrong_method' | 'needs_body' | 'not_found' | 'turned_away' | 'server_error' | 'unreachable';

export interface NotPaid {
  kind: NotPaidKind;
  title: string;
  body: string;
  /** The other way to ask, when that is worth offering. */
  retry: 'GET' | 'POST' | null;
}

/**
 * Why a link that gave no price is not a paid API, in words a person can act on. Most of these are not a broken API at all: a site
 * address, a route that only takes POST, a typo. Calling them "will likely break" would be wrong, so they are told apart by what the server said.
 */
export function explainNotPaid(report: { status: number | null; endpoint: { method: 'GET' | 'POST' } }): NotPaid {
  const { status } = report;
  const method = report.endpoint.method;

  if (status === null) return { kind: 'unreachable', title: 'We could not reach that link', body: 'No answer came back. Check the link for a typo, or try again in a minute.', retry: null };
  if (status === 405) {
    const other = method === 'GET' ? 'POST' : 'GET';
    return {
      kind: 'wrong_method',
      title: `That address does not take a ${method}`,
      body: method === 'GET' ? 'Many paid APIs only take a POST. Try the same link as a POST.' : 'It does not take a POST either. Try the same link as a GET.',
      retry: other,
    };
  }
  if (status === 404 || status === 410) return { kind: 'not_found', title: 'Nothing is at that address', body: 'The server says there is no page here. Check the link for a typo.', retry: null };
  if (status === 401 || status === 403) {
    return { kind: 'turned_away', title: 'The server turned the check away', body: 'It would not let a visitor in. A paid API answers a first visit with a price (HTTP 402), not a login wall.', retry: null };
  }
  if ((status === 400 || status === 422) && method === 'POST') {
    return { kind: 'needs_body', title: 'The server wanted a request first', body: 'It rejected the empty request before naming a price. Open More options and paste a sample request body.', retry: null };
  }
  if (status >= 500) return { kind: 'server_error', title: 'The server had an error', body: 'It failed before it could name a price. Try again in a minute.', retry: null };
  return {
    kind: 'website',
    title: 'That is a website or a free API, not a paid one',
    body: 'It answered without asking for payment. A paid API answers a first visit with a price (HTTP 402). If this is your API, check that payment is switched on for this route.',
    retry: null,
  };
}
