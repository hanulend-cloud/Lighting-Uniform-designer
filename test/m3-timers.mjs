// 가짜 타이머(setTimeout/setInterval) + 비동기 정착 — store·progressive 시험용
export const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
export function fakeTimers() {
  let now = 0, seq = 0;
  const q = new Map(), add = (f, ms, every) => { q.set(++seq, { at: now + ms, f, every }); return seq; };
  return {
    setTimeout: (f, ms) => add(f, ms, 0), clearTimeout: (i) => { q.delete(i); },
    setInterval: (f, ms) => add(f, ms, ms), clearInterval: (i) => { q.delete(i); },
    now: () => now,
    // ms 만큼 시간을 보내며 만기 타이머를 시간 순서로 실행(실행마다 비동기 정착)
    async advance(ms) {
      const end = now + ms;
      await settle();
      for (;;) {
        let id = null, t = null;
        for (const [i, x] of q) if (x.at <= end && (!t || x.at < t.at)) { id = i; t = x; }
        if (!t) break;
        now = t.at;
        if (t.every) t.at += t.every; else q.delete(id);
        t.f();
        await settle();
      }
      now = end;
    },
  };
}
