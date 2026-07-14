$script:PresenceProjectRoot = Split-Path -Parent $PSScriptRoot
$script:PresenceConfigPath = Join-Path $script:PresenceProjectRoot 'config.json'
$script:PresenceEntryPaths = @{
  Music = Join-Path $script:PresenceProjectRoot 'src\index.js'
  Background = Join-Path $script:PresenceProjectRoot 'src\foregroundPresence.js'
}
$script:PresenceClearPaths = @{
  Music = Join-Path $script:PresenceProjectRoot 'src\clearActivity.js'
  Background = Join-Path $script:PresenceProjectRoot 'src\clearForegroundActivity.js'
}

function Get-PresenceEntryPath {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Music', 'Background')]
    [string]$Mode
  )

  return $script:PresenceEntryPaths[$Mode]
}

function Test-PresenceProcessCommandLine {
  param(
    [AllowNull()]
    [string]$CommandLine,

    [Parameter(Mandatory = $true)]
    [string]$EntryPath
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }

  $normalizedCommandLine = $CommandLine.Replace('\', '/').ToLowerInvariant()
  $normalizedEntryPath = [IO.Path]::GetFullPath($EntryPath).Replace('\', '/').ToLowerInvariant()
  return $normalizedCommandLine.Contains($normalizedEntryPath)
}

function Get-PresenceProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Music', 'Background')]
    [string]$Mode
  )

  $entryPath = Get-PresenceEntryPath -Mode $Mode
  return @(
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
      Where-Object {
        Test-PresenceProcessCommandLine -CommandLine $_.CommandLine -EntryPath $entryPath
      }
  )
}

function Stop-PresenceProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Music', 'Background')]
    [string]$Mode
  )

  $running = @(Get-PresenceProcesses -Mode $Mode)
  foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($running.Count -gt 0) {
    $processIds = @($running | ForEach-Object { $_.ProcessId })
    Wait-Process -Id $processIds -Timeout 3 -ErrorAction SilentlyContinue

    $remaining = @(Get-PresenceProcesses -Mode $Mode)
    if ($remaining.Count -gt 0) {
      $remainingIds = ($remaining | ForEach-Object { $_.ProcessId }) -join ', '
      throw "Could not stop $Mode presence process(es): $remainingIds."
    }
  }

  return $running.Count
}

function Set-PresenceConfigFlags {
  [CmdletBinding()]
  param(
    [bool]$MusicEnabled,
    [bool]$BackgroundEnabled
  )

  if (-not (Test-Path -LiteralPath $script:PresenceConfigPath)) {
    throw "config.json was not found in $script:PresenceProjectRoot."
  }

  try {
    $config = Get-Content -LiteralPath $script:PresenceConfigPath -Raw | ConvertFrom-Json
  } catch {
    throw "Could not parse $script:PresenceConfigPath as JSON: $($_.Exception.Message)"
  }

  if ($null -eq $config) {
    throw "$script:PresenceConfigPath does not contain a JSON object."
  }

  if ($PSBoundParameters.ContainsKey('MusicEnabled')) {
    $config | Add-Member -NotePropertyName enabled -NotePropertyValue $MusicEnabled -Force
  }

  if ($PSBoundParameters.ContainsKey('BackgroundEnabled')) {
    $config | Add-Member -NotePropertyName foregroundEnabled -NotePropertyValue $BackgroundEnabled -Force
  }

  $json = $config | ConvertTo-Json -Depth 100
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText(
    $script:PresenceConfigPath,
    $json + [Environment]::NewLine,
    $utf8
  )
}

function Test-DiscordDesktopRunning {
  $discordProcesses = @(
    Get-Process -Name Discord, DiscordCanary, DiscordPTB, DiscordDevelopment -ErrorAction SilentlyContinue
  )
  return $discordProcesses.Count -gt 0
}

function Clear-PresenceActivity {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Music', 'Background')]
    [string]$Mode
  )

  if (-not (Test-DiscordDesktopRunning)) {
    return
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $clearPath = $script:PresenceClearPaths[$Mode]
  & $node $clearPath

  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Discord activity for $Mode presence could not be cleared."
  }
}

function Start-PresenceProcess {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Music', 'Background')]
    [string]$Mode
  )

  $existing = @(Get-PresenceProcesses -Mode $Mode)
  if ($existing.Count -gt 0) {
    return
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $entryPath = Get-PresenceEntryPath -Mode $Mode
  $started = Start-Process `
    -FilePath $node `
    -ArgumentList "`"$entryPath`"" `
    -WorkingDirectory $script:PresenceProjectRoot `
    -WindowStyle Hidden `
    -PassThru

  Start-Sleep -Milliseconds 400
  $started.Refresh()
  if ($started.HasExited) {
    throw "$Mode presence exited immediately. Run node `"$entryPath`" in PowerShell to see the error."
  }
}
