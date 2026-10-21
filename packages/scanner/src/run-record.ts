import { createHash } from 'node:crypto';
import type { Stage, Verdict } from '@railwalker/core';

export type RunStage = 'challenge' | 'lints' | 'wallet' | 'sign' | 'settle' | 'deliver' | 'verdict';

export interface RunStep {
  /** Milliseconds since the run started. */
  t: number;
  stage: RunStage;
  /** null: not decided (waiting, or nothing to conclude). */
  ok: boolean | null;
  label: string;
  detail?: Record<string, unknown>;
}

export interface RunPayment {
  asset: string;
  symbol: string | null;
  amountAtomic: string;
  payTo: string;
  /** Absent when the payment was sent and nobody can say whether it settled. */
  txHash?: string;
}

export interface RunRecord {
  id: string;
  kind: Stage;
  startedAt: string;
  endpoint: { url: string; method: 'GET' | 'POST' };
  steps: RunStep[];
  verdicts: Verdict[];
  payments: RunPayment[];
}

/** Builds the replayable story of one confirmation. Time comes from the injected clock and never runs backwards. */
export class RunRecorder {
  private readonly steps: RunStep[] = [];
  private readonly payments: RunPayment[] = [];
  private readonly startMs: number;
  private last = 0;
  readonly startedAt: string;

  constructor(
    private readonly now: () => Date,
    private readonly kind: Stage,
    private readonly endpoint: RunRecord['endpoint'],
  ) {
    const start = now();
    this.startMs = start.getTime();
    this.startedAt = start.toISOString();
  }

  step(stage: RunStage, ok: boolean | null, label: string, detail?: Record<string, unknown>): void {
    this.last = Math.max(this.last, this.now().getTime() - this.startMs);
    this.steps.push({ t: this.last, stage, ok, label, ...(detail ? { detail } : {}) });
  }

  payment(p: RunPayment): void {
    this.payments.push(p);
  }

  /** A snapshot: steps added afterwards do not change it. */
  finish(verdicts: Verdict[]): RunRecord {
    const id = createHash('sha256').update(`${this.kind} ${this.endpoint.method} ${this.endpoint.url} ${this.startedAt}`).digest('hex').slice(0, 16);
    return {
      id,
      kind: this.kind,
      startedAt: this.startedAt,
      endpoint: { ...this.endpoint },
      steps: this.steps.map((s) => ({ ...s })),
      verdicts: structuredClone(verdicts),
      payments: this.payments.map((p) => ({ ...p })),
    };
  }
}
