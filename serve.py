#!/usr/bin/env python3
"""로컬 개발 서버 — 항상 최신 파일을 받도록 캐시 비활성화."""
import http.server, socketserver, sys

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


ThreadingHTTPServer.allow_reuse_address = True
with ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
    print(f"serving http://127.0.0.1:{PORT}  (no-cache)")
    httpd.serve_forever()
