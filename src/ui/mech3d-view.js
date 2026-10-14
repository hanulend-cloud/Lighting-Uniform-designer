// 3D 기구 뷰 — spec 2026-10-14 §3. 부품을 소재 종류별 색으로 그리고, 선택 부품·면을 강조한다.
// 클릭(드래그 아님) → onPick({ part, face }) 또는 onPick(null). 회전·이동·확대는 OrbitControls(Z 위).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const KIND_COLOR = { milky: 0xdfe9f2, clear: 0x8cc8ff, whiteTrans: 0xf2efe6, opaque: 0x8a909c };
const KIND_OPACITY = { milky: 0.85, clear: 0.35, whiteTrans: 0.95, opaque: 1 };
const SEL_TINT = new THREE.Color(0xffb020), FACE_COLOR = new THREE.Color(0xff5a36);

export function createMech3dView(canvas, { onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1420);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1e5);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(1, -1, 2); scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  let meshes = [], partsRef = [], kinds = [], sel = null;

  function resize() {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  }
  new ResizeObserver(resize).observe(canvas);

  function colorize(i) {
    const m = meshes[i], p = partsRef[i], col = m.geometry.getAttribute('color');
    const base = new THREE.Color(KIND_COLOR[kinds[i]]);
    const partCol = sel?.part === i ? base.clone().lerp(SEL_TINT, 0.45) : base;
    const T = p.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      const c = sel?.part === i && sel.face === p.faceIds[t] ? FACE_COLOR : partCol;
      for (let j = 0; j < 3; j++) col.setXYZ(T[t * 3 + j], c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    m.material.opacity = KIND_OPACITY[kinds[i]];
    m.material.transparent = KIND_OPACITY[kinds[i]] < 1;
  }

  // parts: 런타임 scene.parts, kindsOf: 부품별 소재 종류 배열
  function setParts(parts, kindsOf) {
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    partsRef = parts; kinds = kindsOf.slice();
    meshes = parts.map((p, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.positions.length), 3));
      g.setIndex(new THREE.BufferAttribute(p.triangles, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, depthWrite: true }));
      m.userData.part = i;
      scene.add(m);
      return m;
    });
    meshes.forEach((_, i) => colorize(i));
    const box = new THREE.Box3(); meshes.forEach((m) => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(r * 1.2, -r * 1.6, r * 1.3));
    camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
    controls.update(); resize();
  }

  function setKinds(kindsOf) { kinds = kindsOf.slice(); meshes.forEach((_, i) => colorize(i)); render(); }
  function setSelection(s) { sel = s; meshes.forEach((_, i) => colorize(i)); render(); }

  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const h = ray.intersectObjects(meshes, false)[0];
    if (!h) { onPick(null); return; }
    const part = h.object.userData.part;
    onPick({ part, face: partsRef[part].faceIds[h.faceIndex] });
  });

  return { setParts, setKinds, setSelection, render };
}
