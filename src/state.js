// ============================================================
// 作品データと 元に戻す / やり直し
// ============================================================
import { SHAPES, TEMPLATES, PALETTE, TEXT_DEFAULT, MIN_THICKNESS, MAX_THICKNESS, MIN_SIZE } from './config.js';
import { textNaturalSize, combine, groupHeight, itemThickness, thinnestSolid, computeCarve } from './geometry.js';

let nextId = 1;
const newId = () => 'i' + nextId++ + '_' + Math.random().toString(36).slice(2, 6);

export const state = {
  items: [],        // 一番上の階層の部品
  selected: [],     // 選択中の id
  snap: true,
  multi: false,     // タッチ用: 複数選択モード
};

const past = [];
const future = [];
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); }
export function emit(kind = 'items') { listeners.forEach((fn) => fn(kind)); }

const snapshot = () => JSON.stringify(state.items);

/** 変更の直前に呼ぶ (Undo の記録) */
export function checkpoint() {
  past.push(snapshot());
  if (past.length > 100) past.shift();
  future.length = 0;
}

export function undo() {
  if (!past.length) return;
  future.push(snapshot());
  state.items = JSON.parse(past.pop());
  cleanSelection();
  emit();
}

export function redo() {
  if (!future.length) return;
  past.push(snapshot());
  state.items = JSON.parse(future.pop());
  cleanSelection();
  emit();
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

function cleanSelection() {
  state.selected = state.selected.filter((id) => state.items.some((i) => i.id === id));
}

export const getItem = (id) => state.items.find((i) => i.id === id);
export const selectedItems = () => state.selected.map(getItem).filter(Boolean);

let colorCursor = 0;
function placeOffset() {
  // 同じ場所に重ならないよう少しずらす
  const n = state.items.length % 6;
  return [n * 4 - 10, 10 - n * 4];
}

export function addShape(shapeId, size) {
  const def = SHAPES.find((s) => s.id === shapeId);
  const [w, d, h] = size ?? def.size;
  const [x, y] = size ? [0, 0] : placeOffset();
  checkpoint();
  const item = { id: newId(), type: 'shape', shape: shapeId, x, y, rot: 0, w, d, h, hole: false, color: colorCursor++ % PALETTE.length };
  state.items.push(item);
  state.selected = [item.id];
  emit();
  return item;
}

export function addTemplate(tplId) {
  const t = TEMPLATES.find((x) => x.id === tplId);
  // テンプレートは、カド丸とストラップ穴が入った1つの図形として置く
  return addShape(t.id, t.size);
}

export function addText(text = TEXT_DEFAULT) {
  const [w, d] = textNaturalSize(text);
  const [x, y] = placeOffset();
  checkpoint();
  const item = { id: newId(), type: 'text', text, x, y, rot: 0, w, d, h: 3, hole: false, color: colorCursor++ % PALETTE.length };
  state.items.push(item);
  state.selected = [item.id];
  emit();
  return item;
}

/** 文字の内容を変えたときは、文字の高さを保ったまま幅を合わせ直す */
export function setText(item, text) {
  const [w0, d0] = textNaturalSize(item.text);
  const [w1, d1] = textNaturalSize(text);
  const sx = item.w / w0, sy = item.d / d0;
  item.text = text;
  item.w = Math.max(MIN_SIZE, w1 * sx);
  item.d = Math.max(MIN_SIZE, d1 * sy);
}

export function removeSelected() {
  if (!state.selected.length) return;
  checkpoint();
  state.items = state.items.filter((i) => !state.selected.includes(i.id));
  state.selected = [];
  emit();
}

function cloneWithNewIds(item) {
  const c = JSON.parse(JSON.stringify(item));
  const renew = (it) => { it.id = newId(); it.children?.forEach(renew); };
  renew(c);
  return c;
}

export function duplicateSelected() {
  const src = selectedItems();
  if (!src.length) return;
  checkpoint();
  const copies = src.map((it) => {
    const c = cloneWithNewIds(it);
    c.x += 5; c.y -= 5;
    return c;
  });
  state.items.push(...copies);
  state.selected = copies.map((c) => c.id);
  emit();
}

export function toggleHole() {
  const sel = selectedItems();
  if (!sel.length) return;
  checkpoint();
  const makeHole = !sel.every((i) => i.hole);
  sel.forEach((i) => {
    i.hole = makeHole;
    // 穴はつきぬけるように、最大の厚さにしておく
    if (makeHole && i.type !== 'group' && !isThicknessLocked(i)) i.h = MAX_THICKNESS;
  });
  emit();
}

/**
 * 「ほる」: 選んだ図形の形で、下にある作品の表面を 1mm くぼませる。
 * 選んだ図形そのものは消え、くぼみだけが残る (やめたいときは「もとにもどす」)。
 * @returns 'ok' | 'none' (ほれる図形を選んでいない) | 'empty' (下に図形がない)
 */
export function carveSelected() {
  const carvers = selectedItems().filter((i) => i.type !== 'group');
  if (!carvers.length) return 'none';
  const rest = state.items.filter((i) => !carvers.includes(i));
  const plans = carvers.map((c) => ({ c, targets: computeCarve(c, [c, ...rest]) })).filter((p) => p.targets.length);
  if (!plans.length) return 'empty';
  checkpoint();
  for (const { targets } of plans) {
    for (const t of targets) {
      const S = getItem(t.id);
      S.carves = [...(S.carves ?? []), { polys: t.polys }];
    }
  }
  const used = new Set(plans.map((p) => p.c));
  state.items = state.items.filter((i) => !used.has(i));
  state.selected = [];
  emit();
  return 'ok';
}

export function setColor(idx) {
  const sel = selectedItems();
  if (!sel.length) return;
  checkpoint();
  sel.forEach((i) => { i.color = idx; i.hole = false; });
  emit();
}

/** グループに入れられない図形か (ストラップホールは後から位置を変えられるよう、グループに入れない) */
export const isUngroupable = (item) => !!defOf(item)?.noGroup;

/** グループにできる図形 (選んだ中から、グループに入れられない図形を除いたもの) */
export const groupableSelection = () => selectedItems().filter((i) => !isUngroupable(i));

export function groupSelected() {
  const sel = groupableSelection();
  if (sel.length < 2) return;
  const merged = combine(sel);
  if (merged.isEmpty()) return;
  const b = merged.boundingBox();
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  checkpoint();
  const children = sel.map((i) => ({ ...JSON.parse(JSON.stringify(i)), x: i.x - cx, y: i.y - cy }));
  const firstSolid = sel.find((i) => !i.hole) ?? sel[0];
  const w0 = b.max[0] - b.min[0], d0 = b.max[1] - b.min[1];
  const group = { id: newId(), type: 'group', children, x: cx, y: cy, rot: 0, w: w0, d: d0, w0, d0, sz: 1, hole: false, color: firstSolid.color };
  // 元の並び順で、最初の要素の位置に入れる
  const firstIdx = state.items.findIndex((i) => sel.includes(i));
  state.items = state.items.filter((i) => !sel.includes(i));
  state.items.splice(Math.min(firstIdx, state.items.length), 0, group);
  state.selected = [group.id];
  emit();
}

export function clampThickness(h) {
  return Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, Math.round(h)));
}

/** 厚さとして選べる範囲 [最小, 最大] (1mm刻み)。
 *  グループは比率を保って伸び縮みするので、一番うすい部分が1mmを下回らない厚さが最小になる */
export function thicknessRange(item) {
  if (item.type !== 'group') return [MIN_THICKNESS, MAX_THICKNESS];
  const t = itemThickness(item);
  const thin = thinnestSolid(item);
  const min = Math.ceil((t * MIN_THICKNESS) / thin - 1e-6);
  return [Math.min(Math.max(MIN_THICKNESS, min), MAX_THICKNESS), MAX_THICKNESS];
}

/** 厚さを変える。範囲外なら範囲内に収め、収めたかどうかを返す */
/** 図形の定義 (基本図形のみ) */
const defOf = (item) => (item.type === 'shape' ? SHAPES.find((s) => s.id === item.shape) : null);

/**
 * グループの中にあるストラップホールなど「小さくできない図形」について、
 * 今の大きさが下限の何倍あるか (1 未満にはできない)。対象がなければ Infinity
 */
function shrinkRoom(item, scaleX = 1, scaleY = 1) {
  if (item.type === 'group') {
    const sx = scaleX * item.w / item.w0, sy = scaleY * item.d / item.d0;
    return Math.min(Infinity, ...item.children.map((c) => shrinkRoom(c, sx, sy)));
  }
  const min = defOf(item)?.minSize;
  if (!min) return Infinity;
  // グループの中で回っていることもあるので、縦横どちらの縮みにも耐えられるよう小さい方で見る
  const s = Math.min(scaleX, scaleY);
  return Math.min((item.w * s) / min[0], (item.d * s) / min[1]);
}

/** 大きさの下限 [幅, 奥行] (mm)。ストラップホールは決まった大きさより小さくできない */
export function minSizeFor(item) {
  const min = defOf(item)?.minSize;
  if (min) return [Math.max(MIN_SIZE, min[0]), Math.max(MIN_SIZE, min[1])];
  if (item.type === 'group') {
    const room = shrinkRoom(item);
    if (room !== Infinity) return [Math.max(MIN_SIZE, item.w / room), Math.max(MIN_SIZE, item.d / room)];
  }
  return [MIN_SIZE, MIN_SIZE];
}

/** 厚さを変えられない図形か (ストラップホール、ストラップホールを含むグループ) */
export function isThicknessLocked(item) {
  if (item.type === 'group') return item.children.some(isThicknessLocked);
  return !!defOf(item)?.lockThickness;
}

export function setThickness(item, value) {
  if (isThicknessLocked(item)) return false;
  const [min, max] = thicknessRange(item);
  const want = Math.round(value);
  const t = Math.min(max, Math.max(min, want));
  if (item.type === 'group') {
    const h0 = groupHeight(item);
    if (h0 > 0) item.sz = t / h0;
  } else {
    item.h = t;
  }
  return t !== want;
}

export function newDocument() {
  if (!state.items.length) return;
  checkpoint();
  state.items = [];
  state.selected = [];
  emit();
}

export function loadDocument(items) {
  checkpoint();
  state.items = items;
  state.selected = [];
  emit();
}

export function select(ids) {
  state.selected = ids;
  emit('selection');
}
