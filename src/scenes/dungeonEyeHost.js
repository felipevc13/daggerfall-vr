// VR1 - the dungeon's door onto the headset, in the fishHost shape.
//
// bootDungeon calls paintDungeonEyes with the frame's one paint. When
// /play/?vr has published a per-eye painter on the frame clock, that painter
// runs and the paint is called once per eye. Otherwise the paint runs once,
// which is the flat frame and the clock's mono copy. This file does not
// import src/vr. A page without ?vr never creates the clock, so the paint
// runs once exactly as it did.

/**
 * @param {(shot: { proj: unknown, view: unknown, eye?: number[], yaw?: number, index?: number }) => void} paint
 * @param {{ proj: unknown, view: unknown, eye?: number[], yaw?: number }} camera the flat camera, used when no eye is available
 * @returns {boolean} true when every eye was drawn by the seam
 */
export function paintDungeonEyes(paint, camera) {
  const eyes = globalThis.__xrFrameClock?.dungeonEyes;
  if (typeof eyes !== 'function') {
    paint(camera?.index == null ? { ...camera, index: 0 } : camera);
    return false;
  }
  let drew = false;
  let ok = false;
  try {
    ok = eyes((shot) => { drew = true; paint(shot); }, camera) === true;
  } catch (err) {
    if (drew) throw err;
    ok = false;
  }
  if (!ok && !drew) paint({ ...camera, index: 0 });
  return ok;
}
