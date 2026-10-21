import type { AssetSymbol } from './assets';
import { FINDING_ORDER, type Basis, type Finding, type FindingCode, type SkipReason } from './findings';

export type VerdictKind = 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'AMBIGUOUS' | 'SKIPPED';

export interface Verdict {
  kind: VerdictKind;
  code?: FindingCode | SkipReason;
  basis: Basis;
  assetSymbol?: AssetSymbol;
  findings: Finding[];
}

/**
 * No numeric score, ever: a verdict is the worst thing found. The basis says whether a real payment backs it.
 * `ambiguous_after_payment` outranks everything because money moved and nobody can say what came back.
 */
export function verdictFromFindings(a: { basis: Basis; findings: Finding[]; assetSymbol?: AssetSymbol }): Verdict {
  const { basis, findings } = a;
  const base = { basis, findings, ...(a.assetSymbol ? { assetSymbol: a.assetSymbol } : {}) };

  if (findings.some((f) => f.code === 'ambiguous_after_payment')) {
    return { kind: 'AMBIGUOUS', code: 'ambiguous_after_payment', ...base };
  }
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    const code = FINDING_ORDER.find((c) => errors.some((e) => e.code === c));
    return { kind: 'FAIL', ...(code ? { code } : {}), ...base };
  }
  if (findings.some((f) => f.severity === 'warn')) return { kind: 'PASS_WITH_WARNINGS', ...base };
  return { kind: 'PASS', ...base };
}
