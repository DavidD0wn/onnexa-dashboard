@echo off
title Onnexa Dashboard
color 0A
cls
echo.
echo  ============================================
echo   ONNEXA COMMAND CENTER — Iniciando...
echo  ============================================
echo.
echo  Dashboard: http://localhost:3000
echo  Sync:      automatico cada 1 hora
echo.

cd /d "%~dp0"

:: Crear carpeta de logs si no existe
if not exist "logs" mkdir logs

:: Si el daemon ya esta corriendo via Task Scheduler, no lo volvemos a lanzar
:: De lo contrario, lo iniciamos en segundo plano
tasklist /FI "WINDOWTITLE eq Onnexa Sync Daemon" 2>NUL | find /I "cmd.exe" >NUL
if %ERRORLEVEL% NEQ 0 (
  start "Onnexa Sync Daemon" /min cmd /c "node scripts\daemon.js"
  echo  Sync daemon iniciado en segundo plano.
) else (
  echo  Sync daemon ya esta corriendo.
)

:: Pequeña pausa para que el daemon conecte
timeout /t 3 /nobreak > nul

:: Abrir el navegador
start "" http://localhost:3000

:: Iniciar servidor Next.js
npm run dev
