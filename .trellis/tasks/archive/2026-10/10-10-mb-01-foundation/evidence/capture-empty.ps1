param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$AppData,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Port = 9333,
  [string]$ShotStem = 'native-empty'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mb01Dpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[void][Mb01Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Mb01Cap {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static IntPtr Found;
  public static readonly List<uint> Pids = new List<uint>();
  public static bool EnumTop(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner;
    GetWindowThreadProcessId(hWnd, out owner);
    if (!Pids.Contains(owner)) return true;
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    if (buffer.ToString().IndexOf("Markbridge", StringComparison.Ordinal) >= 0) Found = hWnd;
    return true;
  }
}
"@

function Find-Main([uint32]$ProcessId) {
  [Mb01Cap]::Pids.Clear()
  [Mb01Cap]::Found = [IntPtr]::Zero
  $seen = @{}
  $queue = New-Object System.Collections.Generic.Queue[uint32]
  $queue.Enqueue($ProcessId)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    [void][Mb01Cap]::Pids.Add($current)
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue)) {
      $queue.Enqueue([uint32]$child.ProcessId)
    }
  }
  $callback = [Mb01Cap+EnumProc]{ param($hWnd, $lParam) [Mb01Cap]::EnumTop($hWnd, $lParam) }
  [void][Mb01Cap]::EnumWindows($callback, [IntPtr]::Zero)
  return [Mb01Cap]::Found
}
function Get-MbRect([IntPtr]$hwnd) {
  $outer = New-Object Mb01Cap+RECT
  $client = New-Object Mb01Cap+RECT
  [void][Mb01Cap]::GetWindowRect($hwnd, [ref]$outer)
  [void][Mb01Cap]::GetClientRect($hwnd, [ref]$client)
  [pscustomobject]@{
    OuterW = $outer.Right - $outer.Left
    OuterH = $outer.Bottom - $outer.Top
    ClientW = $client.Right - $client.Left
    ClientH = $client.Bottom - $client.Top
    BorderW = ($outer.Right - $outer.Left) - ($client.Right - $client.Left)
    BorderH = ($outer.Bottom - $outer.Top) - ($client.Bottom - $client.Top)
  }
}
function Set-Client([IntPtr]$hwnd, [int]$width, [int]$height) {
  $before = Get-MbRect $hwnd
  [void][Mb01Cap]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, ($width + $before.BorderW), ($height + $before.BorderH), 0x0004)
  $deadline = (Get-Date).AddSeconds(2)
  do { Start-Sleep -Milliseconds 100; $now = Get-MbRect $hwnd } while (($now.ClientW -ne $width -or $now.ClientH -ne $height) -and (Get-Date) -lt $deadline)
  return (Get-MbRect $hwnd)
}
function Save-Shot([IntPtr]$hwnd, [string]$path) {
  [void][Mb01Cap]::ShowWindow($hwnd, 9)
  [void][Mb01Cap]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 600
  $measured = Get-MbRect $hwnd
  $outer = New-Object Mb01Cap+RECT
  [void][Mb01Cap]::GetWindowRect($hwnd, [ref]$outer)
  $bitmap = New-Object System.Drawing.Bitmap $measured.OuterW, $measured.OuterH
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  $printed = [Mb01Cap]::PrintWindow($hwnd, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  Write-Output "PRINT_OK=$printed FILE=$path OUTER=$($measured.OuterW)x$($measured.OuterH) CLIENT=$($measured.ClientW)x$($measured.ClientH) PNG=$($measured.OuterW)x$($measured.OuterH) ORIGIN=$($outer.Left),$($outer.Top)"
}

New-Item -ItemType Directory -Force -Path $AppData, $OutDir | Out-Null
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $Exe
$psi.WorkingDirectory = $AppData
$psi.UseShellExecute = $false
$psi.Environment['MARKBRIDGE_APP_DATA'] = $AppData
$psi.Environment['MARKBRIDGE_CREDENTIAL_NAMESPACE'] = 'Markbridge.Task05.mb01-native'
$psi.Environment['WEBVIEW2_USER_DATA_FOLDER'] = (Join-Path $AppData 'webview2')
$psi.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$Port"
$process = [System.Diagnostics.Process]::Start($psi)
Write-Output "PID=$($process.Id)"
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 200
  $hwnd = Find-Main ([uint32]$process.Id)
} while ($hwnd -eq [IntPtr]::Zero -and -not $process.HasExited -and (Get-Date) -lt $deadline)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'WINDOW=MISSING'; exit 2 }
$observer = Join-Path $PSScriptRoot 'observe-dom.mjs'
$cdpDeadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 300
  try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null; $cdp = $true } catch { $cdp = $false }
} while (-not $cdp -and -not $process.HasExited -and (Get-Date) -lt $cdpDeadline)
if (-not $cdp) { Write-Output 'CDP=MISSING'; exit 2 }
Start-Sleep -Seconds 2
$large = Set-Client $hwnd 1100 760
Write-Output "SET_1100x760 CLIENT=$($large.ClientW)x$($large.ClientH) OUTER=$($large.OuterW)x$($large.OuterH)"
Write-Output 'DOM_TOP'
node $observer $Port top
Write-Output 'DOM_PROBE'
node $observer $Port probe
node $observer $Port shot (Join-Path $OutDir "$ShotStem-1100x760-cdp.png")
Start-Sleep -Milliseconds 400
Save-Shot $hwnd (Join-Path $OutDir "$ShotStem-1100x760.png")
Write-Output 'DOM_SCROLL'
node $observer $Port scroll
Start-Sleep -Milliseconds 400
Save-Shot $hwnd (Join-Path $OutDir "$ShotStem-1100x760-source.png")
$small = Set-Client $hwnd 640 480
Write-Output "SET_640x480 CLIENT=$($small.ClientW)x$($small.ClientH) OUTER=$($small.OuterW)x$($small.OuterH)"
Write-Output 'DOM_TOP_SMALL'
node $observer $Port top
Start-Sleep -Milliseconds 400
Save-Shot $hwnd (Join-Path $OutDir "$ShotStem-640x480.png")
Write-Output 'DOM_SCROLL_SMALL'
node $observer $Port scroll
Start-Sleep -Milliseconds 400
Save-Shot $hwnd (Join-Path $OutDir "$ShotStem-640x480-source.png")
$posted = [Mb01Cap]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "WM_CLOSE_POSTED=$posted"
if (-not $process.WaitForExit(20000)) { Write-Output 'EXIT=TIMEOUT'; exit 3 }
Write-Output "EXIT=$($process.ExitCode)"
exit $process.ExitCode
