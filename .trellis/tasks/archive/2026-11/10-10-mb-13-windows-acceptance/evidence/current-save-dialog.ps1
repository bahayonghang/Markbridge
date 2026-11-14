# Adapted from R08: inspect/save/cancel only, restricted to this run's process and root.
param(
  [Parameter(Mandatory=$true)][uint32]$TargetProcessId,
  [ValidateSet('inspect','save','cancel')][string]$Action = 'inspect',
  [string]$TargetPath,
  [string]$IsolationRoot
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Task13Dialog {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr window, EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, string text);
  public static uint Pid;
  public static readonly List<IntPtr> Dialogs = new List<IntPtr>();
  public static IntPtr Filename = IntPtr.Zero;
  public static string ClassName(IntPtr window) { var name=new StringBuilder(256); GetClassName(window,name,256); return name.ToString(); }
  public static bool Find(IntPtr window, IntPtr param) {
    uint pid; GetWindowThreadProcessId(window,out pid);
    if(pid==Pid && IsWindowVisible(window) && ClassName(window)=="#32770" && GetDlgItem(window,1)!=IntPtr.Zero && GetDlgItem(window,2)!=IntPtr.Zero) Dialogs.Add(window);
    return true;
  }
  public static bool FindFilename(IntPtr window, IntPtr param) {
    if(GetDlgCtrlID(window)==1001 && ClassName(window)=="Edit") Filename=window;
    return true;
  }
}
'@
[Task13Dialog]::Pid = $TargetProcessId
$callback = [Task13Dialog+EnumProc]{ param($window,$param) [Task13Dialog]::Find($window,$param) }
[void][Task13Dialog]::EnumWindows($callback,[IntPtr]::Zero)
if ([Task13Dialog]::Dialogs.Count -eq 0) { @{ found=$false } | ConvertTo-Json -Compress; exit 0 }
if ($Action -eq 'inspect') { @{ found=$true; count=[Task13Dialog]::Dialogs.Count } | ConvertTo-Json -Compress; exit 0 }
if ([Task13Dialog]::Dialogs.Count -ne 1) { throw 'AMBIGUOUS_OWNED_SAVE_DIALOG' }
$window = [Task13Dialog]::Dialogs[0]
$buttonId = 2
if ($Action -eq 'save') {
  $root = [IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
  $path = [IO.Path]::GetFullPath($TargetPath)
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if (-not [IO.Path]::IsPathRooted($IsolationRoot) -or -not [IO.Path]::IsPathRooted($TargetPath) -or [IO.Path]::GetDirectoryName($root) -ne $temp -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-[A-Za-z0-9-]+$') { throw 'NON_ISOLATED_ROOT' }
  if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ROOT_REDIRECTED' }
  if ([IO.Path]::GetDirectoryName($path) -ne (Join-Path $root 'exports') -or (Get-Item -LiteralPath (Join-Path $root 'exports')).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'OUTPUT_OUTSIDE_FIXTURE_EXPORTS' }
  if (Test-Path -LiteralPath $path) { throw 'OUTPUT_ALREADY_EXISTS' }
  $find = [Task13Dialog+EnumProc]{ param($child,$param) [Task13Dialog]::FindFilename($child,$param) }
  [void][Task13Dialog]::EnumChildWindows($window,$find,[IntPtr]::Zero)
  if ([Task13Dialog]::Filename -eq [IntPtr]::Zero) { throw 'FILENAME_CONTROL_NOT_FOUND' }
  if ([Task13Dialog]::SendMessage([Task13Dialog]::Filename,0x000C,[IntPtr]::Zero,$path) -eq [IntPtr]::Zero) { throw 'FILENAME_NOT_SET' }
  $buttonId = 1
}
$button = [Task13Dialog]::GetDlgItem($window,$buttonId)
if (-not [Task13Dialog]::PostMessage($button,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'DIALOG_ACTION_NOT_POSTED' }
@{ found=$true; action=$Action; posted=$true } | ConvertTo-Json -Compress
