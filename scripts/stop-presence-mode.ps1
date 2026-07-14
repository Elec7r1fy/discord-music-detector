[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Music', 'Background')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'presence-tools.ps1')

$otherMode = if ($Mode -eq 'Music') { 'Background' } else { 'Music' }
$otherWasRunning = @(Get-PresenceProcesses -Mode $otherMode).Count -gt 0

if ($Mode -eq 'Music') {
  Set-PresenceConfigFlags -MusicEnabled $false
} else {
  Set-PresenceConfigFlags -BackgroundEnabled $false
}

$null = Stop-PresenceProcesses -Mode $Mode
Clear-PresenceActivity -Mode $Mode

# Clearing one activity can also clear the other when both modes share a
# Discord application ID. Restart an active alternate mode so it republishes.
if ($otherWasRunning) {
  $null = Stop-PresenceProcesses -Mode $otherMode
  Start-PresenceProcess -Mode $otherMode
}

Write-Output "$Mode presence stopped and cleared."
