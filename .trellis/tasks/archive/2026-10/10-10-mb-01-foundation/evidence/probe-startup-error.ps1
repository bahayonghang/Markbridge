param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$AppData,
  [Parameter(Mandatory = $true)][string]$OutPng,
  [ValidateSet('newer-schema', 'not-database', 'exclusive-lock')][string]$Mode
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mb01Dpi2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[void][Mb01Dpi2]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Mb01Err {
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
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
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

New-Item -ItemType Directory -Force -Path $AppData | Out-Null
$database = Join-Path $AppData 'markbridge.sqlite'
$lock = $null
if ($Mode -eq 'newer-schema') {
  python -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version=999'); c.commit()" $database
} elseif ($Mode -eq 'not-database') {
  [System.IO.File]::WriteAllText($database, 'not-a-database')
} elseif ($Mode -eq 'exclusive-lock') {
  [System.IO.File]::WriteAllBytes($database, [byte[]]@())
  $lock = [System.IO.File]::Open($database, 'Open', 'ReadWrite', 'None')
}
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $Exe
$psi.WorkingDirectory = $AppData
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.Environment['MARKBRIDGE_APP_DATA'] = $AppData
$psi.Environment['MARKBRIDGE_CREDENTIAL_NAMESPACE'] = 'Markbridge.Task05.mb01-native'
$psi.Environment['WEBVIEW2_USER_DATA_FOLDER'] = (Join-Path $AppData 'webview2')
$process = [System.Diagnostics.Process]::Start($psi)
Write-Output "PID=$($process.Id) MODE=$Mode"
function Find-ErrWindow([uint32]$ProcessId) {
  [Mb01Err]::Pids.Clear(); [Mb01Err]::Found = [IntPtr]::Zero
  $seen = @{}
  $queue = New-Object System.Collections.Generic.Queue[uint32]
  $queue.Enqueue($ProcessId)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    [void][Mb01Err]::Pids.Add($current)
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue)) {
      $queue.Enqueue([uint32]$child.ProcessId)
    }
  }
  $callback = [Mb01Err+EnumProc]{ param($hWnd, $lParam) [Mb01Err]::EnumTop($hWnd, $lParam) }
  [void][Mb01Err]::EnumWindows($callback, [IntPtr]::Zero)
  return [Mb01Err]::Found
}
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 200
  $hwnd = Find-ErrWindow ([uint32]$process.Id)
} while ($hwnd -eq [IntPtr]::Zero -and -not $process.HasExited -and (Get-Date) -lt $deadline)
Write-Output "WINDOW_FOUND=$($hwnd -ne [IntPtr]::Zero) EXITED_EARLY=$($process.HasExited)"
if ($hwnd -ne [IntPtr]::Zero) {
  [void][Mb01Err]::ShowWindow($hwnd, 9)
  [void][Mb01Err]::SetForegroundWindow($hwnd)
  $outer = New-Object Mb01Err+RECT
  $client = New-Object Mb01Err+RECT
  [void][Mb01Err]::GetWindowRect($hwnd, [ref]$outer)
  [void][Mb01Err]::GetClientRect($hwnd, [ref]$client)
  $borderW = ($outer.Right - $outer.Left) - ($client.Right - $client.Left)
  $borderH = ($outer.Bottom - $outer.Top) - ($client.Bottom - $client.Top)
  [void][Mb01Err]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, (1100 + $borderW), (760 + $borderH), 0x0004)
  Start-Sleep -Milliseconds 800
  $shotDeadline = (Get-Date).AddSeconds(10)
  $index = 0
  while ((Get-Date) -lt $shotDeadline -and -not $process.HasExited) {
    [void][Mb01Err]::GetWindowRect($hwnd, [ref]$outer)
    [void][Mb01Err]::GetClientRect($hwnd, [ref]$client)
    $width = $outer.Right - $outer.Left
    $height = $outer.Bottom - $outer.Top
    $clientW = $client.Right - $client.Left
    $clientH = $client.Bottom - $client.Top
    if ($width -gt 0 -and $height -gt 0) {
      $bitmap = New-Object System.Drawing.Bitmap $width, $height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $hdc = $graphics.GetHdc()
      $printed = [Mb01Err]::PrintWindow($hwnd, $hdc, 2)
      $graphics.ReleaseHdc($hdc)
      $frame = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($OutPng), ("{0}-{1}.png" -f [System.IO.Path]::GetFileNameWithoutExtension($OutPng), $index))
      $bitmap.Save($frame, [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose(); $bitmap.Dispose()
      Write-Output "PRINT_OK=$printed FILE=$frame PNG=${width}x${height} CLIENT=${clientW}x${clientH}"
      $index++
    }
    Start-Sleep -Milliseconds 800
  }
  $posted = [Mb01Err]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output "WM_CLOSE_POSTED=$posted"
}
if ($lock) { $lock.Dispose() }
if (-not $process.WaitForExit(20000)) { Write-Output 'EXIT=TIMEOUT'; exit 3 }
$stderr = $process.StandardError.ReadToEnd()
if ($stderr) { Write-Output "STDERR=$stderr" }
Write-Output "EXIT=$($process.ExitCode)"
exit $process.ExitCode
