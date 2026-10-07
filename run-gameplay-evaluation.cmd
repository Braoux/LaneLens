@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Impossible de lancer l'evaluation : Node.js est introuvable.
  echo Installez Node.js 22.13.1 a 24.x puis relancez ce fichier.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo Impossible de lancer l'evaluation : les dependances sont absentes.
  echo Ouvrez un terminal dans %CD%, executez npm install, puis relancez ce fichier.
  pause
  exit /b 1
)

call "node_modules\.bin\tsx.cmd" "scripts\evaluation\interactive-runner.ts" %*
set "LANELENS_EXIT_CODE=%ERRORLEVEL%"

if /I not "%~1"=="--smoke" pause
exit /b %LANELENS_EXIT_CODE%
