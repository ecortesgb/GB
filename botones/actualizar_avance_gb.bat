@echo off
REM Boton manual: genera y publica Avance GB con lo que ya hay en disco (sin descargar; para eso estan los otros botones).
chcp 65001 >nul
title Actualizar Avance GB
cd /d "C:\Users\ecort\OneDrive - Grupo Benber\AUTOMATIZACION\Herramientas\MotorPython"
echo Actualizando Avance GB... (tarda unos minutos, no cierres esta ventana)
echo.
py -3 actualizar_dashboard.py hora --sin-descarga
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$l = Get-Content (Join-Path $env:TEMP 'log_actualizar_dashboard.txt') -Encoding UTF8; $i = 0; for ($k = $l.Count-1; $k -ge 0; $k--) { if ($l[$k] -like '*=== INICIO*') { $i = $k; break } };" ^
  "Write-Host ''; if ($l[$i..($l.Count-1)] -match 'Publicado: ') { Write-Host 'PUBLICADO OK -> https://ecortesgb.github.io/grupobenber/ (tarda 1-2 min en verse)' -ForegroundColor Green }" ^
  "else { Write-Host 'NO SE PUBLICO. Revisa los AVISO de arriba.' -ForegroundColor Red }"
echo.
pause
