$ErrorActionPreference = 'Stop'

$taskName = 'Local Apple Music Discord Presence'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($null -eq $task) {
  Write-Output "Scheduled task is not installed: $taskName"
  exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output "Removed scheduled task: $taskName"
