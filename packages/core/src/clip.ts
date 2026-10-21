export interface ClipLimits {
  maxString: number;
  maxItems: number;
  maxKeys: number;
  maxDepth: number;
}

/** Generous for anything an honest seller sends, small enough that a hostile one cannot make a report large. */
export const DEFAULT_CLIP: ClipLimits = { maxString: 300, maxItems: 50, maxKeys: 50, maxDepth: 6 };

const MAX_KEY = 100;

export function clipText(text: string, max: number = DEFAULT_CLIP.maxString): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A bounded copy of untrusted JSON-like data: long strings, long arrays, wide objects and deep nesting are all cut. Everything a
 * scan reports about a seller passes through here, because the seller chose those bytes and the report is served to anyone.
 * A `__proto__` key is dropped rather than assigned; anything that is not JSON (functions, bigint) becomes undefined.
 */
export function clipDeep(value: unknown, limits: ClipLimits = DEFAULT_CLIP, depth = 0): unknown {
  if (typeof value === 'string') return clipText(value, limits.maxString);
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= limits.maxDepth) return '[too deep]';
  if (Array.isArray(value)) return value.slice(0, limits.maxItems).map((v) => clipDeep(v, limits, depth + 1));

  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const key of Object.keys(value)) {
    if (key === '__proto__') continue;
    if (kept++ >= limits.maxKeys) break;
    out[key.length > MAX_KEY ? key.slice(0, MAX_KEY) : key] = clipDeep((value as Record<string, unknown>)[key], limits, depth + 1);
  }
  return out;
}
