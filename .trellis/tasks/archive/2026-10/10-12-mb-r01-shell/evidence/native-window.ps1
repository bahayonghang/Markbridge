param(
  [Parameter(Mandatory=$true)][uint32]$TargetProcessId,
  [int]$ClientWidth = 1100,
  [int]$ClientHeight = 760,
  [switch]$Close
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R01Window {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static IntPtr Find(uint target) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == target && IsWindowVisible(window)) { result = window; return false; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
[void][R01Window]::SetThreadDpiAwarenessContext([IntPtr](-4))
$window = [R01Window]::Find($TargetProcessId)
if ($window -eq [IntPtr]::Zero) { throw 'Isolated application window not found' }
if ($Close) {
  $posted = [R01Window]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  [pscustomobject]@{ process = $TargetProcessId; closed = $posted } | ConvertTo-Json -Compress
  exit
}
[void][R01Window]::ShowWindow($window, 9)
$outer = New-Object R01Window+Rect
$client = New-Object R01Window+Rect
[void][R01Window]::GetWindowRect($window, [ref]$outer)
[void][R01Window]::GetClientRect($window, [ref]$client)
$width = $ClientWidth + $outer.Right - $outer.Left - $client.Right
$height = $ClientHeight + $outer.Bottom - $outer.Top - $client.Bottom
if (-not [R01Window]::SetWindowPos($window, [IntPtr]::Zero, 0, 0, $width, $height, 0x0016)) { throw 'Resize failed' }
[void][R01Window]::GetClientRect($window, [ref]$client)
[pscustomobject]@{ process = $TargetProcessId; clientWidth = $client.Right; clientHeight = $client.Bottom } | ConvertTo-Json -Compress
