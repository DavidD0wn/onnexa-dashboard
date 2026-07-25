@echo off
echo.
echo  Sincronizando ventas desde Shopify...
echo.
cd /d "%~dp0"
node scripts\sync.mjs --apply --days=3
echo.
echo  Listo. Recarga el dashboard en el navegador.
pause
