@echo off
REM Boton manual: descarga Asistencia + Registros de FieldWY (mismo script que usa Avance GB).
chcp 65001 >nul
title Descargar Asistencia y Registros (FieldWY)
cd /d "C:\Users\ecort\OneDrive - Grupo Benber\AUTOMATIZACION\Herramientas\fieldwy"
echo Descargando Asistencia y Registros de FieldWY... (no cierres esta ventana)
echo.
node descarga.js
if %errorlevel%==0 (powershell -NoProfile -Command "Write-Host 'DESCARGA OK' -ForegroundColor Green") else (powershell -NoProfile -Command "Write-Host 'LA DESCARGA FALLO. Revisa el detalle de arriba.' -ForegroundColor Red")
echo.
pause
