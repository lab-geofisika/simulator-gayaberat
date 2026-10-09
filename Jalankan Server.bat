@echo off
chcp 65001 >nul
title Simulator Gayaberat - Server Wi-Fi
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python belum terpasang. Unduh dari https://www.python.org/downloads/ lalu jalankan lagi.
  pause
  exit /b
)
python server.py %*
pause
