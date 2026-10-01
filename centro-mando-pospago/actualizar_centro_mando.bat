@echo off
REM Genera el Centro de Mando Pospago y lo publica en GitHub Pages (L-V 6:00 pm via Programador de tareas).
chcp 65001 >nul
cd /d "%~dp0"
if not exist salida mkdir salida
echo ===== %date% %time% ===== >> salida\log.txt
git -C "%~dp0.." pull --rebase --autostash >> salida\log.txt 2>&1
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 build_centro_mando.py --deploy >> salida\log.txt 2>&1
) else (
  python build_centro_mando.py --deploy >> salida\log.txt 2>&1
)
echo codigo de salida: %errorlevel% >> salida\log.txt
