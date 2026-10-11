param(
  [Parameter(Mandatory = $true)][uint32]$ProcessId,
  [Parameter(Mandatory = $true)][string]$TitleLike,
  [Parameter(Mandatory = $true)][string]$OutPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Mb09Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static IntPtr Found;
  public static string FoundTitle = "";
  public static readonly List<uint> Pids = new List<uint>();
  public static string TitleLike = "";
  public static bool Enum(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner;
    GetWindowThreadProcessId(hWnd, out owner);
    if (!Pids.Contains(owner)) return true;
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    var title = buffer.ToString();
    if (title.IndexOf(TitleLike, StringComparison.Ordinal) >= 0) {
      Found = hWnd;
      FoundTitle = title;
    }
    return true;
  }
}
"@

$seen = @{}
$queue = New-Object System.Collections.Generic.Queue[uint32]
$queue.Enqueue($ProcessId)
while ($queue.Count -gt 0) {
  $current = $queue.Dequeue()
  if ($seen.ContainsKey($current)) { continue }
  $seen[$current] = $true
  [void][Mb09Win]::Pids.Add($current)
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$current")) {
    $queue.Enqueue([uint32]$child.ProcessId)
  }
}
[Mb09Win]::TitleLike = $TitleLike
$callback = [Mb09Win+EnumProc]{ param($hWnd, $lParam) [Mb09Win]::Enum($hWnd, $lParam) }
[void][Mb09Win]::EnumWindows($callback, [IntPtr]::Zero)
if ([Mb09Win]::Found -eq [IntPtr]::Zero) {
  Write-Output "PRINT_OK=False REASON=NO_WINDOW PIDS=$([Mb09Win]::Pids.Count)"
  exit 1
}
$rect = New-Object Mb09Win+RECT
[void][Mb09Win]::GetWindowRect([Mb09Win]::Found, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  Write-Output "PRINT_OK=False REASON=EMPTY_RECT"
  exit 1
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [Mb09Win]::PrintWindow([Mb09Win]::Found, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$foreground = [Mb09Win]::GetForegroundWindow()
$foregroundTitle = New-Object System.Text.StringBuilder 512
[void][Mb09Win]::GetWindowText($foreground, $foregroundTitle, $foregroundTitle.Capacity)
$same = $foreground -eq [Mb09Win]::Found
Write-Output "PRINT_OK=$printed TITLE=$([Mb09Win]::FoundTitle) HWND=$([Mb09Win]::Found.ToInt64()) W=$width H=$height FG=$($foregroundTitle.ToString()) FG_SAME=$same"
if (-not $printed) { exit 1 }
exit 0
