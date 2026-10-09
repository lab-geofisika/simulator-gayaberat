@echo off
title Matikan Server Simulator Gayaberat
echo Menghentikan server simulator di port 8000 dan 8443...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000,8443 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; Write-Host ('  Port ' + $_.LocalPort + ' dihentikan (PID ' + $_.OwningProcess + ')') }"
echo Selesai.
pause
