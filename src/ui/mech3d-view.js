// 3D 기구 뷰 — spec 2026-10-14 §3, 2026-10-15 m3-cad-ui §2. 부품을 소재 종류별 색으로 그리고, 선택 부품·면을 강조한다.
// 보기: 등각(원근) · 평면 XY / 정면 XZ / 측면 YZ(정투영). 원점 축 + 회전 축 창(gizmo). 관측면 색지도 덧그림, 설계 점검 표식, 단면 평면.
// 클릭(드래그 아님) → onPick({ part, face, ray:{o,d}, worldPerPixel }) 또는 onPick(null)(선택 모드에선 { part:null, face:null, ray }).
// 회전·이동·확대는 OrbitControls(Z 위): 드래그 회전, 휠 확대, 우클릭·Shift 드래그 이동.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const KIND_COLOR = { milky: 0xdfe9f2, clear: 0x8cc8ff, whiteTrans: 0xf2efe6, opaque: 0x8a909c, pcb: 0x2f6b3a, led: 0xffcf3f };
const KIND_OPACITY = { milky: 0.85, clear: 0.35, whiteTrans: 0.95, opaque: 1, pcb: 1, led: 1 };
const LED_SEL = new THREE.Color(0xff7a1a), CONE_DARK = 0xffd84a, CONE_LIGHT = 0xc98a00, CONE_SEL = 0xff7a1a, CONE_SEG = 16, CONE_RAYS = 6;   // 빛 원뿔 = 노란 점선(흐리게), 선택 LED 몸체·원뿔 = 주황 점선
const SEL_TINT = new THREE.Color(0xffb020), FACE_COLOR = new THREE.Color(0xff5a36), OBS_COLOR = new THREE.Color(0x29d3e0);
// 보기 방향(카메라 쪽). 평면은 z 축과 아주 조금 어긋나게 — up(z) 을 바꾸지 않으려고(OrbitControls 회전축은 생성 때 up 으로 고정)
const VIEW_DIR = { top: [0, -1e-3, 1], front: [0, -1, 0], side: [1, 0, 0], iso: [0.7, -1.1, 0.9] };
const SECTION_N = { x: [-1, 0, 0], y: [0, -1, 0], z: [0, 0, -1] };   // 단면: 좌표 ≤ pos 쪽만 남김

export function createMech3dView(canvas, { onPick, gizmo = null }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  // 배경 테마: 'light' = 흐린 회색(화면 전체와 통일), 'dark' = 어두운 남색. 빛 원뿔 색도 대비에 맞춤
  const BG = { light: 0xe6e9ee, dark: 0x0f1420 };
  let theme = 'light', CONE_COLOR = CONE_LIGHT, lastOver = null;
  scene.background = new THREE.Color(BG.light);
  const persp = new THREE.PerspectiveCamera(35, 1, 0.1, 1e5);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1e5);
  persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);
  // orthoHalf = 모델 외곽 구가 들어가는 정투영 반높이(가로가 좁으면 resize 에서 ÷ 가로세로비로 키움 — 시안의 aspect 맞춤)
  let camera = persp, viewName = 'iso', model = { c: new THREE.Vector3(), r: 10 }, orthoHalf = 10;
  // 숨은 캔버스(폭 0)에서는 1 — 이때 맞춤은 pendingFit 으로 미뤘다가 첫 표시(resize) 때 다시 한다
  const aspect = () => (canvas.clientWidth > 0 ? canvas.clientWidth / (canvas.clientHeight || 400) : 1);
  let pendingFit = false;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xa8b0bd, 1.25); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.9); scene.add(amb);   // 밝은 테마 주변광 — 어두운 테마는 낮춤   // 아래쪽 보조광: 밝은 테마는 밝게(측면이 검게 가라앉지 않게)
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(1, -1, 2); scene.add(sun);
  // 원점 축: x 빨강 · y 초록 · z 파랑. CAD 관례대로 원점에 두고(모델 구석으로 옮기지 않음) 길이만 모델 크기(r)에 맞춘다
  const axes = new THREE.AxesHelper(10); scene.add(axes);
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = true;            // 휠 확대(OrbitControls 가 캔버스 wheel 을 직접 처리)
  controls.screenSpacePanning = true;    // 우클릭·Shift 드래그 = 화면 평면 이동
  const clip = [];                       // 단면 평면(0 또는 1개) — 부품·덧그림 재질이 같은 배열을 공유

  // 회전 축 창(왼쪽 아래 작은 캔버스): 카메라 방향만 따라 도는 축 + X/Y/Z 글자
  let gz = null;
  if (gizmo) {
    const r = new THREE.WebGLRenderer({ canvas: gizmo, antialias: true, alpha: true }), s = new THREE.Scene(), c = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    c.up.set(0, 0, 1); s.add(new THREE.AxesHelper(1.2));
    const lbl = (t, col, p) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d'); x.fillStyle = col; x.font = 'bold 44px sans-serif'; x.fillText(t, 16, 46);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex })); sp.position.set(...p); sp.scale.set(0.5, 0.5, 0.5); s.add(sp);
    };
    lbl('X', '#ff5555', [1.5, 0, 0]); lbl('Y', '#55dd55', [0, 1.5, 0]); lbl('Z', '#5599ff', [0, 0, 1.5]);
    gz = { r, s, c };
  }
  const render = () => {
    renderer.render(scene, camera);
    if (gz) { gz.c.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(4); gz.c.up.copy(camera.up); gz.c.lookAt(0, 0, 0); gz.r.render(gz.s, gz.c); }
  };
  // 원근 near/far 를 모델 둘레로 좁힌다(r≈700mm 같은 큰 모델에서 깊이 정밀도) — 카메라 ~ 모델 중심 거리 기준.
  // (controls.target 은 이동(pan)으로 모델에서 멀어질 수 있어 모델 중심을 쓴다.) 정투영은 거리가 고정이라 setView 값 그대로
  function fitDepth() {
    if (!camera.isPerspectiveCamera) return;
    const { c, r } = model, d = camera.position.distanceTo(c);
    const near = Math.max(r / 1000, d - 1.5 * r), far = d + 1.5 * r;
    if (near !== camera.near || far !== camera.far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
  }
  controls.addEventListener('change', () => { fitDepth(); render(); });

  let meshes = [], partsRef = [], kinds = [], sel = null, obsSet = new Set(), overlay = null, obsMesh = null, markers = null, coneMeshes = [];

  function resize() {
    if (canvas.clientWidth === 0) return;
    if (pendingFit) { pendingFit = false; setView(viewName); return; }   // 숨김 중 미룬 맞춤 — setView 가 resize 를 다시 부른다
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr); if (gz) gz.r.setPixelRatio(dpr);
    const w = canvas.clientWidth, h = canvas.clientHeight || 400, a = w / h, half = orthoHalf / Math.min(1, a);
    renderer.setSize(w, h, false);
    persp.aspect = a; persp.updateProjectionMatrix();
    ortho.left = -half * a; ortho.right = half * a; ortho.top = half; ortho.bottom = -half; ortho.updateProjectionMatrix();
    if (gz) gz.r.setSize(gizmo.clientWidth || 90, gizmo.clientHeight || 90, false);
    render();
  }
  new ResizeObserver(resize).observe(canvas);

  function colorize(i) {
    const m = meshes[i], p = partsRef[i], col = m.geometry.getAttribute('color');
    const base = new THREE.Color(KIND_COLOR[kinds[i]]);
    const partCol = sel?.part === i ? (kinds[i] === 'led' ? LED_SEL : base.clone().lerp(SEL_TINT, 0.6)) : base;
    const T = p.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      const isSel = sel?.part === i && sel.face === p.faceIds[t];
      const c = isSel ? FACE_COLOR : obsSet.has(`${i}|${p.faceIds[t]}`) ? OBS_COLOR : partCol;
      for (let j = 0; j < 3; j++) col.setXYZ(T[t * 3 + j], c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    let op = ghost?.(i) ? Math.min(0.15, KIND_OPACITY[kinds[i]]) : KIND_OPACITY[kinds[i]];   // 투시: LED 선택 중 기구물 반투명
    if (sel?.part === i && !ghost?.(i)) op = Math.max(op, 0.7);   // 선택 부품: 투명 소재여도 잘 보이게
    m.material.opacity = op;
    m.material.transparent = op < 1;
    m.material.depthWrite = !m.material.transparent; m.renderOrder = m.material.transparent ? 1 : 0;
  }

  // 보기 전환: 등각 = 원근, 나머지 = 정투영. 모델 외곽 구(model)에 맞춘다
  function setView(name) {
    viewName = VIEW_DIR[name] ? name : 'iso';
    const { c, r } = model, d = new THREE.Vector3(...VIEW_DIR[viewName]).normalize();
    camera = viewName === 'iso' ? persp : ortho;
    // 원근: 세로 반화각 17.5° 로 외곽 구가 들어가는 거리, 가로가 좁으면 ÷ 가로세로비(시안과 같은 맞춤)
    const dist = viewName === 'iso' ? ((r / Math.sin((17.5 * Math.PI) / 180)) * 1.1) / Math.min(1, aspect()) : r * 4;
    camera.position.copy(c).addScaledVector(d, dist);
    camera.near = Math.max(1e-3, r / 100); camera.far = dist + r * 100;
    if (camera.isOrthographicCamera) { orthoHalf = r * 1.1; camera.zoom = 1; }
    controls.object = camera; controls.target.copy(c); camera.lookAt(c);
    controls.minDistance = r * 0.02;
    fitDepth(); camera.updateProjectionMatrix();   // resize() 가 숨김으로 건너뛰어도 near/far·zoom 반영
    if (canvas.clientWidth === 0) pendingFit = true;   // 가로세로비를 모름 → 첫 표시 때 다시 맞춤
    resize(); controls.update(); render();
  }
  const fit = () => setView(viewName);

  // parts: 런타임 scene.parts, kindsOf: 부품별 소재 종류 배열, keepCamera: 카메라를 다시 맞추지 않음(LED 위치 보정 등)
  function setParts(parts, kindsOf, { keepCamera = false } = {}) {
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    partsRef = parts; kinds = kindsOf.slice();
    meshes = parts.map((p, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.positions.length), 3));
      g.setIndex(new THREE.BufferAttribute(p.triangles, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, clippingPlanes: clip }));
      m.userData.part = i;
      m.visible = !hiddenFn?.(i);
      scene.add(m);
      return m;
    });
    meshes.forEach((_, i) => colorize(i));
    updateOutline();   // 메쉬가 새로 만들어졌으므로 선택 외곽선도 다시
    const box = new THREE.Box3(); meshes.forEach((m) => box.expandByObject(m));
    model = { c: box.getCenter(new THREE.Vector3()), r: box.getSize(new THREE.Vector3()).length() / 2 || 10 };
    axes.scale.setScalar((model.r * 0.3) / 10);
    liftObs();
    if (keepCamera) { render(); return; }
    setView(viewName);
  }

  // 바뀐 부품만 재착색
  function setKinds(kindsOf) {
    const old = kinds; kinds = kindsOf.slice();
    meshes.forEach((_, i) => { if (old[i] !== kinds[i]) colorize(i); }); render();
  }
  // LED 빛 원뿔(spec m3-cad-ui §4a) — 꼭짓점 = 발광점, 축 = 발광 방향, 반각 = 배광/2(그림은 80° 까지), 길이 len(축 방향).
  // 원뿔 여럿을 기하 하나로 합친다(LED ~120개도 메쉬 1개). 삼각형 k·CONE_SEG… = 원뿔 k → userData.nums[k] = LED 번호(클릭용)
  function coneMesh(list, color, opacity) {
    const P = new Float32Array(list.length * (CONE_SEG + 1) * 3), I = new Uint32Array(list.length * CONE_SEG * 3);
    list.forEach((c, k) => {
      const a = new THREE.Vector3(...c.axis).normalize(), u = new THREE.Vector3(Math.abs(a.x) < 0.9 ? 1 : 0, Math.abs(a.x) < 0.9 ? 0 : 1, 0).cross(a).normalize(), w = a.clone().cross(u);
      const len = c.len > 0 ? c.len : 4, r = len * Math.tan((Math.min(80, Math.max(1, c.half)) * Math.PI) / 180), b0 = k * (CONE_SEG + 1);
      P.set(c.pos, b0 * 3);
      for (let i = 0; i < CONE_SEG; i++) {
        const t = (2 * Math.PI * i) / CONE_SEG, q = (b0 + 1 + i) * 3;
        for (let j = 0; j < 3; j++) P[q + j] = c.pos[j] + a.getComponent(j) * len + r * (Math.cos(t) * u.getComponent(j) + Math.sin(t) * w.getComponent(j));
        I.set([b0, b0 + 1 + i, b0 + 1 + ((i + 1) % CONE_SEG)], (k * CONE_SEG + i) * 3);
      }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1));
    // 면은 그리지 않고 클릭 판정에만 쓴다(colorWrite 끔) — 보이는 것은 coneLines 의 점선
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.renderOrder = 2; m.userData.nums = list.map((c) => c.n);
    return m;
  }
  // 원뿔 윤곽 점선: 테두리 원 + 꼭짓점→테두리 선 CONE_RAYS 개
  function coneLines(list, color, opacity) {
    const pts = [];
    list.forEach((c) => {
      const a = new THREE.Vector3(...c.axis).normalize(), u = new THREE.Vector3(Math.abs(a.x) < 0.9 ? 1 : 0, Math.abs(a.x) < 0.9 ? 0 : 1, 0).cross(a).normalize(), w = a.clone().cross(u);
      const len = c.len > 0 ? c.len : 4, r = len * Math.tan((Math.min(80, Math.max(1, c.half)) * Math.PI) / 180), o = new THREE.Vector3(...c.pos);
      const rim = (t) => o.clone().addScaledVector(a, len).addScaledVector(u, r * Math.cos(t)).addScaledVector(w, r * Math.sin(t));
      for (let i = 0; i < CONE_SEG; i++) pts.push(rim((2 * Math.PI * i) / CONE_SEG), rim((2 * Math.PI * (i + 1)) / CONE_SEG));
      for (let i = 0; i < CONE_RAYS; i++) pts.push(o.clone(), rim((2 * Math.PI * i) / CONE_RAYS));
    });
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const ls = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity, depthWrite: false, depthTest: false }));
    ls.computeLineDistances(); ls.renderOrder = 2;
    return ls;
  }
  // over = { obsFaces:[{part,face}], line3d: Float32Array(x,y,z...) | null, cones:[{pos,axis,half(°),len,n}], coneSel: LED 번호 | null } — 관측면 강조, 라인, LED 빛 원뿔
  // 원뿔은 표시 전용(관측면 색지도·점검 표식과 별개 무리) · 선택 모드가 아닐 때 클릭하면 onPick({ led: n })
  function setTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
    scene.background = new THREE.Color(BG[theme]);
    CONE_COLOR = theme === 'dark' ? CONE_DARK : CONE_LIGHT;
    hemi.groundColor.set(theme === 'dark' ? 0x404050 : 0xa8b0bd); hemi.intensity = theme === 'dark' ? 1.0 : 1.25; amb.intensity = theme === 'dark' ? 0 : 0.9;
    if (lastOver) setOverlay(lastOver); else render();
  }
  function setOverlay(over) {
    lastOver = over;
    const prev = obsSet;
    obsSet = new Set((over.obsFaces ?? []).map((f) => `${f.part}|${f.face}`));
    if (overlay) { scene.remove(overlay); overlay.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    overlay = new THREE.Group(); coneMeshes = [];
    if (over.line3d?.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(over.line3d, 3));
      const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x29d3e0, depthTest: false }));
      ln.renderOrder = 2; overlay.add(ln);
    }
    const cs = over.cones ?? [], on = cs.filter((c) => c.n === over.coneSel), off = cs.filter((c) => c.n !== over.coneSel);
    if (off.length) { coneMeshes.push(coneMesh(off, CONE_COLOR, 0)); overlay.add(coneLines(off, CONE_COLOR, 0.45)); }
    if (on.length) { coneMeshes.push(coneMesh(on, CONE_SEL, 0)); overlay.add(coneLines(on, CONE_SEL, 0.9)); }
    coneMeshes.forEach((m) => overlay.add(m));
    scene.add(overlay);
    const touched = new Set([...prev, ...obsSet].map((k) => +k.split('|')[0]));
    meshes.forEach((_, i) => { if (touched.has(i)) colorize(i); }); render();
  }
  // 선택 강조: 색 강조 + 밝은 외곽선(다른 부품에 가려도 보이게 깊이 검사 끔)
  let selOutline = null;
  function updateOutline() {
    if (selOutline) { scene.remove(selOutline); selOutline.geometry.dispose(); selOutline.material.dispose(); selOutline = null; }
    const m = sel?.part != null ? meshes[sel.part] : null;
    if (m && !m.visible) return;   // 숨긴 부품은 외곽선도 감춤
    if (!m) return;
    selOutline = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true, opacity: 0.95 }));
    selOutline.renderOrder = 3;
    scene.add(selOutline);
  }
  function setSelection(s) {
    const prevPart = sel?.part;
    sel = s;
    meshes.forEach((_, i) => colorize(i));
    if (prevPart !== sel?.part || !selOutline !== !sel) updateOutline();
    render();
  }
  // 선택 모드별 클릭 대상·투시: pickable(i) = 클릭 가능한 부품, ghostOf(i) = 반투명으로 비출 부품(둘 다 null = 전체/없음)
  let pickable = null, ghost = null, hiddenFn = null;
  // 보기 켜기/끄기: hiddenOf(i) = true 이면 그리지 않고 클릭도 안 됨(null = 모두 보임)
  function setHidden(hiddenOf) {
    hiddenFn = hiddenOf;
    meshes.forEach((m, i) => { m.visible = !hiddenFn?.(i); });
    updateOutline(); render();
  }
  function setPickMode(pickableFn, ghostFn) { pickable = pickableFn; ghost = ghostFn; meshes.forEach((_, i) => colorize(i)); render(); }

  // 단면: sec = { axis:'x'|'y'|'z', pos } | null
  function setSection(sec) {
    clip.length = 0;
    if (sec) clip.push(new THREE.Plane(new THREE.Vector3(...SECTION_N[sec.axis]), sec.pos));
    render();
  }
  // 관측면 색지도 덧그림(colormap.buildObsOverlay) — 모양은 격자가 바뀔 때만, 색은 setObsColors 로 자주.
  // geom = { positions, triangles, dir? }: buildObsOverlay 가 이미 0.05mm 띄웠으므로, 큰 모델(lift = max(0.05, r·1e-4))에서
  // 모자라는 만큼만 관측 방향 dir 로 메쉬를 더 띄운다(dir 없으면 polygonOffset 만)
  let obsDir = null;
  function liftObs() {
    if (!obsMesh) return;
    const extra = Math.max(0.05, model.r * 1e-4) - 0.05;
    if (obsDir && extra > 0) obsMesh.position.set(...obsDir).normalize().multiplyScalar(extra); else obsMesh.position.set(0, 0, 0);
  }
  function setObsSurface(geom) {
    if (obsMesh) { scene.remove(obsMesh); obsMesh.geometry.dispose(); obsMesh.material.dispose(); obsMesh = null; }
    if (geom) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geom.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geom.positions.length).fill(0.45), 3));
      g.setIndex(new THREE.BufferAttribute(geom.triangles, 1));
      obsMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      obsMesh.renderOrder = 1.5;
      obsDir = geom.dir ?? null; liftObs();
      scene.add(obsMesh);
    }
    render();
  }
  function setObsColors(colors) {
    if (!obsMesh) return;
    const a = obsMesh.geometry.getAttribute('color'); a.array.set(colors); a.needsUpdate = true; render();
  }
  // 설계 점검 표식: ring(원, 화면을 향함) · line(거리선) · tris(새는 면 강조). 깊이 무시(가려도 보임).
  // 단면 평면(clip)은 일부러 적용하지 않는다 — 잘린 쪽에 있는 문제 위치도 보여야 하므로
  const ringTex = new Map();
  function ringTexture(color) {
    if (!ringTex.has(color)) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d'); x.strokeStyle = `#${color.toString(16).padStart(6, '0')}`; x.lineWidth = 7; x.beginPath(); x.arc(32, 32, 26, 0, 2 * Math.PI); x.stroke();
      ringTex.set(color, new THREE.CanvasTexture(cv));
    }
    return ringTex.get(color);
  }
  function setCheckMarkers(list) {
    // Sprite 기하는 three 가 공유하므로 버리지 않는다(재질만 — 원 텍스처는 ringTex 캐시가 유지)
    if (markers) { scene.remove(markers); markers.traverse((o) => { if (!o.isSprite) o.geometry?.dispose(); o.material?.dispose(); }); }
    markers = new THREE.Group();
    for (const m of list ?? []) {
      let o;
      if (m.type === 'ring') {
        o = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(m.color), depthTest: false, transparent: true }));
        const s = (model.r * 0.04 * (m.size ?? 12)) / 12; o.scale.set(s, s, s); o.position.set(...m.pos);
      } else if (m.type === 'line') {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([...m.a, ...m.b]), 3));
        o = new THREE.Line(g, new THREE.LineBasicMaterial({ color: m.color, depthTest: false }));
      } else if (m.type === 'tris') {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
        o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: m.opacity ?? 0.5, side: THREE.DoubleSide, depthTest: false }));
      } else continue;
      o.renderOrder = 3; markers.add(o);
    }
    scene.add(markers); render();
  }

  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.isPrimary) down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // 단면 중이면 잘려 안 보이는 쪽(평면 거리 < 0)의 교차는 건너뛰고 다음 교차를 쓴다(Raycaster 는 clipping 을 모름)
    // 빛 원뿔(위에 그려짐)이 먼저 — 선택 모드가 아닐 때만. 선택 원뿔을 앞에 둔다
    const ch = pickable ? null : ray.intersectObjects([...coneMeshes].reverse(), false)[0];
    if (ch) { onPick({ part: null, face: null, led: ch.object.userData.nums[Math.floor(ch.faceIndex / CONE_SEG)] }); return; }
    const hits = ray.intersectObjects(meshes.filter((m) => m.visible && (!pickable || pickable(m.userData.part))), false);
    const h = clip.length ? hits.find((x) => clip[0].distanceToPoint(x.point) >= 0) : hits[0];
    // 선택 모드(pickable 지정)에서는 클릭 광선도 넘긴다 — 빈 곳 클릭이어도 { part: null, face: null, ray } (가까운 LED 맞춤용)
    const rr = { o: ray.ray.origin.toArray(), d: ray.ray.direction.toArray() };
    // 클릭 깊이의 화소당 mm(LED 맞춤 반경용) — 정투영은 깊이와 무관
    const H = canvas.clientHeight || 400;
    const wpp = camera.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom / H
      : (2 * (h ? h.distance : Math.max(camera.near, controls.target.clone().sub(ray.ray.origin).dot(ray.ray.direction))) * Math.tan((camera.fov * Math.PI) / 360)) / H;
    if (!h) { onPick(pickable ? { part: null, face: null, ray: rr, worldPerPixel: wpp } : null); return; }
    const part = h.object.userData.part;
    onPick({ part, face: partsRef[part].faceIds[h.faceIndex], ray: rr, worldPerPixel: wpp });
  });

  return { setTheme, theme: () => theme, setParts, setKinds, setHidden, setSelection, setOverlay, setPickMode, render, setView, fit, viewName: () => viewName, setSection, setObsSurface, setObsColors, setCheckMarkers };
}
