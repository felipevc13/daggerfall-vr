// VR1 - which path drew this headset frame. One line, when the path changes.
// title: the page, on the world-locked quad.
// fallback-monitor: the eye picture, on that same quad (outdoors, interiors).
// dungeon-stereo: each eye drawn by the dungeon camera.
// mono-copy: eye 0 copied flat into the other eyes.

import { relayVrLog } from './xrLog.js';

let told = '';

export function noteVrPath(path) {
  const name = String(path || '');
  if (!name || name === told) return;
  told = name;
  try { relayVrLog('info', `vr-panel:path=${name}`); } catch { /* the frame still drew */ }
}
