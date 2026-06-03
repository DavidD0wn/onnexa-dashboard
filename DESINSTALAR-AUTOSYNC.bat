@echo off
title Onnexa — Desinstalar Auto-sync
color 0C
cls
echo.
echo  Eliminando tareas de sincronizacion automatica...
echo.
schtasks /delete /tn "Onnexa-Sync-Hourly" /f >nul 2>&1 && echo  [OK] Sync por hora eliminado || echo  [--] Sync por hora no existia
schtasks /delete /tn "Onnexa-Sync-Daily"  /f >nul 2>&1 && echo  [OK] Sync diario eliminado    || echo  [--] Sync diario no existia
echo.
echo  Listo. Ya no hay sincronizacion automatica.
echo.
pause
