@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all-presence.ps1"
if errorlevel 1 (
  echo.
  echo Presence could not be stopped cleanly.
  pause
  exit /b 1
)
exit /b 0
