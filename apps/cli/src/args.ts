export type FlagKind = 'bool' | 'string';

export interface CommandSpec {
  positionals: number;
  flags: Record<string, FlagKind>;
}

export const COMMANDS: Record<string, CommandSpec> = {
  'wallet:new': { positionals: 0, flags: {} },
  doctor: { positionals: 0, flags: {} },
  balance: { positionals: 0, flags: {} },
  scan: { positionals: 1, flags: { method: 'string', body: 'string' } },
  check: { positionals: 1, flags: { assets: 'string', stage: 'string', yes: 'bool', body: 'string', record: 'string', 'fee-paid': 'string', deliveries: 'string' } },
  register: { positionals: 0, flags: { sepolia: 'bool', mainnet: 'bool', yes: 'bool', fee: 'string', web: 'string', mcp: 'string', image: 'string' } },
  'run-batch': { positionals: 0, flags: { data: 'string', 'dry-run': 'bool', 'max-paid': 'string', 'budget-sec': 'string', fixtures: 'string' } },
};

export type Parsed =
  | { ok: true; command: string; positionals: string[]; flags: Record<string, string | true> }
  | { ok: false; error: string };

const HELP: Parsed = { ok: true, command: 'help', positionals: [], flags: {} };
const fail = (error: string): Parsed => ({ ok: false, error });
const arguments_ = (n: number) => `${n} argument${n === 1 ? '' : 's'}`;

/**
 * A small parser with no dependencies. Flags are declared per command, so a mistyped or misplaced flag is an error rather than
 * silently ignored: a safety flag that is ignored is worse than one that is refused.
 */
export function parseArgs(argv: string[]): Parsed {
  const command = argv[0];
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return HELP;
  const spec = COMMANDS[command];
  if (!spec) return fail(`unknown command "${command}"`);

  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (onlyPositionals) {
      positionals.push(token);
    } else if (token === '--') {
      onlyPositionals = true;
    } else if (token === '--help' || token === '-h') {
      return HELP;
    } else if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = token.slice(2, eq === -1 ? undefined : eq);
      const kind = spec.flags[name];
      if (!kind) return fail(`unknown flag --${name} for ${command}`);
      if (name in flags) return fail(`--${name} was given twice`);
      if (kind === 'bool') {
        if (eq !== -1) return fail(`--${name} does not take a value`);
        flags[name] = true;
      } else if (eq !== -1) {
        flags[name] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) return fail(`--${name} needs a value`);
        flags[name] = next;
        i++;
      }
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length < spec.positionals) return fail(`${command} needs ${arguments_(spec.positionals)}`);
  if (positionals.length > spec.positionals) return fail(`${command} takes ${arguments_(spec.positionals)}`);
  return { ok: true, command, positionals, flags };
}
