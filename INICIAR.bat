@echo off
title Onnexa Dashboard
color 0A
cls
echo.
echo  ============================================
echo   ONNEXA COMMAND CENTER - Iniciando...
echo  ============================================
echo.
echo  Dashboard: http://localhost:3000
echo.
echo  Los datos quedan FIJOS en la base de datos.
echo  Para actualizar el mes en curso usa el boton
echo  "Actualizar Shopify" dentro del dashboard.
echo.

cd /d "%~dp0"

:: Matar procesos node viejos (daemons / syncs colgados) para arrancar
:: SIEMPRE limpio. Nada sincroniza en segundo plano.
taskkill /F /IM node.exe >nul 2>&1

:: Crear carpeta de logs si no existe
if not exist "logs" mkdir logs

:: NOTA: el sync-daemon automatico fue DESACTIVADO a proposito porque
:: corrompia los datos (ponia unidades = ordenes y bajaba las ventas).
:: Ya NO se lanza ningun sync en segundo plano. El unico proceso es el dashboard.

:: Abrir el navegador
start "" http://localhost:3000

:: Iniciar servidor Next.js (unico proceso)
npm run dev
