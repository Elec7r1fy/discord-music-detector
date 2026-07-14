$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'presence-tools.ps1')

if (-not (Test-Path -LiteralPath $script:PresenceConfigPath)) {
  throw "config.json was not found in $script:PresenceProjectRoot."
}

try {
  $config = Get-Content -LiteralPath $script:PresenceConfigPath -Raw | ConvertFrom-Json
} catch {
  throw "Could not parse $script:PresenceConfigPath as JSON: $($_.Exception.Message)"
}

# Music remains the default when an older config has no explicit enabled key.
$musicEnabled = $null -eq $config.PSObject.Properties['enabled'] -or $config.enabled -ne $false
$backgroundEnabled = $config.foregroundEnabled -eq $true

if ($musicEnabled) {
  $mode = 'Music'
} elseif ($backgroundEnabled) {
  $mode = 'Background'
} else {
  $mode = 'Off'
}

if ($mode -eq 'Off') {
  $musicWasRunning = @(Get-PresenceProcesses -Mode Music).Count -gt 0
  $backgroundWasRunning = @(Get-PresenceProcesses -Mode Background).Count -gt 0
  $null = Stop-PresenceProcesses -Mode Music
  $null = Stop-PresenceProcesses -Mode Background
  if ($musicWasRunning) {
    Clear-PresenceActivity -Mode Music
  }
  if ($backgroundWasRunning) {
    Clear-PresenceActivity -Mode Background
  }
  Write-Output 'Saved presence choice is Off.'
  exit 0
}

$otherMode = if ($mode -eq 'Music') { 'Background' } else { 'Music' }
$otherWasRunning = @(Get-PresenceProcesses -Mode $otherMode).Count -gt 0
$null = Stop-PresenceProcesses -Mode $otherMode
if ($otherWasRunning) {
  Clear-PresenceActivity -Mode $otherMode
}

if (@(Get-PresenceProcesses -Mode $mode).Count -gt 0) {
  Write-Output "$mode presence is already running."
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$entryPath = Get-PresenceEntryPath -Mode $mode
Write-Output "Starting saved presence choice: $mode."
& $node $entryPath
exit $LASTEXITCODE
