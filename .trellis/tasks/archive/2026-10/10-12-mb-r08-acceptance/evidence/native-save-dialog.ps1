param(
  [Parameter(Mandatory = $true)][uint32]$TargetProcessId,
  [ValidateSet('inspect','save','cancel','confirm-overwrite','dismiss-error')][string]$Action = 'inspect',
  [string]$TargetPath,
  [string]$IsolationRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class R08Dialog {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr window, EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, string text);
  public static uint Pid;
  public static readonly List<IntPtr> Dialogs = new List<IntPtr>();
  public static readonly List<string> Controls = new List<string>();
  public static readonly List<string> Buttons = new List<string>();
  public static IntPtr Filename = IntPtr.Zero;
  public static string ClassName(IntPtr window) {
    var name = new StringBuilder(256); GetClassName(window, name, 256); return name.ToString();
  }
  public static bool Find(IntPtr window, IntPtr param) {
    uint pid; GetWindowThreadProcessId(window, out pid);
    if(pid == Pid && IsWindowVisible(window) && ClassName(window) == "#32770") Dialogs.Add(window);
    return true;
  }
  public static bool Inspect(IntPtr window, IntPtr param) {
    Controls.Add(GetDlgCtrlID(window).ToString()+":"+ClassName(window));
    if(ClassName(window)=="Button" && IsWindowVisible(window)) { var text=new StringBuilder(256); GetWindowText(window,text,256); Buttons.Add(window.ToInt64().ToString()+":"+text.ToString()); }
    return true;
  }
  public static bool FindFilename(IntPtr window, IntPtr param) {
    if(GetDlgCtrlID(window)==1001 && ClassName(window)=="Edit") Filename=window;
    return true;
  }
}
'@
[R08Dialog]::Pid = $TargetProcessId
$callback = [R08Dialog+EnumProc]{ param($window,$param) [R08Dialog]::Find($window,$param) }
[void][R08Dialog]::EnumWindows($callback,[IntPtr]::Zero)
if ([R08Dialog]::Dialogs.Count -eq 0) { @{ found=$false } | ConvertTo-Json -Compress; exit 0 }

if ($Action -eq 'inspect') {
  $dialogs = @()
  foreach ($window in [R08Dialog]::Dialogs) {
    [R08Dialog]::Controls.Clear()
    [R08Dialog]::Buttons.Clear()
    $inspect = [R08Dialog+EnumProc]{ param($child,$param) [R08Dialog]::Inspect($child,$param) }
    [void][R08Dialog]::EnumChildWindows($window,$inspect,[IntPtr]::Zero)
    $dialogs += @{ hwnd=$window.ToInt64(); controls=@([R08Dialog]::Controls); buttons=@([R08Dialog]::Buttons) }
  }
  @{ found=$true; dialogs=$dialogs } | ConvertTo-Json -Compress -Depth 4
  exit 0
}

$dialog = [IntPtr]::Zero
$selectedButton = [IntPtr]::Zero
if ($Action -eq 'dismiss-error') {
  foreach ($window in [R08Dialog]::Dialogs) {
    if ([R08Dialog]::GetDlgItem($window,1) -ne [IntPtr]::Zero -and [R08Dialog]::GetDlgItem($window,2) -eq [IntPtr]::Zero -and [R08Dialog]::GetDlgItem($window,6) -eq [IntPtr]::Zero) { $dialog=$window; break }
  }
  $buttonId=1
} elseif ($Action -eq 'confirm-overwrite') {
  foreach ($window in [R08Dialog]::Dialogs) {
    if ([R08Dialog]::GetDlgItem($window,6) -ne [IntPtr]::Zero) { $dialog=$window; break }
  }
  $buttonId=6
} else {
  foreach ($window in [R08Dialog]::Dialogs) {
    if ([R08Dialog]::GetDlgItem($window,1) -ne [IntPtr]::Zero -and [R08Dialog]::GetDlgItem($window,2) -ne [IntPtr]::Zero) { $dialog=$window; break }
  }
  $buttonId=2
}
if ($dialog -eq [IntPtr]::Zero -and ($Action -eq 'confirm-overwrite' -or $Action -eq 'dismiss-error')) {
  $label = if ($Action -eq 'confirm-overwrite') { '^&?Yes$' } else { '^&?OK$' }
  foreach ($window in [R08Dialog]::Dialogs) {
    [R08Dialog]::Buttons.Clear()
    $inspect = [R08Dialog+EnumProc]{ param($child,$param) [R08Dialog]::Inspect($child,$param) }
    [void][R08Dialog]::EnumChildWindows($window,$inspect,[IntPtr]::Zero)
    foreach ($entry in [R08Dialog]::Buttons) {
      $separator=$entry.IndexOf(':')
      if ($entry.Substring($separator+1) -match $label) { $dialog=$window; $selectedButton=[IntPtr]([long]$entry.Substring(0,$separator)); break }
    }
    if ($dialog -ne [IntPtr]::Zero) { break }
  }
}
if ($dialog -eq [IntPtr]::Zero) { throw 'EXPECTED_OWNED_DIALOG_NOT_FOUND' }

if ($Action -eq 'save') {
  $root = [System.IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
  $path = [System.IO.Path]::GetFullPath($TargetPath)
  $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
  if ([System.IO.Path]::GetDirectoryName($root) -ne $temp -or -not [System.IO.Path]::GetFileName($root).StartsWith('markbridge-r08-native-')) { throw 'NON_ISOLATED_ROOT' }
  if (-not $path.StartsWith($root+'\',[System.StringComparison]::OrdinalIgnoreCase)) { throw 'OUTPUT_OUTSIDE_FIXTURE' }
  $findFilename = [R08Dialog+EnumProc]{ param($child,$param) [R08Dialog]::FindFilename($child,$param) }
  [void][R08Dialog]::EnumChildWindows($dialog,$findFilename,[IntPtr]::Zero)
  if ([R08Dialog]::Filename -eq [IntPtr]::Zero) { throw 'FILENAME_CONTROL_NOT_FOUND' }
  if ([R08Dialog]::SendMessage([R08Dialog]::Filename,0x000C,[IntPtr]::Zero,$path) -eq [IntPtr]::Zero) { throw 'FILENAME_NOT_SET' }
  $buttonId=1
}
$button = if ($selectedButton -ne [IntPtr]::Zero) { $selectedButton } else { [R08Dialog]::GetDlgItem($dialog,$buttonId) }
if ($button -eq [IntPtr]::Zero -or -not [R08Dialog]::PostMessage($button,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'DIALOG_ACTION_NOT_POSTED' }
@{ found=$true; action=$Action; posted=$true } | ConvertTo-Json -Compress
