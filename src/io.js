// ============================================================
// ファイルの保存・読み込み、STL書き出し
// ============================================================
import { combine, toMesh } from './geometry.js';

const APP_ID = 'cad_3dp';
const FORMAT_VERSION = 1;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 作りかけの作品を保存 */
export function saveProject(items) {
  const data = { app: APP_ID, version: FORMAT_VERSION, savedAt: new Date().toISOString(), items };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `sakuhin-${stamp()}.json`);
}

/** 作品ファイルを読み込む (items を返す) */
export async function readProject(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== APP_ID || !Array.isArray(data.items)) throw new Error('このファイルは読み込めません');
  return data.items;
}

/** すべての部品を結合・くり抜きして STL (バイナリ) を作る */
export function buildStl(items) {
  const m = combine(items);
  if (m.isEmpty()) return null;
  const { positions, indices } = toMesh(m);
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = 'cad_3dp STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);
  let o = 84;
  const v = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < triCount; t++) {
    const a = v(indices[t * 3]), b = v(indices[t * 3 + 1]), c = v(indices[t * 3 + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const f of [nx, ny, nz, ...a, ...b, ...c]) { view.setFloat32(o, f, true); o += 4; }
    view.setUint16(o, 0, true); o += 2;
  }
  return { buffer: buf, triCount, bounds: m.boundingBox() };
}

/** 作品の番号 (まぎらわしい 0/O/1/I などは使わない) */
export function makeCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** STL のファイル名: sakuhin-年月日-時分秒-番号.stl (英数字とハイフンのみ) */
export function stlFileName(code) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `sakuhin-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${code}.stl`;
}
