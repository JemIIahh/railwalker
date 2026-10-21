export interface EndpointFacts {
  url: string;
  method: 'GET' | 'POST';
  description?: string;
  capabilityId?: string;
  source: 'buy' | 'fixture' | 'erc8004' | 'visitor';
}

/** Words that mean "this route does something in the world". Matched as whole words, never as substrings. */
const DENY_WORDS = new Set([
  'create', 'send', 'pay', 'payment', 'payments', 'transfer', 'book', 'provision', 'withdraw', 'delete', 'rent', 'order',
  'purchase', 'subscribe', 'deploy', 'mint', 'swap', 'claim', 'sign', 'submit', 'update', 'upload', 'refund', 'cancel',
  'topup', 'recharge', 'airtime', 'bill',
]);

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Only read-style endpoints may ever be paid. The host never counts (pay.example.com is not a side effect);
 * the capability id, the URL path and the description do. When in doubt the answer is "not read-style".
 */
export function classifyReadStyle(f: EndpointFacts): { readStyle: boolean; reason: string } {
  const sources: [string, string[]][] = [
    ['capability', words(f.capabilityId ?? '')],
    ['path', words(pathOf(f.url))],
    ['description', words(f.description ?? '')],
  ];
  for (const [where, tokens] of sources) {
    const hit = tokens.find((t) => DENY_WORDS.has(t));
    if (hit) return { readStyle: false, reason: `the ${where} mentions "${hit}", which suggests a side effect` };
  }
  return { readStyle: true, reason: 'no side-effect words in the capability, path or description' };
}
