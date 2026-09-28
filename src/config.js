// ============================================================
// 設定ファイル: 図形・テンプレート・色・各種制限値
// 図形を追加・変更するときは、このファイルだけを編集すればよい。
// ============================================================

/** 作業プレートの大きさ (mm) */
export const PLATE_SIZE = 100;

/** 厚さの制限 (mm, 1mm刻み) */
export const MIN_THICKNESS = 1;
export const MAX_THICKNESS = 5;

/** 大きさの最小値 (mm) */
export const MIN_SIZE = 1;

/** スナップ刻み */
export const SNAP_MM = 1;
export const SNAP_DEG = 15;

/** 文字に使うフォント (public/ 以下のパス) */
export const FONT_URL = './fonts/MPLUSRounded1c-Bold.ttf';
/** 文字を置いたときの高さ (mm) */
export const TEXT_DEFAULT_HEIGHT = 10;
export const TEXT_DEFAULT = 'なまえ';

/** 色パレット (8色) */
export const PALETTE = [
  { name: 'あか', hex: '#E53935' },
  { name: 'オレンジ', hex: '#FB8C00' },
  { name: 'きいろ', hex: '#FDD835' },
  { name: 'みどり', hex: '#43A047' },
  { name: 'みずいろ', hex: '#29B6F6' },
  { name: 'あお', hex: '#1E88E5' },
  { name: 'むらさき', hex: '#8E24AA' },
  { name: 'ピンク', hex: '#F06292' },
];

// ------------------------------------------------------------
// 輪郭を作る補助関数
// 輪郭はすべて「幅1 × 奥行1、中心が原点」の範囲に収まるように作る。
// 配置時に 幅(w) × 奥行(d) に拡大される。
// ------------------------------------------------------------
const circle = (r, n = 64, cx = 0, cy = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

function normalize(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return pts.map(([x, y]) => [
    (x - minX) / (maxX - minX) - 0.5,
    (y - minY) / (maxY - minY) - 0.5,
  ]);
}

function heart(n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x, y]);
  }
  return normalize(pts);
}

function star(points = 5, inner = 0.45) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return normalize(pts);
}

/**
 * 基本図形の定義
 *  id        : 保存ファイルに書かれる識別子 (変更しないこと)
 *  name      : 表示名 (ツールチップ)
 *  contours  : 輪郭 (点の配列の配列)。穴のある形は複数の輪郭を持つ
 *  fillRule  : 'NonZero' または 'EvenOdd' (リングのように穴を持つ形は EvenOdd)
 *  size      : 置いたときの [幅, 奥行, 厚さ] (mm)
 */
export const SHAPES = [
  { id: 'box', name: 'しかく', contours: [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]], size: [20, 20, 2] },
  { id: 'cylinder', name: 'まる', contours: [circle(0.5)], size: [20, 20, 2] },
  { id: 'triangle', name: 'さんかく', contours: [[[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]], size: [20, 20, 2] },
  { id: 'ring', name: 'ドーナツ', contours: [circle(0.5), circle(0.3)], fillRule: 'EvenOdd', size: [20, 20, 2] },
  { id: 'heart', name: 'ハート', contours: [heart()], size: [20, 18, 2] },
  { id: 'star', name: 'ほし', contours: [star()], size: [20, 20, 2] },
];

/**
 * 土台テンプレート (仮。形・サイズは後日指定)
 *  shape : 使う基本図形の id
 *  size  : [幅, 奥行, 厚さ] (mm)
 */
export const TEMPLATES = [
  { id: 'plate-rect', name: 'しかくいプレート', shape: 'box', size: [30, 15, 2] },
  { id: 'plate-round', name: 'まるいプレート', shape: 'cylinder', size: [40, 40, 2] },
  { id: 'plate-heart', name: 'ハートのプレート', shape: 'heart', size: [45, 40, 2] },
];
