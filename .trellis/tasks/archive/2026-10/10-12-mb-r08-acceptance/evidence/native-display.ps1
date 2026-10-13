param([Parameter(Mandatory=$true)][uint32]$TargetProcessId, [int]$MonitorIndex = -1)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R08Display {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static IntPtr Find(uint target) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, data) => { uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == target && IsWindowVisible(window)) { result = window; return false; } return true;
    }, IntPtr.Zero); return result;
  }
}
'@
[void][R08Display]::SetThreadDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$window = [R08Display]::Find($TargetProcessId)
if ($window -eq [IntPtr]::Zero) { throw 'Isolated application window not found' }
$screens = @([System.Windows.Forms.Screen]::AllScreens)
if ($MonitorIndex -ge 0) {
  if ($MonitorIndex -ge $screens.Count) { throw 'Unknown monitor' }
  $bounds = $screens[$MonitorIndex].WorkingArea
  if (-not [R08Display]::SetWindowPos($window, [IntPtr]::Zero, $bounds.Left + 16, $bounds.Top + 16, 850, 650, 0x0014)) { throw 'Move failed' }
}
$screen = [System.Windows.Forms.Screen]::FromHandle($window)
$rect = New-Object R08Display+Rect
[void][R08Display]::GetWindowRect($window, [ref]$rect)
[pscustomobject]@{
  process = $TargetProcessId; dpi = [R08Display]::GetDpiForWindow($window); device = $screen.DeviceName
  window = @{left=$rect.Left;top=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top}
  monitors = @($screens | ForEach-Object { @{device=$_.DeviceName;primary=$_.Primary;left=$_.WorkingArea.Left;top=$_.WorkingArea.Top;width=$_.WorkingArea.Width;height=$_.WorkingArea.Height} })
} | ConvertTo-Json -Depth 4 -Compress
