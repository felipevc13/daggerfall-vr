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
  readmeFirstLine: '# Daggerfall VR — Standalone WebXR Edition',
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
  // world219's recorded hash is upstream's bundle. perspectiveOffCenter in
  // src/world/mat4.js is in the relay graph, so this fork's bytes differ.
  // Do not bump RELAY_VERSION: that would name a relay this fork does not deploy.
  relayLawHash: {
    world219: '69a9afa6ee5d2eaca907c9b7b51347f2283e3f3a905c72f80abd29a7888a196a',
  },
};
