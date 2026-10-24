import type { Loaded } from './load';

/** A load that has nothing to show. */
export type NotReady = Exclude<Loaded<unknown>, { state: 'ready' }>;

/** What to say in place of a section whose data is not there: not published yet, unreadable, or unreachable. Never a guess at the content. */
export function noticeWords(loaded: NotReady, what: string): string {
  if (loaded.state === 'empty') return `No ${what} ${/s$/.test(what) ? 'have' : 'has'} been published yet.`;
  if (loaded.why === 'invalid') return `The published ${what} could not be read, so nothing is shown rather than something wrong.`;
  return `The published ${what} could not be reached just now. It will show here when it can.`;
}
