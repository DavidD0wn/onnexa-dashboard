@echo off
title Onnexa — Instalar Auto-sync
color 0B
cls

echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║   ONNEXA — Instalar Sincronización Automática ║
echo  ╚═══════════════════════════════════════════════╝
echo.
echo  Esto registrará 2 tareas automáticas en Windows:
echo.
echo  [1] Sync rapido  — cada hora (ultimos 3 dias)
echo  [2] Sync diario  — cada dia a las 7:00 AM (30 dias)
echo.
echo  Presiona cualquier tecla para instalar...
pause > nul

set PROJECT_DIR=%~dp0
set NODE_PATH=node
set SCRIPT=%PROJECT_DIR%scripts\autosync.js

echo.
echo  Instalando tareas...
echo.

:: ── Tarea 1: Cada hora (últimos 3 días) ──────────────────────────────────────
schtasks /delete /tn "Onnexa-Sync-Hourly" /f >nul 2>&1
schtasks /create ^
  /tn "Onnexa-Sync-Hourly" ^
  /tr "cmd /c cd /d \"%PROJECT_DIR%\" && %NODE_PATH% scripts\autosync.js 3 >> \"%PROJECT_DIR%logs\autosync.log\" 2>&1" ^
  /sc HOURLY ^
  /mo 1 ^
  /st 00:00 ^
  /ru "%USERNAME%" ^
  /f

if %ERRORLEVEL% EQU 0 (
  echo  [OK] Sync cada hora registrado
) else (
  echo  [ERROR] No se pudo registrar sync por hora
)

:: ── Tarea 2: Diaria a las 7 AM (últimos 30 días) ─────────────────────────────
schtasks /delete /tn "Onnexa-Sync-Daily" /f >nul 2>&1
schtasks /create ^
  /tn "Onnexa-Sync-Daily" ^
  /tr "cmd /c cd /d \"%PROJECT_DIR%\" && %NODE_PATH% scripts\autosync.js 30 >> \"%PROJECT_DIR%logs\autosync.log\" 2>&1" ^
  /sc DAILY ^
  /st 07:00 ^
  /ru "%USERNAME%" ^
  /f

if %ERRORLEVEL% EQU 0 (
  echo  [OK] Sync diario a las 7:00 AM registrado
) else (
  echo  [ERROR] No se pudo registrar sync diario
)

:: ── Crear carpeta de logs ─────────────────────────────────────────────────────
if not exist "%PROJECT_DIR%logs" mkdir "%PROJECT_DIR%logs"
echo  [OK] Carpeta de logs creada: logs\autosync.log

echo.
echo  ─────────────────────────────────────────────────
echo  ✓ Listo. Las tareas estan registradas en Windows.
echo.
echo  Para verlas: Busca "Programador de tareas" en Windows
echo               → Biblioteca → Onnexa-Sync-Hourly / Onnexa-Sync-Daily
echo.
echo  Para desinstalarlas: ejecuta DESINSTALAR-AUTOSYNC.bat
echo.
echo  IMPORTANTE: El servidor (INICIAR.bat) debe estar
echo  corriendo para que el sync funcione.
echo.
pause
