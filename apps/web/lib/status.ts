import type { Basis, VerdictKind } from '@railwalker/core';

export type Tone = 'good' | 'warn' | 'bad' | 'unsure' | 'idle';

export interface Status {
  tone: Tone;
  /** What it is called to someone who is not a developer. */
  word: string;
  /** Whether a real payment backs it. */
  basisWord: 'Paid test' | 'Quick look';
  sentence: string;
}

const NOT_SURE = 'We paid, but could not tell what came back';
const NOT_TESTED = 'We did not test this one';

const WORDS: Record<VerdictKind, { tone: Tone; confirmed: [string, string]; predicted: [string, string] }> = {
  PASS: { tone: 'good', confirmed: ['Works', 'Passed a real paid test'], predicted: ['Looks ready', 'No problems found in the quick look'] },
  PASS_WITH_WARNINGS: { tone: 'warn', confirmed: ['Works, needs polish', 'Passed the paid test, with things to improve'], predicted: ['Mostly ready', 'A few things to improve'] },
  FAIL: { tone: 'bad', confirmed: ['Broken', 'Failed a real paid test'], predicted: ['Will likely break', 'Problems found in the quick look'] },
  AMBIGUOUS: { tone: 'unsure', confirmed: ['Not sure', NOT_SURE], predicted: ['Not sure', NOT_SURE] },
  SKIPPED: { tone: 'idle', confirmed: ['Not tested', NOT_TESTED], predicted: ['Not tested', NOT_TESTED] },
};

/** A verdict in plain words. Only a real payment may say "Works" or "Broken"; a prediction says "Looks ready" or "Will likely break". */
export function statusOf(kind: VerdictKind, basis: Basis): Status {
  const words = WORDS[kind];
  const [word, sentence] = basis === 'CONFIRMED' ? words.confirmed : words.predicted;
  return { tone: words.tone, word, basisWord: basis === 'CONFIRMED' ? 'Paid test' : 'Quick look', sentence };
}
