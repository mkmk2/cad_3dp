// ============================================================
// 3D表示と、マウス・タッチでの操作
// 座標: X=右, Y=奥, Z=上 (単位 mm)。プレートは Z=0 の面。
//
// マウス (Tinkercad と同じ割り当て)
//   左ドラッグ(図形の上)   : 移動          左ドラッグ(何もない所): 範囲選択
//   左クリック(何もない所) : 選択解除      Shift+クリック/範囲選択: 選択に追加
//   右ドラッグ             : 視点の回転    中ドラッグ / Shift+右ドラッグ: 平行移動
//   ホイール               : 拡大・縮小
// タッチ
//   1本指(図形の上): 移動   1本指(何もない所): 視点の回転 / 「いくつも えらぶ」中は範囲選択
//   2本指: 拡大・縮小と平行移動
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLATE_SIZE, PALETTE, SHAPES, MIN_SIZE, SNAP_MM, SNAP_DEG } from './config.js';
import { baseManifold, baseSize, toMesh, itemThickness, isSizeDependent } from './geometry.js';
import { state, emit, checkpoint, selectedItems, select, setThickness, minSizeFor, isThicknessLocked } from './state.js';

const DEG = Math.PI / 180;
const HALF = PLATE_SIZE / 2;
const HANDLE_PX = 13;       // ハンドルの画面上の大きさ (px)
const ROT_HANDLE_PX = 20;   // 回転ハンドル (丸+扇形) の大きさ (px)
const HANDLE_OFFSET_PX = 22; // 回転・厚さハンドルを角から外へずらす量 (px)
const THICK_HANDLE_PX = 22; // 厚さハンドル (円錐) の大きさ (px)
const THICK_OFFSET_PX = 30; // 厚さハンドルを角から外へずらす量 (px)
const THICK_PX_PER_MM = 14; // 真上から見たときの、厚さ 1mm あたりのドラッグ量 (px)
const DRAG_START_PX = 4;     // これ以上動いたらドラッグとみなす (px)

const round1 = (v) => Math.round(v * 10) / 10;

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const el = renderer.domElement;
  el.style.touchAction = 'none';

  // ドラッグ中の数値ラベルと、範囲選択の枠
  const label = document.createElement('div');
  label.className = 'drag-label';
  label.hidden = true;
  const selBox = document.createElement('div');
  selBox.className = 'select-box';
  selBox.hidden = true;
  container.append(label, selBox);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef2f6');

  const camera = new THREE.PerspectiveCamera(40, 1, 5, 3000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, el);
  controls.enableDamping = false; // 手を離した後に視点が動き続けないようにする
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 40;
  controls.maxDistance = 600;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, -100, 200);
  scene.add(sun);

  buildPlate(scene);

  // ---------- 部品の表示 ----------
  const meshes = new Map(); // id -> { mesh, key, w0, d0, h }
  const itemRoot = new THREE.Group();
  scene.add(itemRoot);

  function geomKey(it) {
    if (it.type === 'group') return 'g:' + JSON.stringify([it.children, it.carves ?? null]);
    // 角を丸める図形は、丸みの大きさをそろえるため 大きさが変わったら作り直す
    const size = isSizeDependent(it) ? `:${Math.round(it.w * 100) / 100}:${Math.round(it.d * 100) / 100}` : '';
    const carves = it.carves?.length ? ':' + JSON.stringify(it.carves) : '';
    return `${it.type}:${it.shape ?? ''}:${it.text ?? ''}:${it.h}${size}${carves}`;
  }

  function buildGeometry(it) {
    const { positions, indices } = toMesh(baseManifold(it));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  function applyTransform(entry, it) {
    // 同じ厚さの図形が重なったときのちらつき防止 (表示だけ、後に置いた図形をわずかに上に)
    entry.mesh.position.set(it.x, it.y, (entry.order ?? 0) * 0.01);
    entry.mesh.rotation.set(0, 0, it.rot * DEG);
    entry.mesh.scale.set(it.w / entry.w0, it.d / entry.d0, it.type === 'group' ? (it.sz ?? 1) : 1);
    entry.mesh.updateMatrixWorld();
    entry.h = itemThickness(it);
  }

  function isOutside(entry) {
    const box = new THREE.Box3().setFromObject(entry.mesh, true);
    const e = 0.01;
    return box.min.x < -HALF - e || box.max.x > HALF + e || box.min.y < -HALF - e || box.max.y > HALF + e;
  }

  function applyMaterial(entry, it) {
    const sel = state.selected.includes(it.id);
    const out = isOutside(entry);
    entry.outside = out;
    const m = entry.mesh.material;
    if (it.hole) {
      m.color.set('#8d99a6');
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
    } else {
      // 色が固定の図形 (ストラップホール) はその色、ほかはパレットの色
      const fixed = it.type === 'shape' ? SHAPES.find((d) => d.id === it.shape)?.color : null;
      m.color.set(fixed ?? PALETTE[it.color % PALETTE.length].hex);
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
    m.emissive.set(out ? '#b00000' : sel ? '#333333' : '#000000');
    m.needsUpdate = true;
    entry.mesh.renderOrder = it.hole ? 2 : 1;
  }

  function sync() {
    const alive = new Set();
    state.items.forEach((it, idx) => {
      alive.add(it.id);
      let entry = meshes.get(it.id);
      const key = geomKey(it);
      if (!entry) {
        const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0 });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.userData.id = it.id;
        itemRoot.add(mesh);
        entry = { mesh, key: null };
        meshes.set(it.id, entry);
      }
      if (entry.key !== key) {
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = buildGeometry(it);
        entry.key = key;
      }
      [entry.w0, entry.d0] = baseSize(it);
      entry.order = idx;
      applyTransform(entry, it);
      applyMaterial(entry, it);
    });
    for (const [id, entry] of meshes) {
      if (!alive.has(id)) {
        itemRoot.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        meshes.delete(id);
      }
    }
    updateHandles();
    emit('warning');
  }

  function refreshTransforms(items) {
    for (const it of items) {
      const entry = meshes.get(it.id);
      if (!entry) continue;
      applyTransform(entry, it);
      applyMaterial(entry, it);
    }
    updateHandles();
    emit('transform');
  }

  const anyOutside = () => [...meshes.values()].some((e) => e.outside);

  // ---------- ハンドル ----------
  // すべて同じデザイン (白地 + 青の縁)。形だけ変えて区別する
  //   大きさ = 四角、厚さ = 上向きの三角、回転 = 丸
  const handleRoot = new THREE.Group();
  handleRoot.visible = false;
  scene.add(handleRoot);
  const handles = [];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: '#1565c0', depthTest: false }),
  );
  outline.renderOrder = 10;
  handleRoot.add(outline);

  function makeHandle(kind, geom, data = {}) {
    const g = new THREE.Group();
    const vis = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
    vis.renderOrder = 11;
    const edge = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: '#1565c0', depthTest: false, side: THREE.BackSide }));
    edge.scale.setScalar(1.35);
    edge.renderOrder = 10;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    g.add(edge, vis, hit);
    g.userData = { kind, ...data };
    hit.userData.handle = g;
    handleRoot.add(g);
    handles.push(g);
    return g;
  }

  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      if (sx === 0 && sy === 0) continue;
      makeHandle('scale', cube, { sx, sy });
    }
  }
  const coneGeom = new THREE.ConeGeometry(0.6, 1.2, 16).rotateX(Math.PI / 2);
  const thickHandle = makeHandle('thick', coneGeom);
  // 円錐の先に青い点 (真上から見ても、回転ハンドルと区別できるように)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8).translate(0, 0, 0.6), new THREE.MeshBasicMaterial({ color: '#1565c0', depthTest: false }));
  tip.renderOrder = 12;
  thickHandle.add(tip);
  // 回転ハンドル: 白い丸の中に青い扇形 (角度を変えられることを示す)
  const discGeom = new THREE.CylinderGeometry(0.6, 0.6, 0.3, 32).rotateX(Math.PI / 2);
  const rotHandle = makeHandle('rot', discGeom);
  const sector = new THREE.Mesh(
    new THREE.CircleGeometry(0.47, 24, Math.PI * 0.5 - Math.PI * 0.7, Math.PI * 0.7).translate(0, 0, 0.16),
    new THREE.MeshBasicMaterial({ color: '#1565c0', depthTest: false, side: THREE.DoubleSide }),
  );
  sector.renderOrder = 12;
  rotHandle.add(sector);

  // 回転中のガイド円
  const guide = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2), Math.sin(i / 64 * Math.PI * 2), 0))),
    new THREE.LineDashedMaterial({ color: '#1565c0', depthTest: false, dashSize: 0.05, gapSize: 0.05 }),
  );
  guide.computeLineDistances();
  guide.visible = false;
  guide.renderOrder = 9;
  scene.add(guide);

  function updateHandles() {
    const sel = selectedItems();
    if (sel.length !== 1) {
      handleRoot.visible = sel.length > 1;
      if (sel.length > 1) layoutMultiOutline(sel);
      return;
    }
    const it = sel[0];
    const entry = meshes.get(it.id);
    if (!entry) return;
    handleRoot.visible = true;
    handleRoot.position.set(it.x, it.y, 0);
    handleRoot.rotation.set(0, 0, it.rot * DEG);
    const hw = it.w / 2, hd = it.d / 2;
    setOutline(hw, hd, 0.05);
    for (const h of handles) {
      h.visible = true;
      const u = h.userData;
      if (u.kind === 'scale') h.position.set(u.sx * hw, u.sy * hd, 0.05);
    }
    scaleHandles();
  }

  function layoutMultiOutline(sel) {
    const box = new THREE.Box3();
    sel.forEach((it) => { const e = meshes.get(it.id); if (e) box.expandByObject(e.mesh, true); });
    if (box.isEmpty()) return;
    handleRoot.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0);
    handleRoot.rotation.set(0, 0, 0);
    setOutline((box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, 0.05);
    handles.forEach((h) => { h.visible = false; });
  }

  function setOutline(hw, hd, z) {
    const p = outline.geometry.attributes.position;
    p.setXYZ(0, -hw, -hd, z); p.setXYZ(1, hw, -hd, z); p.setXYZ(2, hw, hd, z); p.setXYZ(3, -hw, hd, z);
    p.needsUpdate = true;
    outline.geometry.computeBoundingSphere();
  }

  // 画面上で一定の大きさに見えるようにする
  const tmp = new THREE.Vector3();
  function scaleHandles() {
    if (!handleRoot.visible) return;
    const it = selectedItems()[0];
    const entry = meshes.get(it?.id);
    const h = el.clientHeight || 1;
    for (const g of handles) {
      if (!g.visible) continue;
      g.getWorldPosition(tmp);
      const dist = camera.position.distanceTo(tmp);
      const perPx = (2 * dist * Math.tan((camera.fov * DEG) / 2)) / h;
      g.scale.setScalar(HANDLE_PX * perPx);
      const u = g.userData;
      const off = HANDLE_OFFSET_PX * perPx;
      if (u.kind === 'thick') {
        // 見失わないよう、どの向きから見ても表示する (厚さを変えられないストラップホールでは出さない)
        const locked = it ? isThicknessLocked(it) : false;
        g.children.forEach((c) => { c.visible = !locked; });
        g.scale.setScalar(THICK_HANDLE_PX * perPx);
        // 図形の本体と重ならないよう、右奥の角の外側 (上面の高さ) に置く
        const toff = THICK_OFFSET_PX * perPx;
        if (it && entry) g.position.set(it.w / 2 + toff, it.d / 2 + toff, entry.h + 0.1);
      } else if (u.kind === 'rot') {
        // 左奥の角の外側に置く。ななめから見ても丸と扇形が分かるよう、常に画面の方を向ける
        if (it) g.position.set(-it.w / 2 - off, it.d / 2 + off, 0.05);
        g.scale.setScalar(ROT_HANDLE_PX * perPx);
        g.quaternion.copy(handleRoot.quaternion).invert().multiply(camera.quaternion);
      } else if (u.sx === 0 || u.sy === 0) {
        // 小さい図形では、辺の中央のハンドルを隠して角のハンドルだけにする
        const len = it ? (u.sx === 0 ? it.w : it.d) : 0;
        g.children.forEach((c) => { c.visible = len > 60 * perPx; });
      }
    }
  }

  // ---------- 数値ラベル ----------
  function showLabel(e, text, warn = false) {
    const r = container.getBoundingClientRect();
    label.textContent = text;
    label.classList.toggle('warn', warn);
    label.hidden = false;
    let x = e.clientX - r.left + 18;
    let y = e.clientY - r.top - 44;
    x = Math.min(x, r.width - label.offsetWidth - 4);
    y = Math.max(y, 4);
    label.style.transform = `translate(${x}px, ${y}px)`;
  }
  const hideLabel = () => { label.hidden = true; };

  // ---------- 入力 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let drag = null;
  const touches = new Set(); // 画面に触れている指

  function setRay(clientX, clientY) {
    const r = el.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  const setNdc = (e) => setRay(e.clientX, e.clientY);

  function groundPoint() {
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
  }

  const snapMm = (v) => (state.snap ? Math.round(v / SNAP_MM) * SNAP_MM : round1(v));

  function pickItem() {
    const hits = raycaster.intersectObjects(itemRoot.children, false);
    if (!hits.length) return null;
    // 重なっているときは、選択中の図形を優先してつかむ
    const hitSel = hits.find((h) => state.selected.includes(h.object.userData.id));
    return (hitSel ?? hits[0]).object.userData.id;
  }

  function pickHandle() {
    if (!handleRoot.visible) return null;
    const targets = handles.filter((h) => h.visible && h.children[1].visible).map((h) => h.children[2]);
    const hits = raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].object.userData.handle : null;
  }

  function onDown(e) {
    if (e.pointerType === 'touch') {
      touches.add(e.pointerId);
      if (touches.size > 1) {
        // 2本目の指: 自分の操作は取りやめ、視点の操作 (拡大・移動) に任せる
        if (drag?.mode === 'box') { endBox(drag, null); drag = null; controls.enabled = true; }
        return;
      }
    }
    if (drag) return;
    // マウスの右・中ボタンは視点の操作
    if (e.pointerType === 'mouse' && e.button !== 0) { controls.enabled = true; return; }

    setNdc(e);
    const additive = e.shiftKey || state.multi;

    // 1) ハンドル
    const h = pickHandle();
    if (h) {
      controls.enabled = false;
      startHandleDrag(h, e);
      return;
    }

    // 2) 図形 → 必ず移動
    const id = pickItem();
    if (id) {
      controls.enabled = false;
      let toggleOffOnClick = false;
      if (additive) {
        if (state.selected.includes(id)) toggleOffOnClick = true; // 動かさずに離したら選択から外す
        else select([...state.selected, id]);
      } else if (!state.selected.includes(id)) {
        select([id]);
      }
      const p = groundPoint();
      drag = {
        mode: 'move', pointerId: e.pointerId, px: e.clientX, py: e.clientY, start: p, moved: false, id, toggleOffOnClick,
        items: selectedItems().map((it) => ({ it, x: it.x, y: it.y })),
      };
      el.setPointerCapture(e.pointerId);
      return;
    }

    // 3) 何もない所
    const boxMode = e.pointerType === 'mouse' || state.multi;
    if (boxMode) {
      // 範囲選択
      controls.enabled = false;
      drag = { mode: 'box', pointerId: e.pointerId, px: e.clientX, py: e.clientY, moved: false, additive, base: state.selected.slice() };
      el.setPointerCapture(e.pointerId);
    } else {
      // タッチ: 視点の回転。動かさずに離したら選択解除
      controls.enabled = true;
      drag = { mode: 'orbit', pointerId: e.pointerId, px: e.clientX, py: e.clientY, moved: false };
    }
  }

  function startHandleDrag(h, e) {
    const it = selectedItems()[0];
    if (!it) return;
    const u = h.userData;
    el.setPointerCapture(e.pointerId);
    checkpoint();
    const base = { it, x: it.x, y: it.y, w: it.w, d: it.d, rot: it.rot, t: itemThickness(it) };
    if (u.kind === 'scale') {
      drag = { mode: 'scale', pointerId: e.pointerId, sx: u.sx, sy: u.sy, base, min: minSizeFor(it) };
      showLabel(e, sizeText(it));
    } else if (u.kind === 'thick') {
      // 画面上で「上方向 (厚さ +1mm)」がどちらに何px動くかを調べ、マウスの移動量を mm に直す。
      // 真上から見たときは上方向が画面に出ないので、画面の上へのドラッグ = 厚く とする
      const h0 = new THREE.Vector3(), h1 = new THREE.Vector3();
      h.getWorldPosition(h0);
      h1.copy(h0); h1.z += 1;
      const a = toScreen(h0), b2 = toScreen(h1);
      let ux = b2.x - a.x, uy = b2.y - a.y;
      let len = Math.hypot(ux, uy);
      if (len < THICK_PX_PER_MM) {
        ux = 0; uy = -1; len = THICK_PX_PER_MM;
      } else {
        ux /= len; uy /= len;
      }
      drag = { mode: 'thick', pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, ux, uy, pxPerMm: len, base };
      showLabel(e, thickText(it));
    } else if (u.kind === 'rot') {
      const p = groundPoint();
      drag = { mode: 'rot', pointerId: e.pointerId, a0: Math.atan2(p.y - it.y, p.x - it.x), base };
      const r = Math.hypot(it.w, it.d) / 2 + 4;
      guide.position.set(it.x, it.y, 0.1);
      guide.scale.setScalar(r);
      guide.material.dashSize = guide.material.gapSize = 2 / r;
      guide.visible = true;
      showLabel(e, rotText(it));
    }
  }

  const sizeText = (it) => `よこ ${round1(it.w)} × たて ${round1(it.d)} mm`;
  const thickText = (it) => `あつさ ${round1(itemThickness(it))} mm`;
  const rotText = (it) => `${round1(it.rot)}°`;

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && drag.px != null && Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < DRAG_START_PX) return;
    const firstMove = !drag.moved;
    drag.moved = true;
    setNdc(e);
    const b = drag.base;
    if (drag.mode === 'move') {
      const p = groundPoint();
      if (!p || !drag.start) return;
      if (firstMove) checkpoint();
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      for (const s of drag.items) {
        s.it.x = snapMm(s.x + dx);
        s.it.y = snapMm(s.y + dy);
      }
      refreshTransforms(drag.items.map((s) => s.it));
    } else if (drag.mode === 'scale') {
      const p = groundPoint();
      if (!p) return;
      const it = b.it;
      const c = Math.cos(-b.rot * DEG), s = Math.sin(-b.rot * DEG);
      const lx = (p.x - b.x) * c - (p.y - b.y) * s;
      const ly = (p.x - b.x) * s + (p.y - b.y) * c;
      let cx = 0, cy = 0, w = b.w, d = b.d;
      if (drag.sx) {
        const fixed = -drag.sx * b.w / 2;
        w = Math.max(drag.min[0], snapMm((lx - fixed) * drag.sx));
        cx = fixed + drag.sx * w / 2;
      }
      if (drag.sy) {
        const fixed = -drag.sy * b.d / 2;
        d = Math.max(drag.min[1], snapMm((ly - fixed) * drag.sy));
        cy = fixed + drag.sy * d / 2;
      }
      const c2 = Math.cos(b.rot * DEG), s2 = Math.sin(b.rot * DEG);
      it.w = w; it.d = d;
      it.x = b.x + cx * c2 - cy * s2;
      it.y = b.y + cx * s2 + cy * c2;
      refreshTransforms([it]);
      showLabel(e, sizeText(it));
    } else if (drag.mode === 'thick') {
      const mm = ((e.clientX - drag.x0) * drag.ux + (e.clientY - drag.y0) * drag.uy) / drag.pxPerMm;
      const want = Math.round(b.t + mm);
      const before = itemThickness(b.it);
      const clamped = setThickness(b.it, want);
      if (itemThickness(b.it) !== before) {
        sync();
        emit('transform');
      }
      const tooThin = clamped && want < itemThickness(b.it);
      showLabel(e, tooThin ? `${thickText(b.it)}（これより うすく できないよ）` : thickText(b.it), tooThin);
    } else if (drag.mode === 'rot') {
      const p = groundPoint();
      if (!p) return;
      const a = Math.atan2(p.y - b.y, p.x - b.x);
      let r = b.rot + (a - drag.a0) / DEG;
      r = state.snap ? Math.round(r / SNAP_DEG) * SNAP_DEG : Math.round(r);
      b.it.rot = normAngle(r);
      refreshTransforms([b.it]);
      showLabel(e, rotText(b.it));
    } else if (drag.mode === 'box') {
      drawBox(drag.px, drag.py, e.clientX, e.clientY);
    }
  }

  function onUp(e) {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    guide.visible = false;
    hideLabel();
    controls.enabled = true;
    if (d.mode === 'move') {
      if (!d.moved && d.toggleOffOnClick) {
        select(state.selected.filter((s) => s !== d.id));
        return;
      }
    } else if (d.mode === 'box') {
      if (d.moved && e.type === 'pointerup') { endBox(d, e); return; }
      endBox(d, null);
      if (!d.additive && state.selected.length) select([]);
      return;
    } else if (d.mode === 'orbit') {
      if (!d.moved && e.type === 'pointerup' && state.selected.length) select([]);
      return;
    }
    emit();
  }

  // ---------- 範囲選択 ----------
  function drawBox(x0, y0, x1, y1) {
    const r = container.getBoundingClientRect();
    selBox.hidden = false;
    selBox.style.left = Math.min(x0, x1) - r.left + 'px';
    selBox.style.top = Math.min(y0, y1) - r.top + 'px';
    selBox.style.width = Math.abs(x1 - x0) + 'px';
    selBox.style.height = Math.abs(y1 - y0) + 'px';
  }

  function endBox(d, e) {
    selBox.hidden = true;
    if (!e) return;
    const rect = {
      x0: Math.min(e.clientX, d.px), x1: Math.max(e.clientX, d.px),
      y0: Math.min(e.clientY, d.py), y1: Math.max(e.clientY, d.py),
    };
    const ids = itemsInRect(rect);
    select(d.additive ? [...new Set([...d.base, ...ids])] : ids);
  }

  /** 枠に一部でもかかった図形を返す */
  function itemsInRect(rect) {
    camera.updateMatrixWorld();
    const r = el.getBoundingClientRect();
    const inside = (v) => {
      const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    };
    const result = [];
    const v = new THREE.Vector3();
    for (const it of state.items) {
      const entry = meshes.get(it.id);
      if (!entry) continue;
      const pos = entry.mesh.geometry.attributes.position;
      let hit = false;
      // (a) 図形の頂点が枠の中にある
      for (let i = 0; i < pos.count && !hit; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(entry.mesh.matrixWorld).project(camera);
        if (inside(v)) hit = true;
      }
      // (b) 枠の中の点が図形に当たる (大きな図形の内側に小さな枠を描いた場合など)
      for (let gx = 0; gx <= 6 && !hit; gx++) {
        for (let gy = 0; gy <= 6 && !hit; gy++) {
          setRay(rect.x0 + (rect.x1 - rect.x0) * gx / 6, rect.y0 + (rect.y1 - rect.y0) * gy / 6);
          if (raycaster.intersectObject(entry.mesh, false).length) hit = true;
        }
      }
      if (hit) result.push(it.id);
    }
    return result;
  }

  el.addEventListener('pointerdown', onDown, { capture: true });
  el.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.pointerId && drag.mode !== 'orbit') onUp(e); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- カメラ ----------
  function resetView() {
    camera.position.set(0, -115, 95);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function topView() {
    camera.position.set(0, -0.01, 190);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function zoom(f) {
    const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
    const len = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(off.setLength(len));
    controls.update();
  }
  resetView();

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    scaleHandles();
    renderer.render(scene, camera);
  });

  /** 確認ダイアログ用の画像 (ハンドルを隠して撮る) */
  /** プレビュー画像。ids を渡すと、その部品だけを写す */
  function snapshot(ids = null) {
    const hv = handleRoot.visible;
    handleRoot.visible = false;
    const hidden = [];
    if (ids) meshes.forEach((e, id) => { if (!ids.includes(id) && e.mesh.visible) { e.mesh.visible = false; hidden.push(e.mesh); } });
    // 選択中の明るさは写さない (はみだしの赤はそのまま)
    const lit = [];
    meshes.forEach((e) => { if (!e.outside && e.mesh.material.emissive.getHex() !== 0) { lit.push([e.mesh.material, e.mesh.material.emissive.getHex()]); e.mesh.material.emissive.set(0); } });
    // 作品全体が大きく写るように、一時的にカメラを寄せる
    const box = new THREE.Box3();
    meshes.forEach((e) => { if (e.mesh.visible) box.expandByObject(e.mesh); });
    const saved = { pos: camera.position.clone(), target: controls.target.clone() };
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
      const dist = radius / Math.sin((camera.fov * DEG) / 2) * 1.1;
      camera.position.copy(center).add(new THREE.Vector3(0, -0.6, 0.8).normalize().multiplyScalar(dist));
      camera.lookAt(center);
      camera.updateMatrixWorld();
    }
    renderer.render(scene, camera);
    const url = el.toDataURL('image/png');
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.update();
    handleRoot.visible = hv;
    hidden.forEach((m) => { m.visible = true; });
    lit.forEach(([m, hex]) => m.emissive.setHex(hex));
    renderer.render(scene, camera);
    return url;
  }

  // 3D座標 → 画面座標 (px)
  function toScreen(v) {
    camera.updateMatrixWorld();
    const q = v.clone().project(camera);
    const r = el.getBoundingClientRect();
    return { x: (q.x + 1) / 2 * r.width, y: (1 - q.y) / 2 * r.height };
  }

  // テスト用: 3D座標 → 画面座標
  function project(x, y, z) {
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = el.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }
  function handlePos(kind, sx, sy) {
    const h = handles.find((g) => g.userData.kind === kind && (sx == null || (g.userData.sx === sx && g.userData.sy === sy)));
    const p = new THREE.Vector3();
    h.getWorldPosition(p);
    return project(p.x, p.y, p.z);
  }

  return { sync, refreshTransforms, resetView, topView, zoom, anyOutside, snapshot, project, handlePos };
}

export function normAngle(r) {
  r = ((r % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

function buildPlate(scene) {
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATE_SIZE * 4, PLATE_SIZE * 4),
    new THREE.MeshBasicMaterial({ color: '#e3e8ee' }),
  );
  outer.position.z = -0.2;
  scene.add(outer);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE),
    new THREE.MeshBasicMaterial({ color: '#d6ebff' }),
  );
  plate.position.z = -0.1;
  scene.add(plate);

  const lines = (step, color) => {
    const pts = [];
    for (let v = -HALF; v <= HALF + 1e-6; v += step) {
      pts.push(new THREE.Vector3(v, -HALF, -0.05), new THREE.Vector3(v, HALF, -0.05));
      pts.push(new THREE.Vector3(-HALF, v, -0.05), new THREE.Vector3(HALF, v, -0.05));
    }
    return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
  };
  scene.add(lines(5, '#b3d4f5'));
  scene.add(lines(10, '#7fb2e5'));

  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HALF, -HALF, -0.04), new THREE.Vector3(HALF, -HALF, -0.04),
      new THREE.Vector3(HALF, HALF, -0.04), new THREE.Vector3(-HALF, HALF, -0.04),
    ]),
    new THREE.LineBasicMaterial({ color: '#1565c0' }),
  );
  scene.add(border);
}
