@echo off
chcp 65001 >nul
title Onnexa Dashboard
color 0A
cls

set "PORT=3000"
set "URL=http://localhost:%PORT%"

echo.
echo  ============================================
echo   ONNEXA COMMAND CENTER - Iniciando...
echo  ============================================
echo.
echo  Dashboard: %URL%
echo  Onnexa Creatives puede seguir abierta en http://localhost:3030
echo.
echo  Los datos quedan FIJOS en la base de datos.
echo  Para actualizar el mes en curso usa el boton
echo  "Actualizar Shopify" dentro del dashboard.
echo.

cd /d "%~dp0"

:: Nunca cerrar todos los procesos node.exe: eso apagaba Onnexa Creatives
:: y cualquier otra app local. Si el puerto 3000 ya esta ocupado, asumimos
:: que el dashboard ya esta abierto y solo abrimos el navegador.
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo  [AVISO] El puerto %PORT% ya esta en uso. Quiza el dashboard ya esta abierto.
  echo          Onnexa Creatives en 3030 no sera cerrada.
  start "" "%URL%"
  echo.
  pause
  exit /b 0
)

:: Crear carpeta de logs si no existe
if not exist "logs" mkdir logs

:: NOTA: el sync-daemon automatico fue DESACTIVADO a proposito porque
:: corrompia los datos (ponia unidades = ordenes y bajaba las ventas).
:: Ya NO se lanza ningun sync en segundo plano. El unico proceso es el dashboard.

:: Abrir el navegador unos segundos despues, cuando el servidor ya levanto
start "" cmd /c "timeout /t 5 >nul & start """" ""%URL%"""

:: Iniciar el dashboard. El puerto tambien queda fijado en package.json.
npm run dev
