@echo off
echo.
echo  Sincronizando ventas desde Shopify...
echo.
cd /d "%~dp0"
node scripts/sync-shopify.js --days=3
echo.
echo  Listo. Recarga el dashboard en el navegador.
pause
