const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

/** Fast at the start, gentle at the end: how a number should settle. From 0 to 1, and outside that it is held at the ends. */
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;

/** The number a counter shows part way to its target. It lands on the target exactly, never a rounded neighbour of it. */
export function countAt(progress: number, target: number, decimals = 0): number {
  if (!Number.isFinite(target)) return 0;
  if (progress >= 1) return target;
  const factor = 10 ** decimals;
  return Math.round(target * easeOutCubic(progress) * factor) / factor;
}

/** Grouped thousands, and exactly the decimals asked for, so a counter never changes width by dropping a trailing zero. */
export function formatCount(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
