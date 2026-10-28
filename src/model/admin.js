// 관리자 모드 — 켜면 소재 DB 관리(측정값 입력·피팅·편집·내보내기/불러오기)와 부품의 숫자 물성 칸이 보임.
// 기구 설계자 화면에서는 소재 이름만 고름. 브라우저 저장(uds.admin)
const KEY = 'uds.admin';
export function isAdmin() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setAdmin(on) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch {} }
