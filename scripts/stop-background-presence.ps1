$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'stop-presence-mode.ps1') -Mode Background
