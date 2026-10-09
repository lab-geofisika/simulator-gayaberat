@echo off
chcp 65001 >nul
title Simulator Gayaberat - Server Wi-Fi HTTPS (gyro HP)
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python belum terpasang. Unduh dari https://www.python.org/downloads/ lalu jalankan lagi.
  pause
  exit /b
)
python -c "import cryptography" 2>nul || python -m pip install --user cryptography
python server.py --https %*
pause
