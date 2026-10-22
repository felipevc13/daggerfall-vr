// The Enter VR plaque follows the door that is actually on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnterChrome, attachEnterChrome, enterChromeState, expectsFrontDoor } from '../../src/vr/enterChrome.js';

test('Enter VR waits for the main menu, and the loader is only the wait before it', () => {
  assert.equal(expectsFrontDoor(''), true);
  assert.equal(expectsFrontDoor('?vr'), true);
  assert.equal(expectsFrontDoor('?vr&begin'), false);
  assert.equal(expectsFrontDoor('?dungeon=Privateer'), false);

  const loading = enterChromeState({});
  assert.equal(loading.role, 'loading');
  assert.equal(loading.button, false);
  assert.equal(loading.loading, true);

  const gate = enterChromeState({ intro: true });
  assert.equal(gate.role, 'hidden');
  assert.equal(gate.button, false);
  assert.equal(gate.loading, false);

  const fade = enterChromeState({ intro: true, menu: true, seenDoor: true });
  assert.equal(fade.role, 'hidden');
  assert.equal(fade.button, false);

  const menu = enterChromeState({ menu: true, seenDoor: true });
  assert.equal(menu.role, 'enter');
  assert.equal(menu.button, true);
  assert.equal(menu.loading, false);

  const playing = enterChromeState({ seenDoor: true });
  assert.equal(playing.role, 'hidden');
  assert.equal(playing.loading, false);
  assert.equal(playing.button, false);

  const exit = enterChromeState({ session: true, seenDoor: true });
  assert.equal(exit.role, 'exit');
  assert.equal(exit.button, true);
  assert.equal(exit.loading, false);

  const probe = enterChromeState({ expectDoor: false });
  assert.equal(probe.role, 'enter');
  assert.equal(probe.loading, false);

  const button = { hidden: false, style: { display: '' } };
  const loader = { hidden: true };
  applyEnterChrome(button, loader, loading);
  assert.equal(button.hidden, true);
  assert.equal(button.style.display, 'none');
  assert.equal(loader.hidden, false);
  applyEnterChrome(button, loader, menu);
  assert.equal(button.hidden, false);
  assert.equal(button.style.display, '');
  assert.equal(loader.hidden, true);
});

test('the plaque follows the door nodes the page actually has', () => {
  const nodes = {};
  let watch = null;
  const button = { hidden: false, style: { display: '' } };
  const loader = { hidden: true };
  const doc = {
    body: {},
    getElementById(id) {
      const el = nodes[id];
      return el && el.isConnected !== false ? el : null;
    },
    defaultView: {
      MutationObserver: class {
        constructor(cb) { watch = cb; }
        observe() {}
        disconnect() { watch = null; }
      },
    },
  };
  const chrome = attachEnterChrome({ doc, button, loader, expectDoor: () => true });
  assert.equal(button.style.display, 'none');
  assert.equal(loader.hidden, false);
  assert.equal(typeof watch, 'function');

  nodes.intro = { isConnected: true };
  watch();
  assert.equal(button.style.display, 'none');
  assert.equal(loader.hidden, true);

  nodes['enhanced-menu'] = { isConnected: true };
  watch();
  assert.equal(button.style.display, 'none', 'the menu is mounted while the film is still up');

  nodes.intro.isConnected = false;
  watch();
  assert.equal(button.style.display, '');
  assert.equal(button.hidden, false);
  assert.equal(loader.hidden, true);

  nodes['enhanced-menu'].isConnected = false;
  watch();
  assert.equal(button.style.display, 'none');
  assert.equal(loader.hidden, true);

  chrome.setSession(true);
  assert.equal(button.style.display, '');
  chrome.stop();
  assert.equal(watch, null);
});