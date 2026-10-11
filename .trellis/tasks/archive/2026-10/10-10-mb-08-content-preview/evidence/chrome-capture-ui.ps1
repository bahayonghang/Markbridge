# Disposable UI helper for the AC08-4 Chrome observation. No page content is printed.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$csharp = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class Mb08Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int cb);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx, dy;
    public uint mouseData, dwFlags, time;
    public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk, wScan;
    public uint dwFlags, time;
    public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion u;
  }

  public static int InputSize() {
    SetProcessDPIAware();
    return Marshal.SizeOf(typeof(INPUT));
  }

  static EnumProc keepAlive;
  public static string Windows(int[] pids) {
    var want = new HashSet<int>(pids);
    var rows = new List<string>();
    keepAlive = (hWnd, lParam) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!want.Contains((int)pid) || !IsWindowVisible(hWnd)) return true;
      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return true;
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width < 40 || height < 40) return true;
      rows.Add(pid.ToString() + "," + hWnd.ToInt64().ToString() + "," + rect.Left.ToString() + "," + rect.Top.ToString() + "," + width.ToString() + "," + height.ToString());
      return true;
    };
    EnumWindows(keepAlive, IntPtr.Zero);
    return string.Join(";", rows);
  }

  public static void Focus(long hwndValue) {
    IntPtr hwnd = new IntPtr(hwndValue);
    ShowWindow(hwnd, 9);
    IntPtr foreground = GetForegroundWindow();
    uint foregroundThread;
    GetWindowThreadProcessId(foreground, out foregroundThread);
    uint current = GetCurrentThreadId();
    AttachThreadInput(current, foregroundThread, true);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    AttachThreadInput(current, foregroundThread, false);
  }

  public static void Topmost(long hwndValue) {
    SetWindowPos(new IntPtr(hwndValue), new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
  }

  public static string Click(int x, int y, int[] pids) {
    var want = new HashSet<int>(pids);
    POINT saved;
    GetCursorPos(out saved);
    POINT point = new POINT { X = x, Y = y };
    IntPtr hwnd = WindowFromPoint(point);
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (!want.Contains((int)pid)) {
      SetCursorPos(saved.X, saved.Y);
      return "blocked";
    }
    Topmost(hwnd.ToInt64());
    Thread.Sleep(40);
    int vx = GetSystemMetrics(76);
    int vy = GetSystemMetrics(77);
    int vw = GetSystemMetrics(78);
    int vh = GetSystemMetrics(79);
    int nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(vw - 1, 1));
    int ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(vh - 1, 1));
    uint sent = Send(nx, ny, 0x0001 | 0x8000 | 0x4000);
    sent += Send(nx, ny, 0x0002 | 0x8000 | 0x4000);
    Thread.Sleep(40);
    sent += Send(nx, ny, 0x0004 | 0x8000 | 0x4000);
    SetCursorPos(saved.X, saved.Y);
    return sent == 3 ? "clicked" : "send-failed";
  }

  public static string Keys(long hwndValue, ushort vk) {
    Focus(hwndValue);
    Thread.Sleep(120);
    Key(0x12, true);
    Key(0x10, true);
    Key(vk, true);
    Thread.Sleep(30);
    Key(vk, false);
    Key(0x10, false);
    Key(0x12, false);
    return "sent";
  }

  static uint Send(int x, int y, uint flags) {
    INPUT input = new INPUT { type = 0 };
    input.u.mi.dx = x;
    input.u.mi.dy = y;
    input.u.mi.dwFlags = flags;
    INPUT[] inputs = new INPUT[] { input };
    return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  static void Key(ushort vk, bool down) {
    INPUT input = new INPUT { type = 1 };
    input.u.ki.wVk = vk;
    input.u.ki.dwFlags = down ? 0u : 2u;
    INPUT[] inputs = new INPUT[] { input };
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
Add-Type -TypeDefinition $csharp -Language CSharp | Out-Null
[Mb08Win]::InputSize() | Out-Null

function Reply([object]$obj) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 5))
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq '') { continue }
  if ($line -eq 'exit') { break }
  try {
    $cmd = $line | ConvertFrom-Json
    switch ($cmd.op) {
      'ping' { Reply @{ ok = $true; inputSize = [Mb08Win]::InputSize() } }
      'windows' {
        $pids = @($cmd.pids | ForEach-Object { [int]$_ })
        Reply @{ ok = $true; rows = [Mb08Win]::Windows($pids) }
      }
      'focus' { [Mb08Win]::Focus([int64]$cmd.hwnd); Reply @{ ok = $true } }
      'topmost' { [Mb08Win]::Topmost([int64]$cmd.hwnd); Reply @{ ok = $true } }
      'keys' { Reply @{ ok = $true; result = [Mb08Win]::Keys([int64]$cmd.hwnd, [uint16]$cmd.vk) } }
      'click' {
        $pids = @($cmd.pids | ForEach-Object { [int]$_ })
        Reply @{ ok = $true; result = [Mb08Win]::Click([int]$cmd.x, [int]$cmd.y, $pids) }
      }
      'find' {
        Add-Type -AssemblyName UIAutomationClient
        $query = ''
        if ($cmd.queryB64) { $query = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$cmd.queryB64)) }
        $wanted = @('ControlType.Button', 'ControlType.MenuItem', 'ControlType.ListItem', 'ControlType.SplitButton', 'ControlType.Hyperlink')
        $matches = @()
        foreach ($hwnd in @($cmd.hwnds)) {
          $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$hwnd)
          if ($null -eq $window) { continue }
          $top = [int]$window.Current.BoundingRectangle.Y
          $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
          foreach ($element in $elements) {
            $type = [string]$element.Current.ControlType.ProgrammaticName
            if ($wanted -notcontains $type) { continue }
            $name = [string]$element.Current.Name
            if ($query -and -not $name.Contains($query)) { continue }
            $rect = $element.Current.BoundingRectangle
            if ($rect.Width -lt 4 -or $rect.Height -lt 4) { continue }
            $centerY = [int]($rect.Y + ($rect.Height / 2))
            if ($cmd.maxDy -and ($centerY - $top) -gt [int]$cmd.maxDy) { continue }
            $matches += @{ name = $name; x = [int]($rect.X + ($rect.Width / 2)); y = $centerY; w = [int]$rect.Width; h = [int]$rect.Height }
            if ($matches.Count -ge 40) { break }
          }
          if ($matches.Count -ge 40) { break }
        }
        Reply @{ ok = $true; count = $matches.Count; matches = $matches }
      }
      default { Reply @{ ok = $false; error = 'UI_OP' } }
    }
  } catch {
    Reply @{ ok = $false; error = 'UI_FAILED' }
  }
}
