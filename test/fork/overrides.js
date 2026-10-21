// FORK OVERRIDES (felipevc13/daggerfall-vr).
//
// One module. Upstream's law pins stay in the tests that own them, in the
// branch that runs when a key here is absent. A merge that deletes this
// file, or a key, puts that pin back. Do not delete the tests.
//
// Why these differ is docs/fork-ci.md. The flat game is not one of them.

/** @type {const} */
export const FORK = {
  // The README is this fork's door. Every other brand surface stays "DFO Online".
  readmeFirstLine: '# Daggerfall VR',
  // Skip the upstream tagline, the trademark paragraph, and the support-ask
  // URLs on README.md only. SUPPORT.md, the landing page, and FUNDING.yml stay.
  readmeIsModDoor: true,
  // 6a8091ae0c: a push to this fork's main must not deploy upstream's relay
  // or cut an upstream desktop release. The workflows stay; the push trigger does not.
  relayDeployOnPush: false,
  desktopReleaseOnPush: false,
  // The checkout's stamp, pinned exactly. Upstream's pin is UPDATE = null.
  committedBuildTag: '5c45e954c4a9',
  committedUpdate: '0.0.262',
  // The recorded row for the current RELAY_VERSION stays upstream's bytes.
  // perspectiveOffCenter in src/world/mat4.js is the only file in the relay
  // graph this fork changes (world237, 2026-10-21 sync; it was world219),
  // so this checkout's hash differs. Do not bump RELAY_VERSION: that would
  // name a relay this fork does not deploy. Move the key when upstream
  // moves RELAY_VERSION, and recompute the hash in the same commit.
  relayLawHash: {
    world237: '6086485b8bb262a21e9407765f7c438c76d48a2afda8100a362f23f454b14f50',
  },
};
