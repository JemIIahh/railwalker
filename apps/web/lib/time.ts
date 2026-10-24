export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MINUTE = 60_000;

/** How long ago, in the fewest words: minutes, hours, days, and after a week the date itself (with the year when it is not this one). */
export function timeAgo(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return 'just now'; // and anything in the future
  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  const date = new Date(then);
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${date.getUTCFullYear()}`;
}
