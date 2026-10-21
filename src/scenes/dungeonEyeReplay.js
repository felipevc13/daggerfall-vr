// VR1 - the dungeon's second eye.
//
// drawFoes already simulated this frame: AI, attacks, the water clock, the
// loot flats, the HUD. This redraws the pictures that depend on the camera.
// It does not tick. The weapon coroutine is not resumed, so a swing steps
// once per frame. Level flats are drawn by the host, facing the body yaw.

/** @param {object} bag the pictures drawFoes left, plus this eye's matrices */
export function replayDungeonDraw(bag) {
  const renderer = bag?.renderer;
  if (!renderer) return;
  const view = bag.view;
  const right = new Float32Array([-view[0], -view[4], -view[8]]);
  const up = bag.up;
  const npcLane = bag.npcLane;
  if (npcLane) {
    renderer.beginCharacterSpriteBatch?.();
    try { npcLane.draw(bag.canvas, { proj: bag.proj, view, eye: bag.eye }); }
    finally { renderer.flushCharacterSpriteBatch?.(); }
  }
  const boards = bag.billboards;
  if (boards?.corpses?.length) renderer.drawBillboards(boards.corpses, right, up);
  const flats = [...(boards?.mobiles ?? []), ...(boards?.drops ?? []), ...(boards?.spells ?? [])];
  if (flats.length) renderer.drawBillboards(flats, right, up);
  bag.drawFx?.();
  npcLane?.drawVeiled?.();
  bag.lateWorldDraw?.();
  if (bag.waterQuads?.length && bag.waterArchive != null) {
    renderer.drawWater(bag.waterQuads, bag.waterColor, renderer.textures.get(`${bag.waterArchive}_0`), bag.waterT * bag.waterScroll);
  }
  bag.csaDrawParticlesBlended?.();
  if (bag.playerFeet) bag.weaponRig?.draw?.({ paralyzed: !!bag.paralyzed, resume: false });
}
