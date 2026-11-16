@echo off
chcp 65001 >nul
title IoT WebApp & NotifyEngine - Always-On Background Push Server
cd /d "%~dp0"

:loop
echo ==========================================================
echo [%date% %time%] Starting IoT WebApp & NotifyEngine Server...
echo ==========================================================
node server.js
echo.
echo [!] Server stopped or restarted. Rebooting in 3 seconds...
timeout /t 3 >nul
goto loop
