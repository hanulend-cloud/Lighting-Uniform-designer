// 탭 동시 편집 잠금: node test/tab-lock.mjs
import { createTabLock, fakeBus } from '../src/ui/tab-lock.js';
import { fakeTimers, settle } from './m3-timers.mjs';
import { ok, done } from './mech3d-util.mjs';
import { createStore } from '../src/ui/m3/store.js';

const T = fakeTimers(), bus = fakeBus();
const roles = { a: [], b: [] };
const A = createTabLock({ channel: bus.open(), id: 'a', timers: T, onChange: (r) => roles.a.push(r) });
ok(A.role === 'pending' && !A.canWrite(), '시작 직후: 대기(아직 쓰지 않음)');
let wa = 0;
ok(A.write('spec', () => wa++) === false && wa === 0, '대기 중 저장 → 보류');
await T.advance(400);
ok(A.role === 'editor' && wa === 1, `응답 없음 → 편집 탭, 보류 저장 실행 (${A.role}, ${wa})`);
ok(A.write('spec', () => wa++) === true && wa === 2, '편집 탭 저장 → 즉시');

const B = createTabLock({ channel: bus.open(), id: 'b', timers: T, onChange: (r) => roles.b.push(r) });
let wb = 0;
B.write('spec', () => wb++);
await T.advance(400);
ok(B.role === 'readonly' && A.role === 'editor', `두 번째 탭 → 읽기 전용 (${B.role})`);
ok(wb === 0 && B.write('spec', () => wb++) === false && B.write('db', () => wb++) === false && wb === 0, '읽기 전용 탭 저장(설정·DB) 억제');

// 이어받기: B 가 take → A 읽기 전용, B 편집
B.take();
await settle();
ok(B.role === 'editor' && A.role === 'readonly', `이어받기 → 역할 교대 (A ${A.role}, B ${B.role})`);
ok(A.write('spec', () => wa++) === false && wa === 2, '이어받긴 탭 A 의 저장 억제(예약된 저장도 이 시점부터 무시)');
ok(B.write('spec', () => wb++) === true && wb === 1, '이어받은 탭 B 저장');
ok(roles.a.join() === 'editor,readonly' && roles.b.join() === 'readonly,editor', `역할 변경 알림 (${roles.a} / ${roles.b})`);

// 세션 플래그로 다시 연 탭(takeOnStart): 즉시 편집 + 다른 탭 읽기 전용
const C = createTabLock({ channel: bus.open(), id: 'c', timers: T, takeOnStart: true });
await settle();
ok(C.role === 'editor' && B.role === 'readonly' && A.role === 'readonly', 'takeOnStart → 즉시 편집, 나머지 읽기 전용');

// 동시에 연 두 탭(둘 다 대기) → 먼저 연(id 작은) 쪽만 편집
const T2 = fakeTimers(), bus2 = fakeBus();
const P = createTabLock({ channel: bus2.open(), id: '1', timers: T2 });
const Q = createTabLock({ channel: bus2.open(), id: '2', timers: T2 });
await T2.advance(400);
ok(P.role === 'editor' && Q.role === 'readonly', `동시 시작 → 하나만 편집 (P ${P.role}, Q ${Q.role})`);

// 3D 저장소의 디바운스 저장: 예약 직후 다른 탭이 이어받으면 실제 쓰기 없음
{
  const T3 = fakeTimers(), bus3 = fakeBus();
  const E = createTabLock({ channel: bus3.open(), id: 'e', timers: T3 });
  await T3.advance(400);
  let disk = 0;
  const st = createStore({}, { persist: () => E.write('spec', () => disk++), delay: 300, timers: T3 });
  st.update('material'); await T3.advance(300); ok(disk === 1, '편집 탭 디바운스 저장');
  st.update('material');
  const F = createTabLock({ channel: bus3.open(), id: 'f', timers: T3, takeOnStart: true });
  await T3.advance(300); st.flush();
  ok(E.role === 'readonly' && disk === 1, `이어받긴 탭의 예약 저장·flush 무시 (disk ${disk})`);
  st.dispose(); E.dispose(); F.dispose();
}

// 채널 없음(구형 브라우저) → 바로 편집
const N = createTabLock({ channel: null, id: 'n', timers: T2 });
ok(N.role === 'editor', '채널 없음 → 편집');

A.dispose(); B.dispose(); C.dispose(); P.dispose(); Q.dispose();
done();
