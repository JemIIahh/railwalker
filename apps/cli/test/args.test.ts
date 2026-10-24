import { describe, expect, test } from 'vitest';
import { COMMANDS, parseArgs } from '../src';

describe('parseArgs', () => {
  test('a command with a positional and string flags', () => {
    expect(parseArgs(['scan', 'https://x.example/a', '--method', 'POST', '--body', '{"a":1}'])).toEqual({
      ok: true,
      command: 'scan',
      positionals: ['https://x.example/a'],
      flags: { method: 'POST', body: '{"a":1}' },
    });
  });

  test('boolean flags, the --flag=value form, and flags before or after the positional', () => {
    expect(parseArgs(['check', '--yes', 'https://x.example', '--assets=USAT,USDC', '--stage', 'buy'])).toEqual({
      ok: true,
      command: 'check',
      positionals: ['https://x.example'],
      flags: { yes: true, assets: 'USAT,USDC', stage: 'buy' },
    });
  });

  test('a command with colon in its name, and no arguments', () => {
    expect(parseArgs(['wallet:new'])).toEqual({ ok: true, command: 'wallet:new', positionals: [], flags: {} });
    expect(parseArgs(['doctor'])).toMatchObject({ ok: true, command: 'doctor' });
    expect(parseArgs(['balance'])).toMatchObject({ ok: true, command: 'balance' });
  });

  test('register takes the network flags and --yes', () => {
    expect(parseArgs(['register', '--sepolia', '--yes', '--fee', 'USDC'])).toEqual({ ok: true, command: 'register', positionals: [], flags: { sepolia: true, yes: true, fee: 'USDC' } });
  });

  test.each([[[]], [['--help']], [['-h']], [['scan', '--help']], [['help']]])('%j asks for help', (argv) => {
    expect(parseArgs(argv)).toMatchObject({ ok: true, command: 'help' });
  });

  test.each([
    ['an unknown command', ['frobnicate'], /unknown command "frobnicate"/],
    ['an unknown flag', ['scan', 'https://x.example', '--nope'], /unknown flag --nope for scan/],
    ['a flag that belongs to another command', ['scan', 'https://x.example', '--yes'], /unknown flag --yes for scan/],
    ['a string flag with no value', ['check', 'https://x.example', '--assets'], /--assets needs a value/],
    ['a string flag followed by another flag', ['check', 'https://x.example', '--assets', '--yes'], /--assets needs a value/],
    ['a boolean flag given a value', ['check', 'https://x.example', '--yes=true'], /--yes does not take a value/],
    ['a flag given twice', ['check', 'https://x.example', '--assets', 'USAT', '--assets', 'USDC'], /--assets was given twice/],
    ['a missing positional', ['scan'], /scan needs 1 argument/],
    ['an extra positional', ['scan', 'https://a.example', 'https://b.example'], /scan takes 1 argument/],
    ['a positional where none belong', ['doctor', 'now'], /doctor takes 0 arguments/],
  ] as const)('%s is an error that names the problem', (_name, argv, message) => {
    const r = parseArgs(argv as unknown as string[]);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(message);
  });

  test('everything after -- is a positional, even if it looks like a flag', () => {
    expect(parseArgs(['scan', '--', '--odd-url'])).toMatchObject({ ok: true, positionals: ['--odd-url'] });
  });

  test('the command table is the plan’s command set', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(['balance', 'check', 'doctor', 'fund-pesos', 'register', 'run-batch', 'scan', 'wallet:new']);
  });
});
