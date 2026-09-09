@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:5173/index.html
python serve.py 5173
