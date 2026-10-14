param(
  [Parameter(Mandatory=$true)][uint32]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$IsolationRoot,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [Parameter(Mandatory=$true)][string]$MainTitle
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$root = [IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$expected = Join-Path $root 'install\markbridge-desktop.exe'
if ([IO.Path]::GetDirectoryName($root) -ne $temp -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-[A-Za-z0-9-]+$') { throw 'NON_ISOLATED_ROOT' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ROOT_REDIRECTED' }
$owner = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if ($null -eq $owner -or $owner.ExecutablePath -ne $expected) { throw 'WINDOW_PROCESS_EXECUTABLE_MISMATCH' }
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
$allowedEvidence = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'native'))
if ([IO.Path]::GetDirectoryName($evidence) -ne $allowedEvidence -or [IO.Path]::GetFileName($evidence) -notmatch '^[a-z0-9-]+$') { throw 'EVIDENCE_DIRECTORY_OUTSIDE_TASK' }
Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class S01Window {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr window, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  public struct Rect { public int Left,Top,Right,Bottom; }
  public static uint Pid;
  public static string Title;
  public static IntPtr Found;
  public static bool Find(IntPtr window, IntPtr param) {
    uint owner; GetWindowThreadProcessId(window,out owner);
    if (owner != Pid) return true;
    var text = new StringBuilder(512); GetWindowText(window,text,512);
    if (text.ToString() == Title) Found=window;
    return true;
  }
}
'@
[void][S01Window]::SetProcessDpiAwarenessContext([IntPtr](-4))
[S01Window]::Pid=$TargetProcessId
[S01Window]::Title=$MainTitle
$callback=[S01Window+EnumProc]{ param($window,$param) [S01Window]::Find($window,$param) }
[void][S01Window]::EnumWindows($callback,[IntPtr]::Zero)
$window=[S01Window]::Found
if ($window -eq [IntPtr]::Zero) { throw 'OWNED_MAIN_WINDOW_NOT_FOUND' }
[void][S01Window]::ShowWindow($window,9)
[void][S01Window]::SetForegroundWindow($window)
$rect=New-Object S01Window+Rect
$client=New-Object S01Window+Rect
[void][S01Window]::GetWindowRect($window,[ref]$rect)
[void][S01Window]::GetClientRect($window,[ref]$client)
$bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$hdc=$graphics.GetHdc()
$printed=[S01Window]::PrintWindow($window,$hdc,2)
$graphics.ReleaseHdc($hdc)
$bitmap.Save((Join-Path $evidence 'desktop-window.png'),[Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
if (-not $printed) { throw 'OWNED_WINDOW_PRINT_FAILED' }
$icons=@()
foreach ($kind in @(@{name='small';type=0;fallback=-34},@{name='large';type=1;fallback=-14})) {
  $handle=[S01Window]::SendMessage($window,0x007f,[IntPtr]$kind.type,[IntPtr]::Zero)
  $source='WM_GETICON'
  if ($handle -eq [IntPtr]::Zero) { $handle=[S01Window]::GetClassLongPtr($window,$kind.fallback); $source='window-class' }
  if ($handle -eq [IntPtr]::Zero) {
    if ($kind.name -eq 'small') { throw 'OWNED_WINDOW_ICON_MISSING' }
    $icons+=@{kind=$kind.name;present=$false}
    continue
  }
  $icon=[Drawing.Icon]::FromHandle($handle)
  $image=$icon.ToBitmap()
  $image.Save((Join-Path $evidence ("window-icon-"+$kind.name+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  $icons+=@{kind=$kind.name;width=$image.Width;height=$image.Height;source=$source}
  $image.Dispose()
}
$associated=[Drawing.Icon]::ExtractAssociatedIcon($expected)
$image=$associated.ToBitmap()
$image.Save((Join-Path $evidence 'exe-associated-icon.png'),[Drawing.Imaging.ImageFormat]::Png)
$image.Dispose(); $associated.Dispose()
$taskbar=[Windows.Automation.AutomationElement]::FromHandle([S01Window]::FindWindow('Shell_TrayWnd',$null))
$buttons=$taskbar.FindAll([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ControlTypeProperty),([Windows.Automation.ControlType]::Button)))
$taskbarEvidence=$null
foreach ($button in $buttons) {
  # Observe only the temporary app's named button, never other taskbar captions.
  if (-not $button.Current.Name.StartsWith($MainTitle,[StringComparison]::Ordinal)) { continue }
  $bounds=$button.Current.BoundingRectangle
  if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
  $bitmap=New-Object Drawing.Bitmap ([int]$bounds.Width),([int]$bounds.Height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen([int]$bounds.X,[int]$bounds.Y,0,0,$bitmap.Size)
  $bitmap.Save((Join-Path $evidence 'taskbar-button.png'),[Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  $taskbarEvidence=@{name=$button.Current.Name;x=$bounds.X;y=$bounds.Y;width=$bounds.Width;height=$bounds.Height;method='owned_button_UIAutomation_CopyFromScreen'}
  break
}
@{pid=$TargetProcessId;ownedExecutableVerified=$true;windowHandle=$window.ToInt64().ToString('X');title=$MainTitle;dpi=[S01Window]::GetDpiForWindow($window);clientWidth=$client.Right;clientHeight=$client.Bottom;printed=$printed;icons=$icons;taskbar=$taskbarEvidence} | ConvertTo-Json -Depth 5 -Compress
