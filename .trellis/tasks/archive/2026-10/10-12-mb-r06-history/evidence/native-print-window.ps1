param(
  [Parameter(Mandatory = $true)][uint32]$ProcessId,
  [Parameter(Mandatory = $true)][string]$TitleLike,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [switch]$Activate,
  [switch]$WatchPreview,
  [string]$PreviewTitle
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class MbR06Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
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

# Tauri owns both top-level windows in the launched application process.
[void][MbR06Win]::Pids.Add($ProcessId)
[MbR06Win]::TitleLike = $TitleLike
$callback = [MbR06Win+EnumProc]{ param($hWnd, $lParam) [MbR06Win]::Enum($hWnd, $lParam) }
[void][MbR06Win]::EnumWindows($callback, [IntPtr]::Zero)
if ([MbR06Win]::Found -eq [IntPtr]::Zero) {
  Write-Output "PRINT_OK=False REASON=NO_WINDOW PIDS=$([MbR06Win]::Pids.Count)"
  exit 1
}
if ($Activate) {
  $foregroundOwner = [uint32]0
  $foregroundThread = [MbR06Win]::GetWindowThreadProcessId([MbR06Win]::GetForegroundWindow(), [ref]$foregroundOwner)
  $currentThread = [MbR06Win]::GetCurrentThreadId()
  $attached = $false
  try {
    # A released Alt key permits this explicit test-window activation under the
    # Windows foreground lock. No text or shortcut is sent to another app.
    [MbR06Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [MbR06Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    if ($foregroundThread -ne $currentThread) { $attached = [MbR06Win]::AttachThreadInput($currentThread, $foregroundThread, $true) }
    [void][MbR06Win]::ShowWindow([MbR06Win]::Found, 9)
    [void][MbR06Win]::SetForegroundWindow([MbR06Win]::Found)
  } finally {
    if ($attached) { [void][MbR06Win]::AttachThreadInput($currentThread, $foregroundThread, $false) }
  }
}
$rect = New-Object MbR06Win+RECT
[void][MbR06Win]::GetWindowRect([MbR06Win]::Found, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  Write-Output "PRINT_OK=False REASON=EMPTY_RECT"
  exit 1
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [MbR06Win]::PrintWindow([MbR06Win]::Found, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$foreground = [MbR06Win]::GetForegroundWindow()
$same = $foreground -eq [MbR06Win]::Found
[Console]::WriteLine("PRINT_OK=$printed TITLE=$([MbR06Win]::FoundTitle) HWND=$([MbR06Win]::Found.ToInt64()) W=$width H=$height FG_SAME=$same")
if (-not $printed) { exit 1 }
if ($WatchPreview) {
  [Console]::Out.Flush()
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  while ($watch.ElapsedMilliseconds -lt 15000) {
    $candidate = [MbR06Win]::GetForegroundWindow()
    $candidateOwner = [uint32]0
    [void][MbR06Win]::GetWindowThreadProcessId($candidate, [ref]$candidateOwner)
    if ($candidateOwner -eq $ProcessId) {
      $candidateTitle = New-Object System.Text.StringBuilder 512
      [void][MbR06Win]::GetWindowText($candidate, $candidateTitle, 512)
      if ($candidateTitle.ToString().Contains($PreviewTitle)) {
        Write-Output "PREVIEW_FOCUS=True ELAPSED_MS=$($watch.ElapsedMilliseconds) HWND=$($candidate.ToInt64())"
        exit 0
      }
    }
    Start-Sleep -Milliseconds 25
  }
  Write-Output 'PREVIEW_FOCUS=False'
  exit 1
}
exit 0
