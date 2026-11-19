// 轴测投影数学:世界坐标 (x,y,z) -> 屏幕坐标,支持 4 个轴测角与俯视图
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

export function makeProjector(camera) {
  const a = ((camera.angle % 4) + 4) % 4 * Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const top = !!camera.top;

  // 世界 -> 屏幕
  function project(x, y, z = 0) {
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    if (top) return [rx, ry];
    return [(rx - ry) * COS30, (rx + ry) * SIN30 - z];
  }

  // 屏幕 -> 高程 z 处的地面世界坐标
  function unprojectGround(sx, sy, z = 0) {
    let rx, ry;
    if (top) {
      rx = sx; ry = sy;
    } else {
      const u = sx / COS30;       // rx - ry
      const v = (sy + z) / SIN30; // rx + ry
      rx = (u + v) / 2;
      ry = (v - u) / 2;
    }
    return [rx * c + ry * s, -rx * s + ry * c];
  }

  // 画家算法深度(越大越靠前,后绘制)
  function depth(x, y, z = 0) {
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    return top ? z : rx + ry + z;
  }

  // 世界坐标轴单位向量在屏幕上的投影(长度恒为 1,便于把屏幕位移换算成世界位移)
  function axisDir(axis) {
    const o = project(0, 0, 0);
    const p = axis === 'x' ? project(1, 0, 0) : axis === 'y' ? project(0, 1, 0) : project(0, 0, 1);
    const dx = p[0] - o[0];
    const dy = p[1] - o[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  }

  // 侧面外法线(世界系)是否朝向镜头
  function normalVisible(nx, ny) {
    if (top) return false;
    const rx = nx * c - ny * s;
    const ry = nx * s + ny * c;
    return rx + ry > 1e-9;
  }

  return { project, unprojectGround, depth, axisDir, normalVisible, top };
}

// 地面上半径 r 的圆在当前投影下的路径(轴测下为椭圆)
export function groundCirclePath(project, cx, cy, r, z = 0, seg = 32) {
  let d = '';
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const [sx, sy] = project(cx + r * Math.cos(t), cy + r * Math.sin(t), z);
    d += (i === 0 ? 'M' : 'L') + sx.toFixed(2) + ',' + sy.toFixed(2);
  }
  return d + 'Z';
}

export function ptsStr(pts) {
  return pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
}
