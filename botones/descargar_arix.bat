@echo off
REM Boton manual: descarga recargas de CodigoArix (mismo script que la tarea GB_Descarga_Arix_Manana).
chcp 65001 >nul
title Descargar ARIX (recargas)
cd /d "C:\Users\ecort\OneDrive - Grupo Benber\AUTOMATIZACION\Herramientas\arix"
echo Descargando recargas de ARIX... (no cierres esta ventana)
echo.
node descarga_arix.js
if %errorlevel%==0 (powershell -NoProfile -Command "Write-Host 'DESCARGA OK' -ForegroundColor Green") else (powershell -NoProfile -Command "Write-Host 'LA DESCARGA FALLO. Revisa el detalle de arriba.' -ForegroundColor Red")
echo.
pause
