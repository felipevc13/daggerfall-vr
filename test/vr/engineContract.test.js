// The VR mod's contract with the DFO engine. Headless: no WebGL, no ARENA2,
// no headset. An upstream merge that deletes a hook fails here, and the flat
// game's entry is pinned so it cannot start importing src/vr by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectMissingHooks, guardedSetXrTarget, probeVrEngineHooks, probeVrUiHooks } from '../../src/vr/engineBridge.js';

const read = (p) => readFileSync(p, 'utf8');

function jsFiles(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) jsFiles(p, acc);
    else if (ent.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test('the engine still exports the hooks the headset draws through', async () => {
  const probe = await probeVrEngineHooks();
  assert.deepEqual(probe.missing, [], probe.missing.join(', '));
  assert.equal(probe.ok, true);
  const rendererSrc = read('src/render/renderer.js');
  assert.match(rendererSrc, /xrCompatible:\s*true/);
  assert.match(rendererSrc, /setXrTarget\(framebuffer, viewport\)/);
  assert.match(rendererSrc, /_frameTarget\(\)/);
});

test('a symmetric off-centre frustum matches perspective', async () => {
  const { perspective, perspectiveOffCenter } = await import('../../src/world/mat4.js');
  const fov = Math.PI / 2;
  const aspect = 1.5;
  const near = 0.05;
  const far = 300;
  const top = near * Math.tan(fov / 2);
  const right = top * aspect;
  const a = perspective(fov, aspect, near, far);
  const b = perspectiveOffCenter(-right, right, -top, top, near, far);
  assert.equal(a.length, 16);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `element ${i}`);
});

test('a missing hook disables the eye instead of throwing', () => {
  class Renderer {}
  const missing = collectMissingHooks({
    lookAt() {}, perspective() {}, mirrorProjectionX() {}, identity() {}, perspectiveOffCenter() {}, UP_Y: [0, 1, 0],
  }, Renderer);
  assert.deepEqual(missing, ['Renderer.setXrTarget', 'Renderer._frameTarget']);
  assert.equal(guardedSetXrTarget(new Renderer(), {}, { x: 0, y: 0, width: 1, height: 1 }), false);
  let called = 0;
  class Ready {
    setXrTarget() { called += 1; }
  }
  assert.equal(guardedSetXrTarget(new Ready(), null, null), true);
  assert.equal(called, 1);
});

test('src/vr touches mat4 only through the bridge, and the flat entry does not import VR', () => {
  for (const file of jsFiles('src/vr')) {
    if (file.endsWith(`${join('src', 'vr', 'engineBridge.js')}`)) continue;
    const text = read(file);
    assert.doesNotMatch(text, /from ['"]\.\.\/world\/mat4\.js['"]/, file);
    if (!file.endsWith('vrDungeon.js')) assert.doesNotMatch(text, /from ['"]\.\.\/render\/renderer\.js['"]/, file);
  }
  const importVr = /from ['"][^'"]*\/vr\//;
  for (const file of jsFiles('src')) {
    const norm = file.split('\\').join('/');
    if (norm.startsWith('src/vr/') || norm.endsWith('src/tools/vrLab.js')) continue;
    assert.doesNotMatch(read(file), importVr, norm);
  }
  assert.match(read('play/index.html'), /src="\/src\/main\.js"/);
  assert.doesNotMatch(read('play/index.html'), /src\/vr\//);
});

test('vr-dungeon.html is a build input, and the upstream publish workflows stay repository-guarded', async () => {
  const input = Object.values((await import('../../vite.config.js')).default.build.rollupOptions.input);
  assert.ok(input.includes('vr-dungeon.html'));
  assert.ok(input.includes('vr.html'));
  for (const file of ['.github/workflows/deploy.yml', '.github/workflows/relay-deploy.yml', '.github/workflows/release-desktop.yml']) {
    assert.match(read(file), /github\.repository == 'Lattymoy\/daggerfall-js-source'/, file);
  }
});

test('UI presence reads the engine only through the bridge, and the hooks are still exported', async () => {
  const presence = read('src/vr/uiPresence.js');
  const bridge = read('src/vr/engineBridge.js');
  assert.match(presence, /from ['"]\.\/engineBridge\.js['"]/);
  for (const spec of ['../ui/', '../scenes/', '../player/', '../systems/', '../render/', '../world/']) {
    const body = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(presence, new RegExp(`from ['"]${body}`), spec);
  }
  assert.doesNotMatch(bridge, /from ['"]\.\.\/ui\//);
  assert.match(bridge, /import\('\.\.\/ui\/input\.js'\)/);
  assert.match(bridge, /import\('\.\.\/ui\/enhanced\/enhancedOverlays\.js'\)/);
  assert.doesNotMatch(bridge, /windowStack/);
  assert.doesNotMatch(presence, /windowStack/);
  assert.doesNotMatch(presence, /observeStack/);
  assert.doesNotMatch(presence, /startsWith\(\s*['"]enhanced-/);
  for (const file of jsFiles('src/vr')) {
    const text = read(file);
    assert.doesNotMatch(text, /\.paused\s*\(/, file);
    assert.doesNotMatch(text, /\[['"]paused['"]\]/, file);
  }
  const probe = await probeVrUiHooks();
  assert.deepEqual(probe.missing, [], probe.missing.join(', '));
  assert.equal(probe.ok, true);
  const dungeon = read('src/vr/vrDungeon.js');
  assert.doesNotMatch(dungeon, /from ['"]\.\/uiPresence\.js['"]/);
  assert.doesNotMatch(dungeon, /observeStack/);
  assert.match(dungeon, /uiOverlayActive/);
  const flag = dungeon.indexOf("pageHas('vrui')");
  assert.ok(flag > 0);
  assert.match(dungeon.slice(flag, flag + 700), /import\('\.\/uiPresence\.js'\)/);
  assert.match(dungeon.slice(flag, flag + 700), /publishedOpen/);
});

test('the upstream contract workflow is manual, fetches public upstream, and does not publish', () => {
  const wf = read('.github/workflows/vr-upstream-contract.yml');
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /\n\s+push:/);
  assert.doesNotMatch(wf, /\n\s+schedule:/);
  assert.doesNotMatch(wf, /\n\s+pull_request:/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.match(wf, /https:\/\/github.com\/Lattymoy\/daggerfall-js-source\.git/);
  assert.match(wf, /node --test test\/vr\/engineContract\.test\.js/);
  assert.match(wf, /persist-credentials:\s*false/);
});
