import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// No colour is ever written outside the token file: every theme change is one file, and a new component can't
// smuggle in a colour that only reads in one theme.
const SRC = new URL('../../client/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TOKENS = join(SRC, 'theme', 'tokens.css');
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
// Named colours as CSS values ("color: white;"). Only checked in stylesheets: in JSX they are ordinary words.
const NAMED = /:\s*(?:white|black|red|blue|green|gold|orange|purple|grey|gray)\s*[;!}]/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(css|jsx?|html)$/.test(name) ? [p] : [];
  });
}

test('colours appear only in client/src/theme/tokens.css', () => {
  const offenders = [];
  for (const file of files(SRC)) {
    if (file === TOKENS) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (COLOUR.test(line) || (file.endsWith('.css') && NAMED.test(line))) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('every theme defines every colour token the default defines', () => {
  const css = readFileSync(TOKENS, 'utf8');
  // EVERY block for the selector (0.7.0: the badge tokens are a second set of theme blocks, appended verbatim from
  // design/v2-badges; checking only the first block would let a theme miss a badge colour unnoticed).
  const block = (selector) => {
    let out = '';
    for (let start = css.indexOf(`${selector} {`); start !== -1; start = css.indexOf(`${selector} {`, start + 1)) {
      out += css.slice(start, css.indexOf('\n}', start));
    }
    return out;
  };
  // Hex and rgba() colours both: a theme missing a translucent token (a glow, the map grid) would inherit Forever's.
  const names = (text) => new Set([...text.matchAll(/(--[a-z0-9-]+):\s*(?:#|rgba?\()/g)].map((m) => m[1]));
  const base = names(block(':root, [data-theme="forever"]'));
  assert.ok(base.size >= 40, 'the default theme block was found and has its colours');
  for (const theme of ['alliance', 'horde']) {
    const mine = names(block(`[data-theme="${theme}"]`));
    assert.deepEqual([...base].filter((n) => !mine.has(n)), [], `${theme} is missing tokens`);
  }
});
