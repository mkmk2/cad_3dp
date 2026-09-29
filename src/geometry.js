// ============================================================
// 形状処理: 2D輪郭 → 押し出し → 和・差 (manifold-3d を使用)
// ============================================================
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import opentype from 'opentype.js';
import { SHAPES, TEMPLATES, FONT_URL, TEXT_DEFAULT_HEIGHT, SHAPE_ROUND_RADIUS } from './config.js';

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

/** 凸の角 (とがった所) と 凹の角 (くぼみ) の両方を半径 r で丸める */
function roundCorners(cs, r, seg = 48) {
  return cs.offset(-r, 'Round', 2, seg).offset(r, 'Round', 2, seg)
    .offset(r, 'Round', 2, seg).offset(-r, 'Round', 2, seg);
}

/** 角を丸める基本図形か */
export function isSizeDependent(item) {
  return item.type === 'shape' && !!SHAPES.find((s) => s.id === item.shape)?.round;
}

/** 角を丸めた基本図形の断面。丸みの半径を mm でそろえるため、実際の大きさで作る */
const sizedCache = new Map();
function roundedShapeCS(item) {
  const w = Math.round(item.w * 100) / 100, d = Math.round(item.d * 100) / 100;
  const key = `${item.shape}:${w}:${d}`;
  if (!sizedCache.has(key)) {
    if (sizedCache.size > 300) {
      // たまりすぎたら古いものを捨てる
      for (const v of sizedCache.values()) v.cs.delete();
      sizedCache.clear();
    }
    const def = shapeDef(item.shape);
    const base = new M.CrossSection(def.contours, def.fillRule ?? 'NonZero').scale([w, d]);
    const r = Math.min(SHAPE_ROUND_RADIUS, Math.min(w, d) / 6);
    let cs = roundCorners(base, r, 24);
    // とがった角を丸めると外形が少し小さくなるので、指定の大きさに合わせ直す
    const b = cs.bounds(), ob = base.bounds();
    cs = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2])
      .scale([(ob.max[0] - ob.min[0]) / (b.max[0] - b.min[0]), (ob.max[1] - ob.min[1]) / (b.max[1] - b.min[1])])
      .translate([(ob.min[0] + ob.max[0]) / 2, (ob.min[1] + ob.max[1]) / 2]);
    sizedCache.set(key, { cs, w0: w, d0: d });
  }
  return sizedCache.get(key);
}

/** 図形の断面 (幅1×奥行1、中心原点) */
function shapeCS(id) {
  const key = 'shape:' + id;
  if (!csCache.has(key)) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (tpl) {
      csCache.set(key, { cs: templateCS(tpl), w0: 1, d0: 1 });
    } else {
      const def = shapeDef(id);
      csCache.set(key, { cs: new M.CrossSection(def.contours, def.fillRule ?? 'NonZero'), w0: 1, d0: 1 });
    }
  }
  return csCache.get(key);
}

/** 土台テンプレートの外形 (実寸 mm、中心原点、カド丸済み。穴はまだあけない) */
function templateOutline(tpl) {
  const [w, d] = tpl.size;
  const SEG = 48;
  const C = M.CrossSection;
  const circle = (r, x, y) => C.circle(r, SEG).translate([x, y]);
  // 凸の角 (とがった所) と 凹の角 (くぼみ) の両方を半径 r で丸める
  const roundAll = (cs, r) => roundCorners(cs, r, SEG);
  let cs;
  if (tpl.outline === 'oval') {
    // 小判型: 両端が半円
    const r = Math.min(w, d) / 2;
    cs = C.square([Math.max(w - 2 * r, 0.01), Math.max(d - 2 * r, 0.01)], true).offset(r, 'Round', 2, SEG);
  } else if (tpl.outline === 'heart') {
    // ふっくらハート: なめらかな曲線 (ベジェ曲線) で右半分を描き、左右対称にする。
    // 下半分を外にふくらませて、文字や図形を入れやすくしている
    const bez = (p0, p1, p2, p3, n = 40) => Array.from({ length: n }, (_, i) => {
      const t = i / n, u = 1 - t;
      return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
    });
    const right = [
      ...bez([0, 0.28], [0, 0.45], [0.16, 0.52], [0.27, 0.5]),     // 上のくぼみ → 右の山
      ...bez([0.27, 0.5], [0.42, 0.48], [0.5, 0.38], [0.5, 0.2]),  // 右の山 → 右の肩
      ...bez([0.5, 0.2], [0.5, -0.08], [0.27, -0.4], [0, -0.5]),   // 右の肩 → 下の先 (ふくらませる)
    ];
    const left = right.slice(1).reverse().map(([x, y]) => [-x, y]);
    cs = roundAll(new C([[...right, [0, -0.5], ...left]], 'NonZero'), 0.03);
  } else if (tpl.outline === 'star') {
    // 星: 腕を太め (内側の半径 0.5) にして、先を丸める
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.5 : 0.5 * (tpl.inner ?? 0.5);
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    cs = roundAll(new C([pts], 'NonZero'), 0.04);
  } else if (tpl.outline === 'sakura') {
    // 桜: 5枚の花びら。花びらの先に小さな切れ込みを入れる
    const petals = [];
    for (let i = 0; i < 5; i++) {
      const deg = 90 + i * 72;
      const petal = C.hull([circle(0.06, 0, 0.05), circle(0.17, 0, 0.3)]);
      const notch = new C([[[0, 0.4], [-0.1, 0.56], [0.1, 0.56]]], 'NonZero');
      petals.push(C.difference(petal, notch).rotate(deg - 90));
    }
    cs = roundAll(C.union(petals), 0.025);
  } else {
    // カド丸の四角
    const r = Math.min(tpl.corner ?? 0, w / 2, d / 2);
    return C.square([w - 2 * r, d - 2 * r], true).offset(r, 'Round', 2, SEG);
  }
  // 単位の形を、指定の大きさ (w × d) にぴったり合わせる
  const b = cs.bounds();
  cs = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]);
  return cs.scale([w / (b.max[0] - b.min[0]), d / (b.max[1] - b.min[1])]);
}

/** 点 (x, y) から外形のいちばん近い縁までの距離 (外形の外なら負) */
function distanceToEdge(polys, x, y) {
  let min = Infinity, inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[j], [x2, y2] = poly[i];
      // 内外判定 (偶奇)
      if ((y2 > y) !== (y1 > y) && x < ((x1 - x2) * (y - y2)) / (y1 - y2) + x2) inside = !inside;
      // 線分までの距離
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      min = Math.min(min, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
    }
  }
  return inside ? min : -min;
}

/**
 * ストラップ穴の位置を決める。
 * hole.from から hole.dir の向きへ進み、穴のふち と 外形のふち の間が hole.margin (mm) になる所に置く
 * (金具やリングを付けやすいよう、縁の近くに穴をあける)
 */
export function resolveHole(tpl, outline = templateOutline(tpl)) {
  const h = tpl.hole;
  if (h.x != null) return h;
  const polys = outline.toPolygons();
  const r = h.d / 2;
  const [fx, fy] = h.from ?? [0, 0];
  const len = Math.hypot(...h.dir);
  const [ux, uy] = [h.dir[0] / len, h.dir[1] / len];
  const gap = (t) => distanceToEdge(polys, fx + ux * t, fy + uy * t) - r;
  // 少しずつ進み、縁との間が margin より狭くなる手前を細かく探す
  let t = 0;
  const step = 0.25;
  while (gap(t + step) >= h.margin && t < 200) t += step;
  let lo = t, hi = t + step;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (gap(m) >= h.margin) lo = m; else hi = m;
  }
  return { x: fx + ux * lo, y: fy + uy * lo, d: h.d };
}

/** 土台テンプレートの断面: 実寸 (mm) で外形とストラップ穴を作り、幅1×奥行1 に縮める */
function templateCS(tpl) {
  const [w, d] = tpl.size;
  const outline = templateOutline(tpl);
  let cs = outline;
  if (tpl.hole) {
    const h = resolveHole(tpl, outline);
    const hole = M.CrossSection.circle(h.d / 2, 32).translate([h.x, h.y]);
    cs = M.CrossSection.difference(cs, hole);
  }
  return cs.scale([1 / w, 1 / d]);
}

/** テンプレートの外形の点列 (確認用) */
export function templatePolygons(tpl) {
  return templateCS(tpl).scale(tpl.size.slice(0, 2)).toPolygons();
}

/** テンプレートの穴が外形から十分内側にあるか (テスト用): 穴のまわりの残りの幅 (mm) の最小値 */
export function templateHoleMargin(tpl) {
  const cs = templateOutline(tpl);
  const h = resolveHole(tpl, cs);
  let lo = 0, hi = 20;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    const ring = M.CrossSection.circle(h.d / 2 + m, 64).translate([h.x, h.y]);
    const inside = M.CrossSection.difference(ring, cs).area() < 1e-6;
    if (inside) lo = m; else hi = m;
  }
  return lo;
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
  if (item.type === 'text') return textCS(item.text);
  if (isSizeDependent(item)) return roundedShapeCS(item);
  return shapeCS(item.shape);
}

// ---------- 3D ----------

/** 「ほる」のくぼみの深さ (mm) */
export const CARVE_DEPTH = 1;

// ---------- 「ほる」の記録 ----------
// 「ほる」を押すと、ほる図形そのものは消え、その形が下にある図形の item.carves に記録される。
// 記録は図形ごとの「単位の座標」(幅1×奥行1、中心原点、回転前) の輪郭なので、
// あとで図形を動かす・回す・大きさを変えても、くぼみは一緒についてくる。

/**
 * 「ほる」の記録を順番に反映する。1回ごとに「その時の表面」から CARVE_DEPTH けずるので、
 * すでに ほった所をもう一度 ほると、さらに深くなる。
 * m: 立体 (図形自身の座標系、拡大前)、w0/d0: 単位の座標を拡大前の大きさに直す倍率、depth: 高さ方向の深さ
 */
function applyCarves(m, carves, w0, d0, depth = CARVE_DEPTH) {
  for (const c of carves ?? []) {
    if (m.isEmpty()) break;
    const area = new M.CrossSection(c.polys, 'NonZero').scale([w0, d0]).extrude(40).translate([0, 0, -20]);
    const surface = M.Manifold.difference(m, m.translate([0, 0, -depth]));
    m = M.Manifold.difference(m, M.Manifold.intersection(surface, area));
  }
  return m;
}

/** 部品1つを、自分の座標系 (中心原点・回転なし・拡大前) で立体化する。
 *  表示では、これを scale(w/w0, d/d0) して使う */
const leafCache = new Map();
export function baseManifold(item) {
  if (item.type === 'group') return groupLocal(item);
  const { cs, w0, d0 } = baseCS(item);
  if (!item.carves?.length) return cs.extrude(item.h);
  const key = JSON.stringify([item.type, item.shape, item.text, item.h, w0, d0, item.carves]);
  if (!leafCache.has(key)) {
    if (leafCache.size > 200) leafCache.clear();
    leafCache.set(key, applyCarves(cs.extrude(item.h), item.carves, w0, d0));
  }
  return leafCache.get(key);
}

/** 拡大前の大きさ [w0, d0] */
export function baseSize(item) {
  if (item.type === 'group') return [item.w0, item.d0];
  const { w0, d0 } = baseCS(item);
  return [w0, d0];
}

/** 部品の平面の形を、親の座標系に置いたもの */
function placedCS(item) {
  const { cs, w0, d0 } = baseCS(item);
  return cs.scale([item.w / w0, item.d / d0]).rotate(item.rot).translate([item.x, item.y]);
}

/** 部品を親の座標系に置いた立体 (「ほる」の記録も反映) */
function placedManifold(item) {
  if (item.type === 'group') {
    const g = groupLocal(item);
    return g.scale([item.w / item.w0, item.d / item.d0, item.sz ?? 1]).rotate([0, 0, item.rot]).translate([item.x, item.y, 0]);
  }
  if (!item.carves?.length) return placedCS(item).extrude(item.h);
  const [w0, d0] = baseSize(item);
  return baseManifold(item).scale([item.w / w0, item.d / d0, 1]).rotate([0, 0, item.rot]).translate([item.x, item.y, 0]);
}

/**
 * グループの中の図形から、親の座標系に置いた平面の形を集める (pick で選んだものだけ)。
 * グループの動き・拡大に合わせて変換する
 */
function collectPlaced(item, pick) {
  if (item.type === 'group') {
    const inner = item.children.flatMap((c) => collectPlaced(c, pick));
    return inner.map((cs) => cs.scale([item.w / item.w0, item.d / item.d0]).rotate(item.rot).translate([item.x, item.y]));
  }
  return pick(item);
}

/** ストラップホールの真ん中の穴 (2D) */
function punchOf(item) {
  const def = item.type === 'shape' ? SHAPES.find((s) => s.id === item.shape) : null;
  if (!def?.punch || item.hole) return [];
  return [M.CrossSection.circle(def.punch / 2, 48).scale([item.w, item.d]).rotate(item.rot).translate([item.x, item.y])];
}

/**
 * 複数の部品を1つにする。
 *  ソリッド … 和 (「ほる」の記録によるくぼみも反映済み)
 *  あな     … 差 (同じ階層の図形だけ)
 *  ストラップホールの穴 … 重なった図形もつきぬける
 */
export function combine(items) {
  const solids = items.filter((i) => !i.hole).map(placedManifold);
  const holes = items.filter((i) => i.hole).map(placedManifold);
  const punches = items.flatMap((i) => collectPlaced(i, punchOf));
  if (punches.length) holes.push(M.CrossSection.union(punches).extrude(40).translate([0, 0, -20]));
  let result = solids.length ? M.Manifold.union(solids) : new M.Manifold();
  if (holes.length && solids.length) {
    result = M.Manifold.difference(result, M.Manifold.union(holes));
  }
  return result;
}

/** グループの中身 (グループ自身の座標系、拡大前)。グループ自身への「ほる」も反映 */
const groupCache = new Map();
function groupLocal(group) {
  const key = JSON.stringify([group.children, group.carves ?? null, group.sz ?? 1, group.w0, group.d0]);
  if (!groupCache.has(key)) {
    // 高さ方向の拡大 sz を考えて、拡大前の深さに直す
    const g = applyCarves(combine(group.children), group.carves, group.w0, group.d0, CARVE_DEPTH / (group.sz ?? 1));
    groupCache.set(key, g);
  }
  return groupCache.get(key);
}

/** 部品の平面の形 (グループは中のソリッドの形) を親の座標系で */
function footprintCS(item) {
  const parts = collectPlaced(item, (c) => (c.hole ? [] : [placedCS(c)]));
  return parts.length ? M.CrossSection.union(parts) : null;
}

/**
 * 「ほる」の計算: carver の形で、下にある図形の表面をけずる記録を作る。
 * 表面に出ている図形 (その場所で一番高い図形) だけが対象。
 * 下に隠れている図形はけずらない (上の図形を後で動かしても、へこみが出てこないように)
 * @returns [{ id, polys }] polys は対象の図形の単位の座標
 */
export function computeCarve(carver, items) {
  const area = placedCS(carver);
  const others = items.filter((i) => i !== carver && !i.hole);
  const result = [];
  for (const S of others) {
    const fpS = footprintCS(S);
    if (!fpS) continue;
    // 図形の外形ぴったりで切ると、ふちに ごく薄い削り残しができる (境目が重なって計算が割り切れないため)。
    // 外形より 1mm 外側まで広げた範囲で記録し、ふちまで確実にけずる
    let exposed = fpS.offset(1, 'Round', 2, 24);
    const tS = itemThickness(S);
    const taller = others.filter((T) => T !== S && itemThickness(T) > tS + 1e-6).map(footprintCS).filter(Boolean);
    if (taller.length) exposed = M.CrossSection.difference(exposed, M.CrossSection.union(taller));
    let fp = M.CrossSection.intersection(area, exposed);
    // 実際に図形と重なっていなければ対象外
    if (fp.isEmpty() || M.CrossSection.intersection(fp, fpS).area() < 0.01) continue;
    // 対象の図形の単位の座標に直す: (p − 位置) を逆回転して、幅・奥行で割る
    const unit = fp.translate([-S.x, -S.y]).rotate(-S.rot).scale([1 / S.w, 1 / S.d]);
    const polys = unit.toPolygons().map((poly) => poly.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
    result.push({ id: S.id, polys });
  }
  return result;
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

/** SVG アイコン用の輪郭パス (図形の定義、またはテンプレートの id) */
export function shapeSvgPath(def) {
  let contours = def.contours;
  let sx = 1, sy = 1;
  if (typeof def === 'string') {
    // テンプレート: 実際の縦横比のまま表示する
    contours = shapeCS(def).cs.toPolygons();
    const t = TEMPLATES.find((x) => x.id === def);
    const m = Math.max(t.size[0], t.size[1]);
    sx = t.size[0] / m; sy = t.size[1] / m;
  }
  return contours
    .map((c) => 'M' + c.map(([x, y]) => `${(x * sx * 20 + 12).toFixed(2)},${(12 - y * sy * 20).toFixed(2)}`).join('L') + 'Z')
    .join(' ');
}

