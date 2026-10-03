import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { SHAPES, TEMPLATES, PALETTE, MIN_SIZE, MAX_THICKNESS, MIN_THICKNESS } from './config.js';
import { initGeometry, shapeSvgPath } from './geometry.js';
import {
  state, onChange, emit, checkpoint, undo, redo, canUndo, canRedo, selectedItems,
  addShape, addTemplate, addText, setText, removeSelected, duplicateSelected, toggleHole,
  setColor, groupSelected, newDocument, loadDocument, setThickness, carveSelected, minSizeFor, isThicknessLocked, groupableSelection,
} from './state.js';
import { createViewer, normAngle } from './viewer.js';
import { saveProject, readProject } from './io.js';
import { itemThickness } from './geometry.js';
import { openPrintDialog, openSettingsDialog, longPressButton } from './dialogs.js';
import { ICONS } from './icons.js';

registerSW({ immediate: true });

const $ = (sel) => document.querySelector(sel);

function button(icon, title, onClick, cls = '') {
  const b = document.createElement('button');
  b.className = 'icon ' + cls;
  b.innerHTML = ICONS[icon];
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}
const sep = () => Object.assign(document.createElement('div'), { className: 'sep' });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function start() {
  await initGeometry((step) => {
    if (step === 'font') $('#loadingText').textContent = 'もじを よみこみちゅう…';
  });
  const viewer = createViewer($('#view'));

  // ---------- ツールバー ----------
  const tb = $('#toolbar');
  const btn = {};
  btn.new = button('new', 'あたらしく つくる', () => {
    if (state.items.length && !confirmNew()) return;
    newDocument();
  });
  btn.open = button('open', 'ひらく', () => $('#fileInput').click());
  btn.save = button('save', 'ほぞん', () => {
    if (!state.items.length) return toast('まだ なにも ないよ');
    saveProject(state.items);
    toast('ほぞんしたよ');
  });
  // えらんでいる かたちが あれば それだけ、なければ ぜんぶ を おくる
  btn.print = button('print', '3Dプリントに おくる', () => {
    const sel = selectedItems();
    openPrintDialog(sel.length ? sel : state.items, viewer, toast, sel.length > 0);
  }, 'primary');
  btn.undo = button('undo', 'もとにもどす', undo);
  btn.redo = button('redo', 'やりなおす', redo);
  btn.copy = button('copy', 'コピー', duplicateSelected);
  btn.del = button('trash', 'けす', removeSelected, 'danger');
  btn.group = button('group', 'ひとつに まとめる (グループ)', groupSelected);
  btn.hole = button('hole', 'あなに する / もどす', toggleHole);
  btn.snap = button('magnet', 'ぴったり (1mm)', () => { state.snap = !state.snap; emit('ui'); });
  btn.multi = button('multi', 'いくつも えらぶ', () => { state.multi = !state.multi; emit('ui'); });
  tb.append(btn.new, btn.open, btn.save, sep(), btn.undo, btn.redo, sep(),
    btn.copy, btn.del, btn.group, btn.hole, sep(), btn.snap, btn.multi,
    Object.assign(document.createElement('div'), { className: 'spacer' }), btn.print);

  // 「あたらしく」は確認をはさむ (ダイアログは使わず、2回押しで確定)
  let newArmed = 0;
  function confirmNew() {
    if (Date.now() - newArmed < 2500) { newArmed = 0; return true; }
    newArmed = Date.now();
    toast('もういちど おすと ぜんぶ けすよ');
    return false;
  }

  // 視点
  $('#viewtools').append(
    button('home', 'はじめの みかた', viewer.resetView),
    button('top', 'うえから みる', viewer.topView),
    button('zoomIn', 'ちかく', () => viewer.zoom(0.8)),
    button('zoomOut', 'とおく', () => viewer.zoom(1.25)),
  );

  // 先生用: 保存先の設定 (右下の隅。長押しで開く)
  $('#main').append(longPressButton(() => openSettingsDialog(toast)));

  // ---------- 図形パネル ----------
  const side = $('#shapes');
  const title = (icon, t) => {
    const d = document.createElement('div');
    d.className = 'shape-title';
    d.innerHTML = ICONS[icon];
    d.title = t;
    return d;
  };
  const shapeBtn = (def, t, onClick, cls = '') => {
    const b = document.createElement('button');
    b.className = 'shape ' + cls;
    b.title = t;
    b.setAttribute('aria-label', t);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40"><path d="${shapeSvgPath(def)}"/></svg>`;
    b.addEventListener('click', onClick);
    return b;
  };
  const tplGrid = document.createElement('div');
  tplGrid.className = 'shape-grid';
  TEMPLATES.forEach((t) => {
    tplGrid.append(shapeBtn(t.id, `${t.name} (${t.size[0]}×${t.size[1]}mm)`, () => addTemplate(t.id), 'tpl'));
  });
  const shapeGrid = document.createElement('div');
  shapeGrid.className = 'shape-grid';
  SHAPES.filter((def) => !def.panel).forEach((def) => shapeGrid.append(shapeBtn(def, def.name, () => addShape(def.id))));
  // ストラップホールは別の段に、色を変えて並べる
  const strapGrid = document.createElement('div');
  strapGrid.className = 'shape-grid';
  SHAPES.filter((def) => def.panel === 'strap').forEach((def) => strapGrid.append(shapeBtn(def, def.name, () => addShape(def.id), 'strap')));
  const textBtn = document.createElement('button');
  textBtn.className = 'shape';
  textBtn.title = 'もじ';
  textBtn.innerHTML = ICONS.text;
  textBtn.addEventListener('click', () => {
    addText();
    setTimeout(() => { const i = $('#props .text input'); i?.focus(); i?.select(); }, 30);
  });
  shapeGrid.append(textBtn);
  side.append(title('plate', 'どだい'), tplGrid, title('group', 'かたち'), shapeGrid, title('strap', 'ストラップ'), strapGrid);

  // ---------- ファイル読み込み ----------
  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      loadDocument(await readProject(f));
      toast('ひらいたよ');
    } catch (err) {
      console.error(err);
      toast('このファイルは ひらけないよ');
    }
  });

  // ---------- プロパティパネル ----------
  const props = $('#props');
  let propsKey = '';
  const inputs = {};

  function numField(icon, t, key, unit, opts = {}) {
    const f = document.createElement('label');
    f.className = 'field';
    f.title = t;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = opts.step ?? 1;
    if (opts.min != null) inp.min = opts.min;
    if (opts.max != null) inp.max = opts.max;
    inp.inputMode = 'decimal';
    inp.addEventListener('change', () => {
      const it = selectedItems()[0];
      const v = parseFloat(inp.value);
      if (!it || Number.isNaN(v)) return refreshValues();
      checkpoint();
      opts.apply(it, v);
      emit();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    f.insertAdjacentHTML('beforeend', ICONS[icon]);
    const parts = [];
    if (opts.stepper) parts.push(stepBtn('minus', -1, opts));
    parts.push(inp);
    if (opts.stepper) parts.push(stepBtn('plus', +1, opts));
    f.append(...parts);
    if (unit) f.insertAdjacentHTML('beforeend', `<span class="unit">${unit}</span>`);
    inputs[key] = inp;
    return f;
  }
  function stepBtn(icon, dir, opts) {
    const b = button(icon, dir > 0 ? 'ふやす' : 'へらす', (e) => {
      e.preventDefault();
      const it = selectedItems()[0];
      if (!it) return;
      checkpoint();
      opts.apply(it, opts.get(it) + dir);
      emit();
    });
    return b;
  }

  function buildProps() {
    const sel = selectedItems();
    const key = sel.map((i) => i.id + i.type).join(',');
    if (key === propsKey) return refreshValues();
    propsKey = key;
    props.innerHTML = '';
    for (const k in inputs) delete inputs[k];
    props.hidden = sel.length === 0;
    if (!sel.length) return;

    // 色 + 穴
    const colors = document.createElement('div');
    colors.className = 'colors';
    // 色が固定の図形 (ストラップホール) だけを選んでいるときは、色のボタンは出さない
    const fixedColorOnly = sel.every((i) => i.type === 'shape' && SHAPES.find((d) => d.id === i.shape)?.color);
    if (!fixedColorOnly) PALETTE.forEach((c, idx) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c.hex;
      b.title = c.name;
      b.dataset.idx = idx;
      b.addEventListener('click', () => setColor(idx));
      colors.append(b);
    });
    const hb = document.createElement('button');
    hb.className = 'swatch hole';
    hb.title = 'あな';
    hb.dataset.idx = 'hole';
    hb.addEventListener('click', toggleHole);
    // ほる: 下にある作品の表面を 1mm くぼませる
    const cb = document.createElement('button');
    cb.className = 'swatch carve';
    cb.title = 'ほる (この形で 下を 1mm くぼませる)';
    cb.dataset.idx = 'carve';
    cb.innerHTML = ICONS.carve;
    cb.addEventListener('click', () => {
      const r = carveSelected();
      if (r === 'ok') toast('ほったよ（もどすときは もとにもどす）');
      else if (r === 'empty') toast('したに ほる ものが ないよ');
      else toast('グループは ほれないよ');
    });
    colors.append(hb, cb);
    props.append(colors);

    if (sel.length === 1) {
      const it = sel[0];
      if (it.type === 'text') {
        const f = document.createElement('label');
        f.className = 'field text';
        f.title = 'もじ';
        f.innerHTML = ICONS.text;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = it.text;
        let composing = false, recorded = false;
        const apply = () => {
          const cur = selectedItems()[0];
          const v = inp.value.trim() || ' ';
          if (!cur || cur.type !== 'text' || v === cur.text) return;
          if (!recorded) { checkpoint(); recorded = true; }
          setText(cur, v);
          emit();
        };
        inp.addEventListener('focus', () => { recorded = false; });
        inp.addEventListener('compositionstart', () => { composing = true; });
        inp.addEventListener('compositionend', () => { composing = false; apply(); });
        inp.addEventListener('input', () => { if (!composing) apply(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !composing) inp.blur(); });
        f.append(inp);
        inputs.text = inp;
        props.append(f);
      }
      props.append(
        numField('width', 'よこ', 'w', 'mm', { min: minSizeFor(it)[0], apply: (i, v) => { i.w = Math.max(minSizeFor(i)[0], v); } }),
        numField('depth', 'たて', 'd', 'mm', { min: minSizeFor(it)[1], apply: (i, v) => { i.d = Math.max(minSizeFor(i)[1], v); } }),
      );
      // ストラップホール (と それを含むグループ) は厚さを変えられないので、厚さの欄は出さない
      if (!isThicknessLocked(it)) props.append(numField('thick', 'あつさ', 'h', 'mm', {
        min: MIN_THICKNESS, max: MAX_THICKNESS, stepper: true,
        get: (i) => Math.round(itemThickness(i)),
        apply: (i, v) => {
          const want = Math.round(v);
          if (setThickness(i, v)) toast(want < itemThickness(i) ? 'これより うすく できないよ' : 'これより あつく できないよ');
        },
      }));
      props.append(numField('rotate', 'かくど', 'rot', '°', { step: 15, apply: (i, v) => { i.rot = normAngle(v); } }));
    }
    refreshValues();
  }

  const round1 = (v) => Math.round(v * 10) / 10;
  function refreshValues() {
    const sel = selectedItems();
    // 色の選択表示
    props.querySelectorAll('.swatch').forEach((b) => {
      const on = b.dataset.idx === 'hole'
        ? sel.length && sel.every((i) => i.hole)
        : b.dataset.idx === 'carve'
          ? false
          : sel.length && sel.every((i) => !i.hole && i.color === +b.dataset.idx);
      b.classList.toggle('on', !!on);
    });
    if (sel.length !== 1) return;
    const it = sel[0];
    const set = (k, v) => { const i = inputs[k]; if (i && document.activeElement !== i) i.value = v; };
    set('w', round1(it.w));
    set('d', round1(it.d));
    set('h', round1(itemThickness(it)));
    set('rot', round1(it.rot));
    if (it.type === 'text') set('text', it.text);
  }

  function refreshToolbar() {
    const n = state.selected.length;
    btn.undo.disabled = !canUndo();
    btn.redo.disabled = !canRedo();
    btn.copy.disabled = n === 0;
    btn.del.disabled = n === 0;
    btn.hole.disabled = n === 0;
    btn.group.disabled = groupableSelection().length < 2;
    btn.snap.classList.toggle('on', state.snap);
    btn.multi.classList.toggle('on', state.multi);
  }

  function refreshWarning() {
    const w = $('#warning');
    const out = viewer.anyOutside();
    w.hidden = !out;
    if (out) w.innerHTML = ICONS.warn + '<span>プレートから はみだしているよ</span>';
  }

  onChange((kind) => {
    if (kind === 'items' || kind === 'selection') {
      viewer.sync();
      buildProps();
      refreshToolbar();
    } else if (kind === 'transform') {
      refreshValues();
      refreshWarning();
    } else if (kind === 'warning') {
      refreshWarning();
    } else if (kind === 'ui') {
      refreshToolbar();
    }
  });

  // ---------- キーボード ----------
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.querySelector('.modal-back')) return; // ダイアログ表示中は操作しない
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (ctrl && (e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'c')) { e.preventDefault(); duplicateSelected(); }
    else if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelected(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Escape') { state.selected = []; emit('selection'); }
    else if (e.key.startsWith('Arrow')) {
      const sel = selectedItems();
      if (!sel.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
      checkpoint();
      sel.forEach((i) => { i.x += dx; i.y += dy; });
      emit();
    }
  });

  // ページを閉じるときの確認
  window.addEventListener('beforeunload', (e) => {
    if (state.items.length) { e.preventDefault(); e.returnValue = ''; }
  });

  emit();
  $('#loading').classList.add('hidden');

  // テスト用
  window.__app = { state, viewer, emit };
}

start().catch((err) => {
  console.error(err);
  $('#loadingText').textContent = 'よみこみに しっぱいしました';
});
