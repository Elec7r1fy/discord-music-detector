$ErrorActionPreference = 'Stop'

function Initialize-WinRtAwaiter {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  $script:AsTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } |
    Select-Object -First 1

  if ($null -eq $script:AsTaskGeneric) {
    throw 'Could not locate Windows Runtime AsTask helper.'
  }
}

function Await-WinRt {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type] $ResultType
  )

  $task = $script:AsTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

function Get-SafeProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string] $Name
  )

  try {
    return $Object.$Name
  } catch {
    return $null
  }
}

function Convert-TimeSpanToMilliseconds {
  param($Value)

  if ($null -eq $Value) {
    return 0
  }

  return [int64]$Value.TotalMilliseconds
}

try {
  Initialize-WinRtAwaiter

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

  $manager = Await-WinRt `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

  $sessions = @($manager.GetSessions())
  $result = foreach ($session in $sessions) {
    try {
      $properties = Await-WinRt `
        ($session.TryGetMediaPropertiesAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $timeline = $session.GetTimelineProperties()
      $playback = $session.GetPlaybackInfo()

      [pscustomobject]@{
        sourceAppUserModelId = $session.SourceAppUserModelId
        sourceAppDisplayName = $session.SourceAppUserModelId
        title = Get-SafeProperty $properties 'Title'
        artist = Get-SafeProperty $properties 'Artist'
        albumArtist = Get-SafeProperty $properties 'AlbumArtist'
        albumTitle = Get-SafeProperty $properties 'AlbumTitle'
        subtitle = Get-SafeProperty $properties 'Subtitle'
        playbackType = "$(Get-SafeProperty $properties 'PlaybackType')"
        playbackStatus = "$($playback.PlaybackStatus)"
        startTimeMs = Convert-TimeSpanToMilliseconds $timeline.StartTime
        endTimeMs = Convert-TimeSpanToMilliseconds $timeline.EndTime
        positionMs = Convert-TimeSpanToMilliseconds $timeline.Position
        minSeekTimeMs = Convert-TimeSpanToMilliseconds $timeline.MinSeekTime
        maxSeekTimeMs = Convert-TimeSpanToMilliseconds $timeline.MaxSeekTime
        lastUpdatedUtc = $timeline.LastUpdatedTime.UtcDateTime.ToString('O')
      }
    } catch {
      [Console]::Error.WriteLine("Skipping media session: $($_.Exception.Message)")
    }
  }

  if ($null -eq $result) {
    $result = @()
  }

  $json = ConvertTo-Json -InputObject @($result) -Depth 8 -Compress
  if ([string]::IsNullOrWhiteSpace($json)) {
    Write-Output '[]'
  } else {
    Write-Output $json
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
