export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fetch that remembers every request it was asked to make (including ones with no route). */
export type RecordingFetch = typeof fetch & { calls: RecordedCall[] };

type Handler = (req: Request) => Response | Promise<Response>;
type FetchInput = Parameters<typeof fetch>[0];

async function record(calls: RecordedCall[], req: Request): Promise<void> {
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.clone().text();
  calls.push({ method: req.method, url: req.url, headers: Object.fromEntries(req.headers), body });
}

/** Routes are keyed by the full normalised URL. A request with no route throws, so unexpected traffic fails the test loudly. */
export function fakeFetch(routes: Record<string, Handler>): RecordingFetch {
  const calls: RecordedCall[] = [];
  const impl = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    await record(calls, req);
    const handler = routes[req.url];
    if (!handler) throw new Error(`fakeFetch: no route for ${req.method} ${req.url}`);
    return handler(req);
  };
  return Object.assign(impl, { calls }) as RecordingFetch;
}

/** Serve requests from any object with a web-standard `fetch(Request)`, such as a Hono app. */
export function appFetch(app: { fetch(req: Request): Response | Promise<Response> }): RecordingFetch {
  const calls: RecordedCall[] = [];
  const impl = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    await record(calls, req);
    return app.fetch(req);
  };
  return Object.assign(impl, { calls }) as RecordingFetch;
}
