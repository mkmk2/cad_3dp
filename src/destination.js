// ============================================================
// 3Dプリント用ファイル (STL) の保存先
//   download : ブラウザのダウンロードフォルダ (未設定のとき)
//   url      : Google ドライブ (Apps Script の受け取りURLへ送る)
//   folder   : このパソコンのフォルダ (Chrome の File System Access API)
// 端末に保存するのは「種類・URL・フォルダの参照」だけで、アカウント情報は保存しない。
// ============================================================
const KEY = 'cad_3dp.destination';
const DB = 'cad_3dp';
const STORE = 'handles';

export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

export function getDestination() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && (d.type === 'url' || d.type === 'folder' || d.type === 'download')) return d;
  } catch { /* 読めないときは未設定扱い */ }
  return { type: 'download' };
}

export async function setDestination(dest, folderHandle) {
  if (dest.type === 'folder' && folderHandle) await idbPut('folder', folderHandle);
  try { localStorage.setItem(KEY, JSON.stringify(dest)); } catch { /* 保存できない環境 */ }
}

/** 保存先の説明 (確認ダイアログ用) */
export function describe(dest) {
  if (dest.type === 'url') return { icon: 'cloud', text: 'Google ドライブに おくるよ' };
  if (dest.type === 'folder') return { icon: 'open', text: `フォルダ「${dest.folderName}」に ほぞんするよ` };
  return { icon: 'save', text: 'この たんまつの ダウンロードに ほぞんするよ' };
}

// ---------- 送信 ----------

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function postToUrl(url, name, buffer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    // text/plain にすると事前確認 (プリフライト) が不要になり、Apps Script でそのまま受け取れる
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ name, data: toBase64(buffer) }),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'upload failed');
  } finally {
    clearTimeout(timer);
  }
}

async function writeToFolder(name, buffer) {
  const dir = await idbGet('folder');
  if (!dir) throw new Error('folder not set');
  let perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await dir.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('permission denied');
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(buffer);
  await w.close();
}

/**
 * STL を設定済みの保存先へ送る。失敗したらダウンロードフォルダへ保存する。
 * @returns {{ok: boolean, fallback: boolean, error?: string}}
 */
export async function sendStl(buffer, name) {
  const dest = getDestination();
  const blob = new Blob([buffer], { type: 'model/stl' });
  if (dest.type === 'download') {
    download(blob, name);
    return { ok: true, fallback: false };
  }
  try {
    if (dest.type === 'url') await postToUrl(dest.url, name, buffer);
    else await writeToFolder(name, buffer);
    return { ok: true, fallback: false };
  } catch (err) {
    console.error(err);
    download(blob, name);
    return { ok: false, fallback: true, error: String(err) };
  }
}

/** 受け取りURLにつながるか確かめる */
export async function testUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'ping=1', { signal: ctrl.signal });
    const json = await res.json();
    return json.ok === true && json.app === 'cad_3dp';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'cad_3dp-stl', mode: 'readwrite' });
  return handle;
}

// ---------- フォルダの参照を IndexedDB に保存 ----------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
