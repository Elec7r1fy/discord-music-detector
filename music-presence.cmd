@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-music-presence.ps1"
if errorlevel 1 (
  echo.
  echo Music presence could not be started.
  pause
  exit /b 1
)
exit /b 0
