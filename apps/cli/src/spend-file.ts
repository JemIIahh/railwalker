import { dirname, resolve } from 'node:path';
import { emptySpendState, type SpendState } from '@railwalker/core';
import { Refusal } from './errors';
import type { Ctx } from './types';

const isNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isRecordOf = (v: unknown, ok: (x: unknown) => boolean): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(ok);

function isSpendState(v: unknown): v is SpendState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isNonNegative(s.totalUsd) && isRecordOf(s.byEndpointDay, isNonNegative) && isRecordOf(s.settlementsBySeller, (n) => Number.isInteger(n) && (n as number) >= 0);
}

export const spendPath = (ctx: Ctx) => resolve(ctx.deps.cwd, ctx.deps.env.DATA_DIR || './data', 'spend.json');

/**
 * The caps (per probe, per seller per day, per event, three settlements per unsolicited seller) only mean something if what was
 * already spent is remembered between runs. A state file that cannot be read stops the payment instead of resetting the caps.
 */
export async function loadSpend(ctx: Ctx): Promise<SpendState> {
  const path = spendPath(ctx);
  if (!(await ctx.deps.fs.exists(path))) return emptySpendState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await ctx.deps.fs.readFile(path));
  } catch {
    parsed = undefined;
  }
  if (!isSpendState(parsed)) {
    throw new Refusal(`the spend state at ${path} is unreadable or invalid: refusing to pay, because the spend caps cannot be enforced without it`);
  }
  return parsed;
}

export async function saveSpend(ctx: Ctx, state: SpendState): Promise<void> {
  const path = spendPath(ctx);
  await ctx.deps.fs.mkdir(dirname(path));
  await ctx.deps.fs.writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}
