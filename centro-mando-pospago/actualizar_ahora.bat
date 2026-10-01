@echo off
REM Boton manual (icono del escritorio): genera y publica el Centro de Mando Pospago y muestra el resultado.
chcp 65001 >nul
cd /d "%~dp0"
title Actualizar Centro de Mando Pospago
echo Actualizando Centro de Mando Pospago... (tarda 1-2 minutos, no cierres esta ventana)
echo.
call actualizar_centro_mando.bat
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$l = Get-Content 'salida\log.txt'; $i = 0; for ($k = $l.Count-1; $k -ge 0; $k--) { if ($l[$k] -like '=====*') { $i = $k; break } };" ^
  "$l[$i..($l.Count-1)] | Select-Object -Last 15; Write-Host '';" ^
  "if ($l[-1] -match 'salida: 0$' -and ($l[$i..($l.Count-1)] -match 'GITHUB PAGES')) { Write-Host 'PUBLICADO OK -> https://ecortesgb.github.io/grupobenber/pospago/ (tarda 1-2 min en verse)' -ForegroundColor Green }" ^
  "else { Write-Host 'NO SE PUBLICO. Revisa el detalle de arriba o centro-mando-pospago\salida\log.txt' -ForegroundColor Red }"
echo.
pause
