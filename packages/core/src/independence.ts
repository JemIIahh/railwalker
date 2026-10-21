export interface WalletFacts {
  address: string;
  /** ISO timestamp of the wallet's first Celo activity, or null when none was found. */
  firstActivityAt: string | null;
  /** The sender of the wallet's earliest inbound transfer, or null when unknown. */
  firstFunder: string | null;
}

export interface IndependenceInput {
  wallet: WalletFacts;
  projectWallets: string[];
  /** ISO timestamp; the hackathon rule uses 2026-10-06T00:00:00Z. */
  hackathonStart: string;
}

export type IndependenceReason = 'counted' | 'is_project_wallet' | 'funded_by_project' | 'no_prior_activity' | 'activity_after_start';

/**
 * The hackathon's definition: not ours, not first funded by us, and with its own Celo activity BEFORE the start.
 * An unknown funder cannot be shown to be ours, so prior activity is what decides it.
 */
export function classifyIndependence(i: IndependenceInput): { counted: boolean; reason: IndependenceReason } {
  const ours = new Set(i.projectWallets.map((a) => a.toLowerCase()));
  const result = (reason: IndependenceReason) => ({ counted: reason === 'counted', reason });

  if (ours.has(i.wallet.address.toLowerCase())) return result('is_project_wallet');
  if (i.wallet.firstFunder && ours.has(i.wallet.firstFunder.toLowerCase())) return result('funded_by_project');

  const first = i.wallet.firstActivityAt === null ? NaN : Date.parse(i.wallet.firstActivityAt);
  if (Number.isNaN(first)) return result('no_prior_activity');
  if (first >= Date.parse(i.hackathonStart)) return result('activity_after_start');
  return result('counted');
}
