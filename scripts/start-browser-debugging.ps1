param(
  [ValidateSet('Chrome', 'Brave')]
  [string] $Browser = 'Chrome',
  [int] $Port = 9222,
  [string] $UserDataDir = '',
  [switch] $ForceRestart
)

$ErrorActionPreference = 'Stop'

function Get-BrowserInfo {
  param([string] $Name)

  if ($Name -eq 'Brave') {
    return [pscustomobject]@{
      ProcessName = 'brave'
      CandidatePaths = @(
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe"
      )
    }
  }

  [pscustomobject]@{
    ProcessName = 'chrome'
    CandidatePaths = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
  }
}

$info = Get-BrowserInfo $Browser
$browserPath = $info.CandidatePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $browserPath) {
  throw "$Browser was not found in the usual install locations."
}

$running = Get-Process -Name $info.ProcessName -ErrorAction SilentlyContinue

if ($running -and -not $ForceRestart) {
  Write-Output "$Browser is already running. Close it first, or rerun this script with -ForceRestart."
  Write-Output "Example: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-browser-debugging.ps1 -Browser $Browser -ForceRestart"
  exit 1
}

if ($running -and $ForceRestart) {
  $running | Stop-Process -Force
  Start-Sleep -Seconds 1
}

if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $profileName = "browser-debug-$($Browser.ToLowerInvariant())"
  $UserDataDir = Join-Path $projectRoot "cache\$profileName"
}

$UserDataDir = [System.IO.Path]::GetFullPath($UserDataDir)
New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null

Start-Process -FilePath $browserPath -ArgumentList @(
  "--remote-debugging-port=$Port",
  '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=`"$UserDataDir`"",
  'https://music.youtube.com/'
)

Write-Output "$Browser started with local debugging on http://127.0.0.1:$Port"
Write-Output "It is using the dedicated profile at $UserDataDir. Sign in to YouTube Music once in this profile."
