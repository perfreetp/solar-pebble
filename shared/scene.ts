import type { Entity, Joint, LayerId, SceneData } from './types';
import { PART_MAP } from './parts';

let seq = 0;
export function uid(prefix = 'e'): string {
  seq++;
  return `${prefix}-${Date.now().toString(36).slice(-4)}${seq.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export const DEFAULT_LAYERS: Record<LayerId, { visible: boolean; locked: boolean }> = {
  tube: { visible: true, locked: false },
  connector: { visible: true, locked: false },
  board: { visible: true, locked: false },
  carton: { visible: true, locked: false },
  hardware: { visible: true, locked: false },
};

/**
 * A fully assembled 1890×1390 knock-down bed frame plus a separate packing pose.
 * All coordinates in mm; pos is the bottom-centre anchor.
 */
export function buildStarterScene(): SceneData {
  const entities: Entity[] = [];
  const joints: Joint[] = [];
  const add = (defId: string, x: number, y: number, z: number, rot = 0, extra: Partial<Entity> = {}) => {
    const e: Entity = { uid: uid(), defId, pos: { x, y, z }, rot, ...extra };
    entities.push(e);
    return e;
  };
  const join = (a: string, b: string) => joints.push({ a, b });

  // ---- assembled bed ----
  const HL = 945;   // half length along x
  const HW = 670;   // half width  along y
  const LEG_TOP = 372;
  const RAIL_Z = LEG_TOP;          // rail bottom
  const CONN_Z = LEG_TOP - 10;     // connector bottom (overlaps leg top by 10)
  const BOARD_Z = CONN_Z + 60;     // connector top = 422

  const corners = [
    { x: -HL, y: -HW },
    { x: HL, y: -HW },
    { x: HL, y: HW },
    { x: -HL, y: HW },
  ];

  const pads: Entity[] = [];
  const legs: Entity[] = [];
  const conns: Entity[] = [];
  for (const c of corners) {
    pads.push(add('foot-pad', c.x, c.y, 0));
    legs.push(add('leg', c.x, c.y, 22));
    conns.push(add('conn-corner', c.x, c.y, CONN_Z, 0));
  }
  corners.forEach((_, i) => {
    join(pads[i].uid, legs[i].uid);
    join(legs[i].uid, conns[i].uid);
  });

  // side rails run full length along x
  const sideA = add('tube-side', 0, -HW, RAIL_Z);
  const sideB = add('tube-side', 0, HW, RAIL_Z);
  // end rails run along y between the side rails (length 1290)
  const endA = add('tube-end', -HL, 0, RAIL_Z, 90);
  const endB = add('tube-end', HL, 0, RAIL_Z, 90, { size: { w: 1290, d: 50, h: 50 } });

  join(sideA.uid, conns[0].uid); join(sideA.uid, conns[1].uid);
  join(sideB.uid, conns[3].uid); join(sideB.uid, conns[2].uid);
  join(endA.uid, conns[0].uid); join(endA.uid, conns[3].uid);
  join(endB.uid, conns[1].uid); join(endB.uid, conns[2].uid);
  // rails share the same corner connector, so they never collide
  join(sideA.uid, endA.uid); join(sideA.uid, endB.uid);
  join(sideB.uid, endA.uid); join(sideB.uid, endB.uid);

  // centre support beam between the two end rails, with tee connectors
  const mid = add('tube-mid', 0, 0, RAIL_Z + 5);
  const teeA = add('conn-tee', -900, 0, CONN_Z, 0);
  const teeB = add('conn-tee', 900, 0, CONN_Z, 0);
  join(mid.uid, teeA.uid); join(mid.uid, teeB.uid);
  join(teeA.uid, endA.uid); join(teeB.uid, endB.uid);

  // two boards resting on the rails
  const b1 = add('board-slat', 0, -350, BOARD_Z, 0, { size: { w: 1890, d: 690, h: 18 } });
  const b2 = add('board-slat', 0, 350, BOARD_Z, 0, { size: { w: 1890, d: 690, h: 18 } });
  join(b1.uid, sideA.uid); join(b2.uid, sideB.uid);
  join(b1.uid, b2.uid);

  // headboard: two posts, a cross bar and a shelf
  const headY = HW + 75;
  const postL = add('post-head', -670, headY, BOARD_Z);
  const postR = add('post-head', 670, headY, BOARD_Z);
  const bar = add('bar-head', 0, headY, BOARD_Z + 660);
  join(bar.uid, postL.uid); join(bar.uid, postR.uid);
  const shelf = add('board-shelf', 0, headY + 25, BOARD_Z + 660 + 38, 0, { size: { w: 1290, d: 180, h: 18 } });
  join(shelf.uid, postL.uid); join(shelf.uid, postR.uid);

  // small hardware parts laid out on the boards
  const boltA = add('bolt-m8', 300, -300, BOARD_Z + 18);
  const boltB = add('bolt-m8', 360, -300, BOARD_Z + 18);

  // ---- packing pose, offset far from the bed ----
  const PX = 3600;
  const PY = -400;
  const cTubeA = add('carton-tube', PX, PY, 0);
  const cTubeB = add('carton-tube', PX, PY + 250, 0);
  const cBoard = add('carton-board', PX + 2450, PY + 600, 0);
  add('carton-small', PX + 2000, PY + 1500, 0);
  // a small carton stacked on top of the board carton
  const cSmallTop = add('carton-small', PX + 2450, PY + 600, 120);
  join(cSmallTop.uid, cBoard.uid);

  void cTubeA; void cTubeB;

  return {
    version: 1,
    project: 'KD-1500 钢管床架',
    projectCode: 'KD1500-2026',
    entities,
    joints,
    layers: structuredClone(DEFAULT_LAYERS),
  };
}

export function layerOf(defId: string): LayerId | null {
  return (PART_MAP[defId]?.category as LayerId) ?? null;
}

export function cloneScene(s: SceneData): SceneData {
  return JSON.parse(JSON.stringify(s));
}
