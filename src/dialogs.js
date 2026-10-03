// ============================================================
// ダイアログ: 3Dプリント用の送信確認、保存先の設定 (先生用)
// ============================================================
import { ICONS } from './icons.js';
import { buildStl, makeCode, stlFileName } from './io.js';
import {
  getDestination, setDestination, describe, sendStl, testUrl, pickFolder, folderSupported,
} from './destination.js';

/** 画面の上に重ねるダイアログを開く。close() で閉じる */
function openModal(className = '') {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal ' + className;
  back.append(box);
  document.body.append(back);
  const close = () => back.remove();
  return { box, close };
}

function bigButton(icon, text, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'big ' + cls;
  b.innerHTML = ICONS[icon] + `<span>${text}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

// ---------- 3Dプリント用の送信 ----------

/** items を STL にして送る。onlySelected = えらんだ かたちだけを おくるとき */
export function openPrintDialog(items, viewer, toast, onlySelected = false) {
  const stl = buildStl(items);
  if (!stl) { toast(onlySelected ? 'えらんだ ものに かたちが ないよ' : 'かたちが ないよ'); return; }
  const dest = getDestination();
  const info = describe(dest);
  const { box, close } = openModal('print');
  const img = new Image();
  img.src = viewer.snapshot(onlySelected ? items.map((i) => i.id) : null);
  img.className = 'preview';
  const msg = document.createElement('div');
  msg.className = 'dest';
  msg.innerHTML = ICONS[info.icon] + `<span>${info.text}</span>`;
  const q = document.createElement('div');
  q.className = 'question';
  q.textContent = onlySelected ? 'えらんだ かたちを 3Dプリントに おくる？' : '3Dプリントに おくる？';
  const row = document.createElement('div');
  row.className = 'buttons';
  const ok = bigButton('check', 'おくる', 'primary', async () => {
    ok.disabled = cancel.disabled = true;
    q.textContent = 'おくっているよ…';
    const code = makeCode();
    const name = stlFileName(code);
    const res = await sendStl(stl.buffer, name);
    showResult(res, code);
  });
  const cancel = bigButton('close', 'やめる', '', close);
  row.append(cancel, ok);
  box.append(img, q, msg, row);

  function showResult(res, code) {
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'question';
    const note = document.createElement('div');
    note.className = 'dest';
    if (res.ok) {
      head.textContent = dest.type === 'download' ? 'ほぞんしたよ！' : 'おくれたよ！';
    } else {
      head.textContent = 'おくれなかったよ';
      note.innerHTML = ICONS.warn + '<span>かわりに この たんまつの ダウンロードに ほぞんしたよ。せんせいに しらせてね</span>';
    }
    const codeBox = document.createElement('div');
    codeBox.className = 'code';
    codeBox.innerHTML = `<small>さくひんの ばんごう</small><b>${code}</b>`;
    const row2 = document.createElement('div');
    row2.className = 'buttons';
    row2.append(bigButton('check', 'とじる', 'primary', close));
    box.append(head, codeBox);
    if (!res.ok) box.append(note);
    box.append(row2);
  }
}

// ---------- 保存先の設定 (先生用) ----------

export function openSettingsDialog(toast) {
  const cur = getDestination();
  let folderHandle = null;
  let folderName = cur.type === 'folder' ? cur.folderName : '';
  const { box, close } = openModal('settings');
  box.innerHTML = `
    <h2>3Dプリント用ファイルの保存先（先生用）</h2>
    <label class="opt"><input type="radio" name="dest" value="download"> この端末のダウンロードフォルダ</label>
    <label class="opt"><input type="radio" name="dest" value="url"> Google ドライブ（受け取り用URL）</label>
    <div class="sub" data-for="url">
      <input type="url" class="url" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false">
      <button class="small test">つながるか確認</button>
      <div class="status"></div>
    </div>
    <label class="opt"><input type="radio" name="dest" value="folder"> このパソコンのフォルダ（共有フォルダも可）</label>
    <div class="sub" data-for="folder">
      <button class="small pick">フォルダを選ぶ</button>
      <span class="folder-name"></span>
    </div>
    <p class="note">端末に保存されるのは、保存先の種類とURL（またはフォルダの参照）だけです。アカウント情報は保存しません。</p>
    <div class="buttons"></div>`;
  const radios = [...box.querySelectorAll('input[name=dest]')];
  const urlInput = box.querySelector('.url');
  const status = box.querySelector('.status');
  const nameEl = box.querySelector('.folder-name');
  urlInput.value = cur.url || '';
  nameEl.textContent = folderName ? `「${folderName}」` : '（未選択）';
  radios.forEach((r) => { r.checked = r.value === cur.type; });
  if (!folderSupported()) {
    const r = radios.find((x) => x.value === 'folder');
    r.disabled = true;
    r.parentElement.append('（このブラウザでは使えません）');
  }
  const refresh = () => {
    const v = radios.find((r) => r.checked)?.value;
    box.querySelectorAll('.sub').forEach((s) => { s.hidden = s.dataset.for !== v; });
  };
  radios.forEach((r) => r.addEventListener('change', refresh));
  refresh();

  box.querySelector('.test').addEventListener('click', async () => {
    status.textContent = '確認中…';
    status.className = 'status';
    const ok = await testUrl(urlInput.value.trim());
    status.textContent = ok ? 'つながりました' : 'つながりませんでした（URLと公開設定を確認してください）';
    status.className = 'status ' + (ok ? 'ok' : 'ng');
  });
  box.querySelector('.pick').addEventListener('click', async () => {
    try {
      folderHandle = await pickFolder();
      folderName = folderHandle.name;
      nameEl.textContent = `「${folderName}」`;
    } catch { /* キャンセル */ }
  });

  const row = box.querySelector('.buttons');
  row.append(
    bigButton('close', 'キャンセル', '', close),
    bigButton('check', '保存', 'primary', async () => {
      const type = radios.find((r) => r.checked)?.value ?? 'download';
      if (type === 'url') {
        const url = urlInput.value.trim();
        if (!/^https:\/\//.test(url)) { status.textContent = 'https:// で始まるURLを入れてください'; status.className = 'status ng'; return; }
        await setDestination({ type, url });
      } else if (type === 'folder') {
        if (!folderHandle && cur.type !== 'folder') { nameEl.textContent = 'フォルダを選んでください'; return; }
        await setDestination({ type, folderName }, folderHandle);
      } else {
        await setDestination({ type: 'download' });
      }
      close();
      toast('保存先を設定しました');
    }),
  );
}

/** 長押しで開くボタン (子どもが誤って開かないように) */
export function longPressButton(onOpen, ms = 2000) {
  const b = document.createElement('button');
  b.className = 'corner-gear';
  b.title = '先生用: 長押しで保存先の設定';
  b.setAttribute('aria-label', b.title);
  b.innerHTML = ICONS.gear + '<i class="ring"></i>';
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; b.classList.remove('pressing'); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('pressing');
    timer = setTimeout(() => { cancel(); onOpen(); }, ms);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, cancel));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}
