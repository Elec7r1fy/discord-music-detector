$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ForegroundWindowNative
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }
}
'@

$hwnd = [ForegroundWindowNative]::GetForegroundWindow()

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output 'null'
  exit 0
}

$titleLength = [ForegroundWindowNative]::GetWindowTextLength($hwnd)
$builder = New-Object System.Text.StringBuilder ([Math]::Max($titleLength + 1, 256))
[void][ForegroundWindowNative]::GetWindowText($hwnd, $builder, $builder.Capacity)
$title = $builder.ToString()

[uint32]$processId = 0
[void][ForegroundWindowNative]::GetWindowThreadProcessId($hwnd, [ref]$processId)

$process = $null
$executablePath = ''

try {
  $process = Get-Process -Id $processId -ErrorAction Stop
  try {
    $executablePath = $process.MainModule.FileName
  } catch {
    $executablePath = ''
  }
} catch {
  $process = $null
}

$rect = New-Object ForegroundWindowNative+RECT
[void][ForegroundWindowNative]::GetWindowRect($hwnd, [ref]$rect)

$monitor = [ForegroundWindowNative]::MonitorFromWindow($hwnd, 2)
$monitorInfo = New-Object ForegroundWindowNative+MONITORINFO
$monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
$isPrimary = $false

if ($monitor -ne [IntPtr]::Zero -and [ForegroundWindowNative]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
  $isPrimary = (($monitorInfo.dwFlags -band 1) -eq 1)
}

[pscustomobject]@{
  processId = [int]$processId
  processName = if ($process) { $process.ProcessName } else { '' }
  executablePath = $executablePath
  title = $title
  window = [pscustomobject]@{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
  }
  monitor = [pscustomobject]@{
    isPrimary = $isPrimary
    left = $monitorInfo.rcMonitor.Left
    top = $monitorInfo.rcMonitor.Top
    right = $monitorInfo.rcMonitor.Right
    bottom = $monitorInfo.rcMonitor.Bottom
  }
  capturedAtUtc = [DateTime]::UtcNow.ToString('O')
} | ConvertTo-Json -Compress -Depth 6
