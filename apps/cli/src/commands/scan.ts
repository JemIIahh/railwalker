import type { ScanRequest } from '@railwalker/scanner';
import type { Parsed } from '../args';
import { UsageError } from '../errors';
import { findingLines, verdictLines } from '../format';
import type { Ctx } from '../types';

export function parseBody(raw: string | true | undefined, flag = '--body'): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new UsageError(`${flag} must be valid JSON`);
  }
}

/** Free: scans one endpoint and prints the report as JSON. Never pays, never needs a wallet or any configuration. */
export async function scanCommand(ctx: Ctx, args: Parsed & { ok: true }): Promise<number> {
  const method = String(args.flags.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new UsageError('--method must be GET or POST');
  const body = parseBody(args.flags.body);
  if (body !== undefined && method !== 'POST') throw new UsageError('--body needs --method POST');

  const req: ScanRequest = { url: args.positionals[0]!, method, ...(body === undefined ? {} : { body }) };
  const report = await ctx.deps.scan(req);

  ctx.out(`${JSON.stringify(report, null, 2)}\n`); // stdout is only the JSON, so it can be piped
  ctx.err(verdictLines(report.verdicts) + findingLines(report.findings));
  return 0;
}
