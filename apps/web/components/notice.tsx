import { noticeWords, type NotReady } from '../lib/notice';

/** Stands in for a section whose data is not there. It says so plainly instead of drawing zeroes that would pass for a result. */
export function Notice({ loaded, what }: { loaded: NotReady; what: string }) {
  return (
    <div className="empty" role="status">
      <p>{noticeWords(loaded, what)}</p>
    </div>
  );
}
