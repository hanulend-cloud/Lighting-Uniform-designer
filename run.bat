@echo off
rem UDS 실행 — 전용 포트 5180(다른 프로젝트의 5173·5174 와 겹치지 않게). 이미 떠 있으면 브라우저만 엶.
cd /d "%~dp0"
set PORT=5180
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:%PORT%/index.html
  exit /b
)
start "" http://127.0.0.1:%PORT%/index.html
python serve.py %PORT%
