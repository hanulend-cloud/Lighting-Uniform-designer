#!/usr/bin/env python3
"""로컬 개발 서버 — 항상 최신 파일을 받도록 캐시 비활성화."""
import http.server, socket, socketserver, sys, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # 교차 출처 격리 — SharedArrayBuffer(형상 PSF 병렬 추적 풀)에 필요. credentialless: CDN(OCC) 모듈은 CORS 로 그대로 로드
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class ThreadingHTTPServer6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


# localhost 는 IPv6(::1)로도 풀린다 — IPv4 만 열면 Windows 에서 ::1 연결 거절을 기다리느라 요청마다 지연되어
# 모듈 Worker(3D 계산 풀) 15개가 모듈을 하나씩 받는 데 Worker 당 ≈1.6초씩 줄을 선다. 두 루프백 주소 모두 연다.
ThreadingHTTPServer.allow_reuse_address = True
servers = [ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)]
try:
    servers.append(ThreadingHTTPServer6(("::1", PORT), NoCacheHandler))
except OSError as e:
    print(f"IPv6 루프백(::1) 열기 실패 — IPv4 만: {e}")
for s in servers[1:]:
    threading.Thread(target=s.serve_forever, daemon=True).start()
print(f"serving http://localhost:{PORT}  (no-cache, {' + '.join('IPv6' if s.address_family == socket.AF_INET6 else 'IPv4' for s in servers)})")
servers[0].serve_forever()
