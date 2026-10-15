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
{   // 견고성: 구독자 격리 · 저장 오류 · dispose 뒤 갱신
  const T2 = fakeTimers(), errs = [], cerr = console.error;
  console.error = (...a) => errs.push(a);
  let n2 = 0, got = 0, tries = 0;
  const st2 = createStore({}, { persist: () => { tries++; throw new Error('디스크 가득'); }, delay: 300, timers: T2 });
  st2.subscribe(() => { throw new Error('구독자 오류'); });
  st2.subscribe(() => got++);
  let threw = false; try { st2.update('material'); } catch { threw = true; }
  ok(!threw && got === 1 && errs.length === 1, '구독자 하나가 던져도 update 는 던지지 않고 다른 구독자에게 알림');
  let rej = false; try { await T2.advance(300); } catch { rej = true; }
  ok(!rej && tries === 1 && errs.length === 2, '예약 저장이 던져도 예외가 새지 않음(console.error)');
  st2.update('light'); let fl = false; try { st2.flush(); } catch { fl = true; }
  ok(!fl && tries === 2, 'flush 저장 오류도 삼킴');
  st2.update('light'); let dz = false; try { st2.dispose(); } catch { dz = true; }
  ok(!dz && tries === 3, 'dispose 저장 오류도 삼킴');
  st2.subscribe(() => n2++); st2.update('light'); await T2.advance(1000);
  ok(tries === 3 && n2 === 0, 'dispose 뒤 update → 저장 예약·알림 없음');
  console.error = cerr;
}
done();
