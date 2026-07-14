$ErrorActionPreference = 'Stop'

$taskName = 'Local Apple Music Discord Presence'
$projectRoot = Split-Path -Parent $PSScriptRoot
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$entry = Join-Path $projectRoot 'scripts\start-saved-presence.ps1'

if (-not (Test-Path (Join-Path $projectRoot 'config.json'))) {
  throw "config.json was not found in $projectRoot. Copy config.example.json first and set your Discord client ID."
}

$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$entry`"" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Runs the selected music or background app Discord presence at sign-in.' `
  -Force | Out-Null

Write-Output "Installed scheduled task: $taskName"
