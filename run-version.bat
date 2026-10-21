@echo off
rem UDS - run a saved version side by side: run-version.bat <tag> <port>
rem Each version is checked out once into .worktrees\<tag> (git worktree, ignored by git) and served on its own port,
rem so each version keeps its own browser storage (projects do not mix).
setlocal
cd /d "%~dp0"
set TAG=%~1
set PORT=%~2
if "%TAG%"=="" ( echo usage: run-version.bat v1^|v2^|v3 port & pause & exit /b 1 )
set DIR=.worktrees\%TAG%
git rev-parse -q --verify "refs/tags/%TAG%" >nul 2>&1 || git fetch --tags -q
if not exist "%DIR%\index.html" (
  git worktree prune
  git worktree add --detach "%DIR%" %TAG% || ( echo Could not prepare version %TAG%. & pause & exit /b 1 )
) else (
  git -C "%DIR%" checkout -q --detach %TAG%
)
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:%PORT%/index.html
  exit /b
)
start "" http://127.0.0.1:%PORT%/index.html
cd /d "%DIR%"
title UDS %TAG% - http://127.0.0.1:%PORT%
python serve.py %PORT%
