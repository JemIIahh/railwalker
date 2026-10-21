/** The command line was wrong (exit 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A safety rule said no (exit 3): nothing was sent, nothing was paid. */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}
