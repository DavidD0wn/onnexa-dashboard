@echo off
:: INSTALAR-DAEMON.bat
:: Registra el daemon de sync en el Programador de Tareas de Windows.
:: Corre UNA sola vez como administrador para dejarlo automatico para siempre.

title Onnexa — Instalar Sync Automatico
color 0A
cls
echo.
echo  ============================================================
echo   ONNEXA — Instalando Sync Automatico de Shopify
echo  ============================================================
echo.
echo  Esto configura Windows para sincronizar Shopify
echo  automaticamente al encender la PC, sin que tengas
echo  que hacer nada.
echo.
echo  Se necesitan permisos de administrador.
echo.
pause

cd /d "%~dp0"

:: Detectar ruta de node
for /f "delims=" %%i in ('where node 2^>nul') do set NODE_PATH=%%i
if "%NODE_PATH%"=="" (
  echo.
  echo  ERROR: Node.js no encontrado. Instala Node.js primero.
  pause
  exit /b 1
)

set TASK_NAME=OnneXa-Shopify-Sync
set DAEMON_SCRIPT=%~dp0scripts\daemon.js
set WORKING_DIR=%~dp0

echo.
echo  Eliminando tarea anterior (si existe)...
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

echo  Creando tarea en el Programador de Tareas...
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /TR "\"%NODE_PATH%\" \"%DAEMON_SCRIPT%\"" ^
  /SC ONLOGON ^
  /DELAY 0001:00 ^
  /RL HIGHEST ^
  /F ^
  /SD 01/01/2026 >nul 2>&1

if %ERRORLEVEL% EQU 0 (
  echo.
  echo  ============================================================
  echo   INSTALADO CORRECTAMENTE
  echo  ============================================================
  echo.
  echo  El sync de Shopify arranca automaticamente al encender
  echo  Windows. No necesitas hacer nada mas.
  echo.
  echo  Para verlo en accion: abre "Programador de Tareas" y
  echo  busca la tarea "OnneXa-Shopify-Sync".
  echo.
  echo  Iniciando el daemon ahora mismo para la primera sync...
  echo.
  start "Onnexa Sync Daemon" /min "%NODE_PATH%" "%DAEMON_SCRIPT%"
  echo  Daemon iniciado en segundo plano.
) else (
  echo.
  echo  AVISO: No se pudo registrar en el Programador de Tareas.
  echo  Quizas necesitas ejecutar este archivo como Administrador:
  echo  Clic derecho → "Ejecutar como administrador"
  echo.
  echo  Por ahora el daemon se iniciar desde INICIAR.bat cada vez.
)

echo.
pause
