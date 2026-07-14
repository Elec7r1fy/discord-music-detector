$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $projectRoot 'src\listenAlong.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$tokenPointer = [IntPtr]::Zero
$addedTemporaryToken = $false
$exitCode = 1

try {
  if ([string]::IsNullOrWhiteSpace($env:DISCORD_BOT_TOKEN)) {
    $secureToken = Read-Host 'Discord bot token' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:DISCORD_BOT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $addedTemporaryToken = $true
  }

  & $node $entryPath
  $exitCode = $LASTEXITCODE
} finally {
  if ($addedTemporaryToken) {
    Remove-Item Env:\DISCORD_BOT_TOKEN -ErrorAction SilentlyContinue
  }
  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }
}

exit $exitCode
