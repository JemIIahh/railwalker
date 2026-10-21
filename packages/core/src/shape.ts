export type Shape =
  | { type: 'object'; keys: Record<string, Shape> }
  | { type: 'array'; item: Shape | null }
  | { type: 'string' | 'number' | 'boolean' | 'null' };

/** The structural shape of a JSON value. Arrays are described by their first element. */
export function shapeOf(value: unknown): Shape {
  if (value === null || value === undefined) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', item: value.length > 0 ? shapeOf(value[0]) : null };
  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object': {
      const keys: Record<string, Shape> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) keys[k] = shapeOf(v);
      return { type: 'object', keys };
    }
    default:
      return { type: 'null' };
  }
}

function walk(expected: Shape, actual: Shape, path: string, out: string[]): void {
  if (expected.type !== actual.type) {
    out.push(path || '$');
    return;
  }
  if (expected.type === 'object' && actual.type === 'object') {
    for (const [k, child] of Object.entries(expected.keys)) {
      const next = path ? `${path}.${k}` : k;
      const found = actual.keys[k];
      if (found === undefined) out.push(next);
      else walk(child, found, next, out);
    }
  } else if (expected.type === 'array' && actual.type === 'array') {
    if (expected.item && actual.item) walk(expected.item, actual.item, `${path}[]`, out);
  }
}

/** Extra keys are fine; a missing or type-changed key fails and is named by its path. Empty arrays match any array. */
export function shapeMatches(expected: Shape, actual: Shape): { ok: boolean; missingKeys: string[] } {
  const missingKeys: string[] = [];
  walk(expected, actual, '', missingKeys);
  return { ok: missingKeys.length === 0, missingKeys };
}
