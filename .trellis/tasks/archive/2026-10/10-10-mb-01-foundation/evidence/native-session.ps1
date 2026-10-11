param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$AppData,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][ValidateSet('sizes', 'close')][string]$Mode,
  [string]$Namespace = 'Markbridge.Task05.mb01-native',
  [string]$ShotStem = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mb01SessionDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[void][Mb01SessionDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Mb01Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc lpEnumFunc, IntPtr lParam);
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
  public static string FoundTitle = "";
  public static readonly List<uint> Pids = new List<uint>();
  public static readonly List<IntPtr> Children = new List<IntPtr>();
  public static bool EnumTop(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner;
    GetWindowThreadProcessId(hWnd, out owner);
    if (!Pids.Contains(owner)) return true;
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    var title = buffer.ToString();
    if (title.IndexOf("Markbridge", StringComparison.Ordinal) >= 0) {
      Found = hWnd;
      FoundTitle = title;
    }
    return true;
  }
  public static bool EnumChild(IntPtr hWnd, IntPtr lParam) {
    Children.Add(hWnd);
    return true;
  }
}
"@

function Reset-Pids([uint32]$ProcessId) {
  [Mb01Win]::Pids.Clear()
  [Mb01Win]::Found = [IntPtr]::Zero
  [Mb01Win]::FoundTitle = ''
  $seen = @{}
  $queue = New-Object System.Collections.Generic.Queue[uint32]
  $queue.Enqueue($ProcessId)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    [void][Mb01Win]::Pids.Add($current)
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue)) {
      $queue.Enqueue([uint32]$child.ProcessId)
    }
  }
}

function Find-MainWindow([uint32]$ProcessId) {
  Reset-Pids $ProcessId
  $callback = [Mb01Win+EnumProc]{ param($hWnd, $lParam) [Mb01Win]::EnumTop($hWnd, $lParam) }
  [void][Mb01Win]::EnumWindows($callback, [IntPtr]::Zero)
  return [Mb01Win]::Found
}

function Measure-Window([IntPtr]$hwnd) {
  $outer = New-Object Mb01Win+RECT
  $client = New-Object Mb01Win+RECT
  [void][Mb01Win]::GetWindowRect($hwnd, [ref]$outer)
  [void][Mb01Win]::GetClientRect($hwnd, [ref]$client)
  $outerW = $outer.Right - $outer.Left
  $outerH = $outer.Bottom - $outer.Top
  $clientW = $client.Right - $client.Left
  $clientH = $client.Bottom - $client.Top
  [pscustomobject]@{
    Outer = $outer
    OuterW = $outerW
    OuterH = $outerH
    ClientW = $clientW
    ClientH = $clientH
  }
}

function Set-ClientSize([IntPtr]$hwnd, [int]$width, [int]$height) {
  $before = Measure-Window $hwnd
  $borderW = $before.OuterW - $before.ClientW
  $borderH = $before.OuterH - $before.ClientH
  $flags = 0x0004 # SWP_NOZORDER
  [void][Mb01Win]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, ($width + $borderW), ($height + $borderH), $flags)
  $deadline = (Get-Date).AddSeconds(2)
  do {
    Start-Sleep -Milliseconds 100
    $now = Measure-Window $hwnd
  } while (($now.ClientW -ne $width -or $now.ClientH -ne $height) -and (Get-Date) -lt $deadline)
  return (Measure-Window $hwnd)
}

function Save-Window([IntPtr]$hwnd, [string]$path) {
  $measured = Measure-Window $hwnd
  if ($measured.OuterW -le 0 -or $measured.OuterH -le 0) {
    Write-Output "PRINT_OK=False REASON=EMPTY_RECT"
    return $null
  }
  [void][Mb01Win]::ShowWindow($hwnd, 9)
  [void][Mb01Win]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 400
  $bitmap = New-Object System.Drawing.Bitmap $measured.OuterW, $measured.OuterH
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  $printed = [Mb01Win]::PrintWindow($hwnd, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  $check = [System.Drawing.Image]::FromFile($path)
  $pngW = $check.Width
  $pngH = $check.Height
  $check.Dispose()
  Write-Output "PRINT_OK=$printed FILE=$path OUTER=$($measured.OuterW)x$($measured.OuterH) CLIENT=$($measured.ClientW)x$($measured.ClientH) PNG=${pngW}x${pngH} TITLE=$([Mb01Win]::FoundTitle)"
  return $measured
}

function Send-Wheel([IntPtr]$hwnd, [int]$notches) {
  [Mb01Win]::Children.Clear()
  $callback = [Mb01Win+EnumProc]{ param($hWnd, $lParam) [Mb01Win]::EnumChild($hWnd, $lParam) }
  [void][Mb01Win]::EnumChildWindows($hwnd, $callback, [IntPtr]::Zero)
  $targets = @($hwnd) + @([Mb01Win]::Children)
  $measured = Measure-Window $hwnd
  $x = $measured.Outer.Left + [Math]::Max(1, [int]($measured.OuterW / 2))
  $y = $measured.Outer.Top + [Math]::Max(1, [int]($measured.OuterH / 2))
  $delta = -120 * $notches
  $wParam = [IntPtr]((($delta -band 0xFFFF) -shl 16))
  $lParam = [IntPtr]((($y -band 0xFFFF) -shl 16) -bor ($x -band 0xFFFF))
  foreach ($target in $targets) {
    [void][Mb01Win]::PostMessage($target, 0x020A, $wParam, $lParam)
  }
}

New-Item -ItemType Directory -Force -Path $AppData, $OutDir | Out-Null
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $Exe
$psi.WorkingDirectory = $AppData
$psi.UseShellExecute = $false
$psi.Environment['MARKBRIDGE_APP_DATA'] = $AppData
$psi.Environment['MARKBRIDGE_CREDENTIAL_NAMESPACE'] = $Namespace
$psi.Environment['WEBVIEW2_USER_DATA_FOLDER'] = (Join-Path $AppData 'webview2')
$process = [System.Diagnostics.Process]::Start($psi)
Write-Output "PID=$($process.Id) MODE=$Mode APPDATA=$AppData"
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 200
  $hwnd = Find-MainWindow ([uint32]$process.Id)
} while ($hwnd -eq [IntPtr]::Zero -and -not $process.HasExited -and (Get-Date) -lt $deadline)
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output "WINDOW=MISSING EXITED=$($process.HasExited)"
  if (-not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(5000)) { Write-Output "CLOSE_WAIT_FAILED" }
  }
  if ($process.HasExited) { Write-Output "EXIT=$($process.ExitCode)" }
  exit 2
}
Write-Output "HWND=$($hwnd.ToInt64()) TITLE=$([Mb01Win]::FoundTitle)"
Start-Sleep -Seconds 4
if ($Mode -eq 'sizes') {
  $large = Set-ClientSize $hwnd 1100 760
  Write-Output "SET_1100x760 CLIENT=$($large.ClientW)x$($large.ClientH) OUTER=$($large.OuterW)x$($large.OuterH)"
  $stem = if ($ShotStem) { $ShotStem } else { 'native-empty' }
  [void](Save-Window $hwnd (Join-Path $OutDir "$stem-1100x760.png"))
  Send-Wheel $hwnd 8
  Start-Sleep -Milliseconds 700
  [void](Save-Window $hwnd (Join-Path $OutDir "$stem-1100x760-scroll.png"))
  $small = Set-ClientSize $hwnd 640 480
  Write-Output "SET_640x480 CLIENT=$($small.ClientW)x$($small.ClientH) OUTER=$($small.OuterW)x$($small.OuterH)"
  [void](Save-Window $hwnd (Join-Path $OutDir "$stem-640x480.png"))
  Send-Wheel $hwnd 8
  Start-Sleep -Milliseconds 700
  [void](Save-Window $hwnd (Join-Path $OutDir "$stem-640x480-scroll.png"))
} else {
  $large = Set-ClientSize $hwnd 1100 760
  Write-Output "SET_1100x760 CLIENT=$($large.ClientW)x$($large.ClientH) OUTER=$($large.OuterW)x$($large.OuterH)"
  $stem = if ($ShotStem) { $ShotStem } else { 'native-close-2' }
  [void](Save-Window $hwnd (Join-Path $OutDir "$stem.png"))
}
$closeTarget = Find-MainWindow ([uint32]$process.Id)
if ($closeTarget -eq [IntPtr]::Zero) { $closeTarget = $hwnd }
$posted = [Mb01Win]::PostMessage($closeTarget, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "WM_CLOSE_POSTED=$posted HWND=$($closeTarget.ToInt64())"
if (-not $process.WaitForExit(20000)) {
  Write-Output "EXIT=TIMEOUT"
  exit 3
}
Write-Output "EXIT=$($process.ExitCode)"
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
exit 0
