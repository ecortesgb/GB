@echo off
REM Se corre UNA sola vez.
cd /d "%~dp0"
py -3 -m pip install --upgrade -r requirements.txt
pause
