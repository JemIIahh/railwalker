import type { MapGroup } from '@railwalker/data';

const DEMOS: Record<string, string> = {
  ok: 'Healthy demo seller',
  'paid/empty': 'Demo: empty answer',
  'paid/500': 'Demo: crashes after paying',
  'paid/bad-json': 'Demo: broken answer',
  'paid/slow': 'Demo: slow answer',
  'bad/decimals': 'Demo: price in wrong units',
  'bad/domain-name': 'Demo: wrong signing name',
  'bad/adapter-asset': 'Demo: wrong token address',
  'bad/payto-zero': 'Demo: pays to nowhere',
  'bad/permit2-method': 'Demo: peso token set up wrong',
  'bad/no-cors': 'Demo: hidden from web apps',
  'bad/testnet-only': 'Demo: test network only',
};

/** Words that name the vendor or the plumbing, not what the route does. */
const SKIPPED = new Set(['apify', 'apidojo', 'tikhub', 'monid', 'social', 'tools', 'api', 'v1', 'v2']);
const LONGEST = 48;

/** The words of a path: folders and dashes both separate them, plumbing is dropped, and the same word twice in a row is said once. */
function wordsOf(path: string, drop: Set<string>): string[] {
  const parts = path
    .split(/[/-]/)
    .map((w) => w.trim())
    .filter((w) => w !== '' && !drop.has(w.toLowerCase()));
  return parts.filter((w, i) => i === 0 || w.toLowerCase() !== parts[i - 1]!.toLowerCase());
}

const clip = (text: string): string => (text.length <= LONGEST ? text : `${text.slice(0, LONGEST - 1).trimEnd()}…`);

/** What an endpoint is called to a person: a name in plain words, and whether it is one of our demos or a real service. */
export function friendlyName(group: MapGroup, row: string): { title: string; where: string } {
  if (group === 'fixture') {
    const demo = DEMOS[row];
    if (demo !== undefined) return { title: demo, where: 'Our demo seller' };
    return { title: clip(`Demo: ${wordsOf(row, new Set()).join(' ').toLowerCase()}`), where: 'Our demo seller' };
  }
  const words = wordsOf(row, SKIPPED);
  if (words.length === 0) return { title: 'Home', where: 'Real service' };
  const sentence = words.map((w, i) => (w.length <= 2 ? w.toUpperCase() : i === 0 ? `${w[0]!.toUpperCase()}${w.slice(1)}` : w)).join(' ');
  return { title: clip(sentence), where: 'Real service' };
}
