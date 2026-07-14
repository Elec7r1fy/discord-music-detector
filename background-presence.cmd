@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-background-presence.ps1"
if errorlevel 1 (
  echo.
  echo Background app presence could not be started.
  pause
  exit /b 1
)
exit /b 0
