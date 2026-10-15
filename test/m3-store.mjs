// CAD UI 상태 저장소: node test/m3-store.mjs
import { createStore, TAGS, PHYSICS, GEOM_CHECK } from '../src/ui/m3/store.js';
import { fakeTimers } from './m3-timers.mjs';
import { ok, done } from './mech3d-util.mjs';

const T = fakeTimers();
let saved = 0;
const st = createStore({ a: 1 }, { persist: () => saved++, delay: 300, timers: T });
const seen = [], un = st.subscribe((t) => seen.push(t));
ok(st.session.node === null && st.session.pick === null && st.session.view === 'iso' && st.session.section === null && st.session.calc === null, '세션 초기값');
st.update('material', (m, s) => { m.a = 2; s.status = 'x'; });
st.update('target');
ok(st.mspec.a === 2 && st.session.status === 'x' && seen.join() === 'material,target' && saved === 0, '갱신 함수 적용 → 태그 순서대로 알림, 저장은 아직');
await T.advance(299); ok(saved === 0, '299ms: 저장 전(디바운스)');
await T.advance(1); ok(saved === 1, '300ms: 두 변경을 한 번에 저장');
st.update('view'); st.update('session'); await T.advance(1000);
ok(saved === 1, 'view·session 은 저장하지 않음');
st.update('observe'); st.flush(); ok(saved === 2, 'flush → 즉시 저장');
await T.advance(1000); ok(saved === 2, 'flush 뒤 예약 저장 취소');
let thrown = false; try { st.update('nope'); } catch (e) { thrown = /알 수 없는 변경 태그/.test(e.message); }
ok(thrown, '모르는 태그 → 오류');
un(); st.update('light'); ok(seen.length === 5, `구독 해제 뒤 알림 없음 (${seen.join()})`);
ok(TAGS.length === 7 && ['material', 'light', 'observe', 'contacts'].every((t) => PHYSICS.has(t)) && !PHYSICS.has('target') && !PHYSICS.has('view') && !PHYSICS.has('session'), '물리 태그 = material·light·observe·contacts');
ok(['material', 'light', 'observe', 'target'].every((t) => GEOM_CHECK.has(t)) && !GEOM_CHECK.has('contacts'), '기하 점검 태그 = material·light·observe·target(기준값)');
st.dispose(); await T.advance(1000); ok(saved === 3, 'dispose → 남은 저장 실행(light 변경)');
done();
