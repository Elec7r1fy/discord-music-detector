[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Music', 'Background', 'Off')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'presence-tools.ps1')

switch ($Mode) {
  'Music' {
    Set-PresenceConfigFlags -MusicEnabled $true -BackgroundEnabled $false
  }
  'Background' {
    Set-PresenceConfigFlags -MusicEnabled $false -BackgroundEnabled $true
  }
  'Off' {
    Set-PresenceConfigFlags -MusicEnabled $false -BackgroundEnabled $false
  }
}

$musicProcesses = @(Get-PresenceProcesses -Mode Music)
$backgroundProcesses = @(Get-PresenceProcesses -Mode Background)

if ($Mode -eq 'Music' -and $musicProcesses.Count -eq 1 -and $backgroundProcesses.Count -eq 0) {
  Write-Output 'Music presence is already selected. Background app presence is off.'
  return
}
if ($Mode -eq 'Background' -and $backgroundProcesses.Count -eq 1 -and $musicProcesses.Count -eq 0) {
  Write-Output 'Background app presence is already selected. Music presence is off.'
  return
}

$musicWasRunning = $musicProcesses.Count -gt 0
$backgroundWasRunning = $backgroundProcesses.Count -gt 0

$null = Stop-PresenceProcesses -Mode Music
$null = Stop-PresenceProcesses -Mode Background

if ($musicWasRunning -or $Mode -eq 'Off') {
  Clear-PresenceActivity -Mode Music
}
if ($backgroundWasRunning -or $Mode -eq 'Off') {
  Clear-PresenceActivity -Mode Background
}

switch ($Mode) {
  'Music' {
    Start-PresenceProcess -Mode Music
    Write-Output 'Music presence selected. Background app presence is off.'
  }
  'Background' {
    Start-PresenceProcess -Mode Background
    Write-Output 'Background app presence selected. Music presence is off.'
  }
  'Off' {
    Write-Output 'Music and background app presence are both off.'
  }
}
