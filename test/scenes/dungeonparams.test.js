// KB1 / HT1: THE OPTS THE STANDALONE DUNGEON HOST REALLY PASSES.
//
// THE BUG WAS A COMMENT, the same shape as FOE1 (test/scenes/audit39_worldmodes.test.js).
// HT1 (a0570bca) inserted `// HT1: the torch keys` in front of the live
// `foes` / `playerClass` / `playerSpell` / `playerWeapon` options of
// buildDungeonContext in src/scenes/dungeon.js. A line comment runs to
// the end of the line, so the block comment after it and those four
// options went with it. KB1 (970ed49117) wrapped that tail onto its own
// line and left the `//` at the start. The characters were still in the
// file. Nothing read them.
//
// `/play/?dungeon&class=16` therefore opened the character-creation
// wizard instead of applyHeadlessChargen, and `?nofoes` / `?spell` /
// `?weapon` on this host did nothing. world.js and exterior.js pass the
// same four options as code.
//
// WHY THE PIN STRIPS COMMENTS FIRST: a text match over the raw file
// stayed green for the whole time the options were commented out. The
// comments are removed, then the options object is parsed, then each
// value is run against a URLSearchParams. A property that has gone back
// inside a comment is a property that is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { CLASS_CAREERS } from '../../src/systems/chargen.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (f) => readFileSync(join(ROOT, f), 'utf8');

/** The source of `name(...)`'s call, comments removed. Same cut as FOE1. */
function callSourceStripped(text, name) {
  const at = text.indexOf(`${name}(`);
  assert.ok(at >= 0, `${name} is called`);
  let depth = 0;
  let end = at;
  for (let i = text.indexOf('(', at); i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  return text.slice(at, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** Direct properties of the options object that carries `playerClass`, as source expressions. */
function optionExprs(callSrc) {
  const wrapped = `(${callSrc})`;
  const ast = parse(wrapped, { ecmaVersion: 2022 });
  const call = ast.body[0].expression;
  assert.equal(call.type, 'CallExpression', 'buildDungeonContext is called');
  const bag = call.arguments.find((a) => a.type === 'ObjectExpression'
    && a.properties.some((p) => p.type === 'Property' && p.key?.name === 'playerClass'));
  assert.ok(bag, 'playerClass is a property of the options object, not text inside a comment');
  const out = {};
  for (const p of bag.properties) {
    if (p.type !== 'Property' || p.computed || !p.key?.name) continue;
    out[p.key.name] = wrapped.slice(p.value.start, p.value.end);
  }
  return out;
}

const readOpt = (expr, query) => new Function('params', `return (${expr});`)(new URLSearchParams(query));

test('KB1: the standalone dungeon host passes class, foes, spell and weapon into buildDungeonContext - a leading line comment is not an option', () => {
  assert.equal(CLASS_CAREERS[16], 'Warrior', 'class=16 is the Warrior in the careers table');
  const call = callSourceStripped(src('src/scenes/dungeon.js'), 'buildDungeonContext');
  const opts = optionExprs(call);
  for (const key of ['foes', 'playerClass', 'playerSpell', 'playerWeapon']) {
    assert.equal(typeof opts[key], 'string', `${key} is passed as code`);
  }
  assert.equal(readOpt(opts.playerClass, 'dungeon&class=16'), 16, '?class=16 reaches the host as the Warrior index');
  assert.equal(readOpt(opts.playerClass, 'dungeon'), undefined, 'no ?class leaves the wizard in charge');
  assert.equal(readOpt(opts.foes, 'dungeon'), true, 'foes are the default');
  assert.equal(readOpt(opts.foes, 'dungeon&nofoes'), false, '?nofoes is read');
  assert.equal(readOpt(opts.playerSpell, 'spell=4'), 4, '?spell= is read');
  assert.equal(readOpt(opts.playerSpell, 'dungeon'), undefined);
  assert.equal(readOpt(opts.playerWeapon, 'weapon=bow'), 'bow', '?weapon= is read');
  assert.equal(readOpt(opts.playerWeapon, 'dungeon'), undefined);
});
