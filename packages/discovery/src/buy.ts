import { DeadlineExceeded, RAILWALKER_USER_AGENT, clipDeep, clipText, createDeadline, discard, parseSafeUrl, readCapped } from '@railwalker/core';
import { REGISTRIES } from '@railwalker/chain';
import type { Endpoint } from './merge';

export const BUY_CATALOG_URL = 'https://gateway.usebuy.ai/v1/catalog';
/** The one host a `buy` endpoint may be on. It is fixed here, not read from the catalog: a catalog cannot vouch for its own host. */
const BUY_HOST = new URL(BUY_CATALOG_URL).hostname;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_ENDPOINTS = 1000;

/** Limits for schemas written by a stranger: nothing in them may decide how much we build. */
const MAX_DEPTH = 6;
const MAX_PLACEHOLDER_CHARS = 256;
const MAX_ARRAY_ITEMS = 3;
const MAX_REQUIRED_FIELDS = 50;
const PLACEHOLDER = 'test';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function stringFor(schema: Record<string, unknown>): string {
  const min = finite(schema.minLength);
  const max = finite(schema.maxLength);
  let text = PLACEHOLDER;
  if (min !== undefined && min > text.length) text = text.padEnd(Math.min(min, MAX_PLACEHOLDER_CHARS), 'x');
  if (max !== undefined && max >= 0 && max < text.length) text = text.slice(0, Math.floor(max));
  return text;
}

function numberFor(schema: Record<string, unknown>, integer: boolean): number {
  const above = finite(schema.exclusiveMinimum);
  let value = finite(schema.minimum) ?? (above === undefined ? 1 : above + 1);
  if (integer) value = Math.ceil(value);
  const max = finite(schema.maximum);
  if (max !== undefined && value > max) value = integer ? Math.floor(max) : max;
  return value;
}

/** The type a schema means, including an object schema that forgot to say `type: object`. */
function typeOf(schema: Record<string, unknown>): string | undefined {
  const type = schema.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    const named = type.filter((t): t is string => typeof t === 'string');
    return named.find((t) => t !== 'null') ?? named[0];
  }
  if (isRecord(schema.properties) || Array.isArray(schema.required)) return 'object';
  if (schema.items !== undefined) return 'array';
  return undefined;
}

function arrayFor(schema: Record<string, unknown>, depth: number): unknown[] {
  const count = Math.min(Math.max(Math.floor(finite(schema.minItems) ?? 0), 0), MAX_ARRAY_ITEMS);
  const item = isRecord(schema.items) ? valueFor(schema.items, depth + 1) : undefined;
  return Array.from({ length: count }, () => (item === undefined ? PLACEHOLDER : structuredClone(item)));
}

function objectFor(schema: Record<string, unknown>, depth: number): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.slice(0, MAX_REQUIRED_FIELDS) : [];
  const out: Record<string, unknown> = {};
  for (const name of required) {
    if (typeof name !== 'string' || name === '__proto__') continue;
    const value = Object.hasOwn(properties, name) ? valueFor(properties[name], depth + 1) : undefined;
    out[name] = value === undefined ? PLACEHOLDER : value;
  }
  return out;
}

function valueFor(schema: unknown, depth: number): unknown {
  if (!isRecord(schema) || depth > MAX_DEPTH) return undefined;
  if ('example' in schema) return clipDeep(schema.example);
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return clipDeep(schema.examples[0]);
  if ('default' in schema) return clipDeep(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return clipDeep(schema.enum[0]);
  if ('const' in schema) return clipDeep(schema.const);
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length > 0) {
      const first = options.find((o) => isRecord(o) && typeOf(o) !== 'null') ?? options[0];
      return valueFor(first, depth + 1);
    }
  }
  switch (typeOf(schema)) {
    case 'string':
      return stringFor(schema);
    case 'integer':
      return numberFor(schema, true);
    case 'number':
      return numberFor(schema, false);
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array':
      return arrayFor(schema, depth);
    case 'object':
      return objectFor(schema, depth);
    default:
      return undefined;
  }
}

/**
 * The smallest body a schema would accept: required properties only, each from its example, else its default, else its first
 * enum value, else a placeholder that respects the length and number limits. Undefined when the schema says nothing buildable.
 * The schema comes from a stranger, so depth, array length, string length and the number of fields are all capped.
 */
export function bodyFromSchema(schema: unknown): unknown {
  return valueFor(schema, 0);
}

/** The agent id, only when the capability says it is registered in the Celo mainnet identity registry. */
function agentIdOf(agent: unknown): string | undefined {
  if (!isRecord(agent) || typeof agent.agentRegistry !== 'string') return undefined;
  const parts = agent.agentRegistry.split(':');
  if (parts.length !== 3 || parts[0] !== 'eip155' || parts[1] !== '42220' || parts[2]?.toLowerCase() !== REGISTRIES.mainnet.identity.toLowerCase()) return undefined;
  const id = agent.agentId;
  if (typeof id === 'number') return Number.isSafeInteger(id) && id >= 0 ? String(id) : undefined;
  return typeof id === 'string' && /^\d{1,78}$/.test(id) ? id : undefined;
}

function endpointFrom(raw: unknown): Endpoint | null {
  if (!isRecord(raw) || raw.available !== true) return null;
  if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.url !== 'string') return null;
  if (raw.method !== 'GET' && raw.method !== 'POST') return null;
  let url: URL;
  try {
    url = parseSafeUrl(raw.url);
  } catch {
    return null;
  }
  if (url.hostname !== BUY_HOST) return null;

  const endpoint: Endpoint = { url: url.href, method: raw.method, source: 'buy', capabilityId: clipText(raw.id, 200) };
  if (typeof raw.description === 'string') endpoint.description = clipText(raw.description);
  const body = bodyFromSchema(raw.inputSchema);
  if (body !== undefined) endpoint.bodyTemplate = body;
  const agentId = agentIdOf(raw.agent);
  if (agentId !== undefined) endpoint.agentId = agentId;
  return endpoint;
}

/** The capabilities buy says are available, as endpoints. Anything that is not a well-formed catalog gives nothing. */
export function endpointsFromBuyCatalog(catalog: unknown): Endpoint[] {
  if (!isRecord(catalog) || !Array.isArray(catalog.capabilities)) return [];
  const endpoints: Endpoint[] = [];
  for (const raw of catalog.capabilities) {
    if (endpoints.length >= MAX_ENDPOINTS) break;
    const endpoint = endpointFrom(raw);
    if (endpoint) endpoints.push(endpoint);
  }
  return endpoints;
}

/** One GET of buy's public catalog under one deadline. A redirect is an error, and the body is read at most 2 MiB. */
export async function fetchBuyCatalog(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const deadline = createDeadline(TIMEOUT_MS);
  try {
    const res = await deadline.race(
      fetchImpl(BUY_CATALOG_URL, { method: 'GET', redirect: 'manual', signal: deadline.signal, headers: { accept: 'application/json', 'user-agent': RAILWALKER_USER_AGENT } }),
    );
    if (res.status !== 200) {
      discard(res);
      throw new Error(`buy answered ${res.status} for its catalog`);
    }
    const body = await readCapped(res, MAX_CATALOG_BYTES, deadline, 'refuse');
    if (!body.ok) throw new Error('buy sent a catalog that is too large to read');
    try {
      return JSON.parse(body.text);
    } catch {
      throw new Error('buy sent a catalog that is not JSON');
    }
  } catch (err) {
    if (err instanceof DeadlineExceeded) throw new Error('buy did not answer in time');
    throw err;
  } finally {
    deadline.clear();
  }
}
