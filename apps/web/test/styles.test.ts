import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const dir = new URL('../app/styles/', import.meta.url);
const css = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  .join('\n');

/** The body of the first rule whose selector is exactly this one. */
const ruleBody = (selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[2] ?? null;
};

describe('the stylesheets', () => {
  test('the names a station on the rail wears are not rules of their own anywhere else: a paragraph once shared one and its font size leaked in', () => {
    for (const name of ['pending', 'reached', 'ok', 'fail']) expect(css, name).not.toMatch(new RegExp(`(^|[}{,]\\s*)\\.${name}\\s*[{,]`, 'm'));
  });

  test('a mark takes its colour from its own state class: a default declared on its base rule would sit after those and win, and every mark would be grey', () => {
    for (const selector of ['.stamp', '.cell']) {
      const body = ruleBody(selector);
      expect(body, `the ${selector} rule exists`).not.toBeNull();
      expect(body, selector).not.toMatch(/--c\s*:/);
    }
  });

  test('every verdict state class that marks read exists', () => {
    for (const name of ['v-pass', 'v-pass_with_warnings', 'v-fail', 'v-ambiguous', 'v-skipped']) expect(ruleBody(`.${name}`), name).toMatch(/--c\s*:/);
  });

  test('there is a style for the reduced-motion visitor, and it switches animation and transition off', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation: none !important/);
    expect(css).toMatch(/transition: none !important/);
  });
});
