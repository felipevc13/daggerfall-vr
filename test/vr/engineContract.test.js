// The VR mod's contract with the DFO engine. Headless: no WebGL, no ARENA2,
// no headset. An upstream merge that deletes a hook fails here, and the flat
// game's entry is pinned so it cannot start importing src/vr by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
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

/** Every dynamic import in `src`, and whether it sits in the consequent of `params.has('vr')`. */
function dynamicImports(src) {
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  const children = (n, visit) => {
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) for (const x of v) visit(x);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  const record = (n, underVrIf) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'ImportExpression') {
      out.push({ source: n.source?.type === 'Literal' ? n.source.value : null, underVrIf });
      return;
    }
    if (n.type === 'IfStatement') { walk(n); return; }
    children(n, (x) => record(x, underVrIf));
  };
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'IfStatement') {
      const test = n.test;
      const vrFlag = test?.type === 'CallExpression'
        && test.callee?.type === 'MemberExpression'
        && test.callee.computed !== true
        && test.callee.property?.name === 'has'
        && test.callee.object?.type === 'Identifier'
        && test.callee.object.name === 'params'
        && test.arguments?.length === 1
        && test.arguments[0]?.type === 'Literal'
        && test.arguments[0].value === 'vr';
      walk(n.test);
      record(n.consequent, vrFlag);
      if (n.alternate) walk(n.alternate);
      return;
    }
    if (n.type === 'ImportExpression') {
      out.push({ source: n.source?.type === 'Literal' ? n.source.value : null, underVrIf: false });
      return;
    }
    children(n, walk);
  };
  walk(ast);
  return out;
}

function staticSpecs(src) {
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  return ast.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value);
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
    assert.doesNotMatch(text, /from ['"]\.\.\/render\/renderer\.js['"]/, file);
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

test('vr.html is a build input, and the upstream publish workflows stay repository-guarded', async () => {
  const input = Object.values((await import('../../vite.config.js')).default.build.rollupOptions.input);
  assert.ok(input.includes('vr.html'));
  assert.equal(input.includes('vr-dungeon.html'), false);
  assert.match(read('src/vr/xrInput.js'), /updateLocomotion/);
  assert.match(read('src/vr/xrInput.js'), /toMotorInput/);
  for (const file of ['.github/workflows/deploy.yml', '.github/workflows/relay-deploy.yml', '.github/workflows/release-desktop.yml']) {
    assert.match(read(file), /github\.repository == 'Lattymoy\/daggerfall-js-source'/, file);
  }
});

test('main.js imports installVr only dynamically, and only when the URL has ?vr', () => {
  // A flat /play/ must not fetch src/vr. The door is one literal import() so a
  // scanner can see it: a concatenated path, a static `from`, or an import
  // outside `params.has('vr')` fails here. GL-LEAK still owns the line after
  // `new Renderer`; this door sits on the boot's one URLSearchParams.
  const main = read('src/main.js');
  assert.match(main, /const renderer = new Renderer\(canvas\);\n\s*onPageGone\(\(\) => \{ pageGoing = true; loseGlContext\(renderer\.gl\); \}\);/);
  assert.match(main, /if \(params\.has\('vr'\)\) import\('\.\/vr\/installVr\.js'\)\.then\(\(\{ installVr \}\) => installVr\(renderer\)\)\.catch\(\(\) => \{\}\);/);
  assert.equal([...main.matchAll(/['"]\.\/vr\/installVr\.js['"]/g)].length, 1);

  const doors = dynamicImports(main);
  assert.ok(doors.every((d) => typeof d.source === 'string'), 'a dynamic import built at runtime would hide the module from this scan');
  assert.deepEqual(
    doors.filter((d) => d.source.includes('/vr/')),
    [{ source: './vr/installVr.js', underVrIf: true }],
  );
  assert.deepEqual(staticSpecs(main).filter((s) => s.includes('/vr/')), []);

  const spec = /(?:from\s+|import\s*\(\s*)['"]([^'"]*\/vr\/[^'"]+)['"]/g;
  const hits = [];
  for (const file of jsFiles('src')) {
    const norm = file.split('\\').join('/');
    if (norm.startsWith('src/vr/') || norm.endsWith('src/tools/vrLab.js')) continue;
    for (const m of read(file).matchAll(spec)) hits.push(`${norm} -> ${m[1]}`);
  }
  assert.deepEqual(hits, ['src/main.js -> ./vr/installVr.js']);
  assert.doesNotMatch(read('play/index.html'), /src\/vr\//);
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
  // The Privateer's Hold page that booted this detector under ?vrui is gone.
  // The detector stays. /play/ does not import it.
  assert.doesNotMatch(read('src/main.js'), /uiPresence/);
});

test('the air resolve follows the eye the bridge aimed, and the dungeon does not import src/vr', () => {
  const renderer = read('src/render/renderer.js');
  const air = read('src/render/airPass.js');
  assert.match(renderer, /_aimXrResolve\(\) \{/);
  assert.match(renderer, /xrWorldImageSize/);
  assert.match(renderer, /gl\.scissor\(0, 0, v\.width, v\.height\)/);
  assert.match(renderer, /_vrEye: true/);
  assert.match(renderer, /if \(this\._xrTarget\?\.vp\)/);
  assert.match(air, /if \(_vp && _vp\.width > 0 && _vp\.height > 0\) gl\.viewport\(_vp\.x, _vp\.y, _vp\.width, _vp\.height\);/);
  assert.match(air, /else gl\.viewport\(0, 0, F\.w, F\.h\);/);
  assert.match(read('src/vr/engineBridge.js'), /_aimXrResolve/);
  assert.match(read('src/vr/installVr.js'), /clock\.dungeonEyes/);
  assert.doesNotMatch(read('src/scenes/dungeon.js'), /\/vr\//);
  assert.doesNotMatch(read('src/scenes/dungeonEyeHost.js'), /\/vr\//);
  assert.match(read('src/vr/xrFrameLoop.js'), /claimStereo/);
  assert.match(read('src/vr/xrFrameLoop.js'), /questSampleOf/);
  assert.match(read('src/vr/engineBridge.js'), /export function readQuestMotor/);
  assert.doesNotMatch(read('src/scenes/dungeonQuestInput.js'), /from ['"][^'"]*\/vr\//);
  assert.match(read('src/scenes/dungeon.js'), /applyDungeonQuestInput\(/);
});

test('the frame clock lives in src/vr and aims the existing eye hook', () => {
  const loop = read('src/vr/xrFrameLoop.js');
  const plug = read('src/vr/installVr.js');
  for (const file of [loop, plug]) {
    assert.doesNotMatch(file, /from ['"]\.\.\/render\//);
    assert.doesNotMatch(file, /from ['"]\.\.\/scenes\//);
    assert.doesNotMatch(file, /from ['"]\.\.\/world\//);
    assert.doesNotMatch(file, /from ['"]\.\.\/systems\/frameCap/);
  }
  assert.match(plug, /guardedSetXrTarget/);
  assert.doesNotMatch(plug, /syncCanvasToLayer\s*\(/);
  assert.match(loop, /session\.requestAnimationFrame/);
  assert.match(loop, /setTarget/);
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
