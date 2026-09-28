// ============================================================
// 形状処理: 2D輪郭 → 押し出し → 和・差 (manifold-3d を使用)
// ============================================================
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import opentype from 'opentype.js';
import { SHAPES, FONT_URL, TEXT_DEFAULT_HEIGHT } from './config.js';

let M = null; // { Manifold, CrossSection }
let font = null;

export async function initGeometry(onProgress) {
  const wasm = await Module({ locateFile: () => wasmUrl });
  wasm.setup();
  M = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection };
  onProgress?.('font');
  const res = await fetch(FONT_URL);
  font = opentype.parse(await res.arrayBuffer());
}

// ---------- 2D 断面 (キャッシュ) ----------
const csCache = new Map();

function shapeDef(id) {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}

/** 図形の断面 (幅1×奥行1、中心原点) */
function shapeCS(id) {
  const key = 'shape:' + id;
  if (!csCache.has(key)) {
    const def = shapeDef(id);
    csCache.set(key, { cs: new M.CrossSection(def.contours, def.fillRule ?? 'NonZero'), w0: 1, d0: 1 });
  }
  return csCache.get(key);
}

function flatten(commands, seg = 6) {
  const polys = [];
  let cur = null;
  let px = 0, py = 0;
  const push = (x, y) => { cur.push([x, -y]); px = x; py = y; };
  for (const c of commands) {
    if (c.type === 'M') { cur = []; polys.push(cur); push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') {
      const x0 = px, y0 = py;
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, u = 1 - t;
        push(u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * c.y1 + t * t * c.y);
      }
    } else if (c.type === 'C') {
      const x0 = px, y0 = py;
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, u = 1 - t;
        push(
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
    } else if (c.type === 'Z') { cur = null; }
  }
  return polys.filter((p) => p.length >= 3);
}

/** 文字の断面 (自然な大きさ、中心原点) */
export function textCS(text) {
  const key = 'text:' + text;
  if (!csCache.has(key)) {
    // 行の高さがおよそ TEXT_DEFAULT_HEIGHT になるフォントサイズ
    const size = TEXT_DEFAULT_HEIGHT / 0.8;
    const lines = (text || ' ').split('\n');
    const polys = [];
    lines.forEach((line, i) => {
      const path = font.getPath(line, 0, i * size * 1.2, size);
      polys.push(...flatten(path.commands));
    });
    let cs = polys.length ? new M.CrossSection(polys, 'NonZero') : M.CrossSection.square([4, 4], true);
    if (cs.isEmpty()) cs = M.CrossSection.square([4, 4], true);
    const b = cs.bounds();
    const centered = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]);
    csCache.set(key, { cs: centered, w0: b.max[0] - b.min[0], d0: b.max[1] - b.min[1] });
  }
  return csCache.get(key);
}

export function textNaturalSize(text) {
  const { w0, d0 } = textCS(text);
  return [w0, d0];
}

function baseCS(item) {
  return item.type === 'text' ? textCS(item.text) : shapeCS(item.shape);
}

// ---------- 3D ----------

/** 部品1つを、自分の座標系 (中心原点・回転なし・拡大前) で立体化する。
 *  表示では、これを scale(w/w0, d/d0) して使う */
export function baseManifold(item) {
  if (item.type === 'group') return groupLocal(item);
  return baseCS(item).cs.extrude(item.h);
}

/** 拡大前の大きさ [w0, d0] */
export function baseSize(item) {
  if (item.type === 'group') return [item.w0, item.d0];
  const { w0, d0 } = baseCS(item);
  return [w0, d0];
}

/** 部品を親の座標系に置いた立体 */
function placedManifold(item) {
  if (item.type === 'group') {
    const g = groupLocal(item);
    return g.scale([item.w / item.w0, item.d / item.d0, item.sz ?? 1]).rotate([0, 0, item.rot]).translate([item.x, item.y, 0]);
  }
  const { cs, w0, d0 } = baseCS(item);
  return cs.scale([item.w / w0, item.d / d0]).rotate(item.rot).translate([item.x, item.y]).extrude(item.h);
}

/** 複数の部品を ソリッドは和、穴は差 で1つにする */
export function combine(items) {
  const solids = items.filter((i) => !i.hole).map(placedManifold);
  const holes = items.filter((i) => i.hole).map(placedManifold);
  let result = solids.length ? M.Manifold.union(solids) : new M.Manifold();
  if (holes.length && solids.length) {
    result = M.Manifold.difference(result, M.Manifold.union(holes));
  }
  return result;
}

/** グループの中身 (グループ自身の座標系、拡大前) */
const groupCache = new Map();
function groupLocal(group) {
  const key = JSON.stringify(group.children);
  if (!groupCache.has(key)) groupCache.set(key, combine(group.children));
  return groupCache.get(key);
}

/** グループの中身の高さ (グループ自身の高さ方向の拡大 sz をかける前) */
export function groupHeight(group) {
  const m = groupLocal(group);
  if (m.isEmpty()) return 0;
  return m.boundingBox().max[2];
}

/** 部品の実際の厚さ (グループは拡大後の一番厚い部分) */
export function itemThickness(item) {
  if (item.type !== 'group') return item.h;
  return groupHeight(item) * (item.sz ?? 1);
}

/** 部品の中で一番うすいソリッド部分の厚さ (拡大後) */
export function thinnestSolid(item) {
  if (item.type !== 'group') return item.h;
  const solids = item.children.filter((c) => !c.hole);
  if (!solids.length) return itemThickness(item);
  return Math.min(...solids.map(thinnestSolid)) * (item.sz ?? 1);
}

/** 立体 → 三角形データ */
export function toMesh(manifold) {
  const mesh = manifold.getMesh();
  const np = mesh.numProp;
  const n = mesh.vertProperties.length / np;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = mesh.vertProperties[i * np];
    pos[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    pos[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions: pos, indices: mesh.triVerts };
}

/** SVG アイコン用の輪郭パス */
export function shapeSvgPath(def) {
  return def.contours
    .map((c) => 'M' + c.map(([x, y]) => `${(x * 20 + 12).toFixed(2)},${(12 - y * 20).toFixed(2)}`).join('L') + 'Z')
    .join(' ');
}
