// L2 소재 해석 — 사용자 입력(Milky, PCB 색)을 물성(μs', g, μa)과 기판 반사율로 바꾼다 (spec §4, §5.1, §5.3-⑦).
// 추상 슬라이더 소재: g = 0.9(확산판 대표값), μa = μa_resin + κ·μs (임시값 — 가정 패널에 표기, 실측 소재 등록은 단계 B).
import { musRFromMilky } from './milky.js';

export const L2_G = 0.9;
export const MUA_RESIN = 0.0005;   // 1/mm — 투명 PC 수준
export const KAPPA = 1e-4;         // 산란제 흡수 비율(μa_p = κ·μs)
export const PCB_REFL = { '혼재': 0.5, '백색': 0.8, '녹색': 0.3, '흑색': 0.05 };   // 임시값
export const MILKY_UI_MAX = 9.9, MILKY_SEARCH_MAX = 9.5;

export function l2Material(table, milky, n) {
  const m = Math.max(0, Math.min(milky ?? 0, 9.999));   // 10 = 투과 0 극한 → 유한값으로 캡
  const musR = musRFromMilky(table, m);
  const mus = musR / (1 - L2_G);
  return { milky: m, musR, g: L2_G, mua: MUA_RESIN + KAPPA * mus, n };
}

export function pcbReflectance(pcb) { return PCB_REFL[pcb] ?? PCB_REFL['혼재']; }

// 저장 스펙 ver<13 의 구 Milky(1~10 휴리스틱: 투과율 (1−R_d)/(1−ρ), R_d=0.9·(m−1)/9, ρ=R_d·0.5) 를
// 같은 차폐율의 새 눈금으로 변환, 9.0 상한(구 10 이 새 눈금의 완전 차폐로 바뀌지 않게).
export function migrateMilkyV13(m) {
  const t = Math.min(1, Math.max(0, ((m ?? 1) - 1) / 9)), Rd = 0.9 * t, rho = Rd * 0.5;
  return Math.round(Math.min(9, 10 * (1 - (1 - Rd) / (1 - rho))) * 10) / 10;
}
