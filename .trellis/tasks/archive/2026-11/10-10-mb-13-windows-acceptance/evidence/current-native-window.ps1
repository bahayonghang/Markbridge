param(
  [ValidateSet('inspect','close')][string]$Action = 'close',
  [Parameter(Mandatory=$true)][uint32]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$ExpectedExecutable,
  [Parameter(Mandatory=$true)][string]$IsolationRoot,
  [Parameter(Mandatory=$true)][string]$MainTitle,
  [Parameter(Mandatory=$true)][string]$PreviewTitle
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$expected = Join-Path $root 'install\markbridge-desktop.exe'
if (-not [IO.Path]::IsPathRooted($IsolationRoot) -or [IO.Path]::GetDirectoryName($root) -ne $temp -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-[A-Za-z0-9-]+$' -or $ExpectedExecutable -ne $expected) { throw 'NON_ISOLATED_WINDOW_TARGET' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ROOT_REDIRECTED' }
$owner = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if ($null -eq $owner) { @{ action=$Action; pid=$TargetProcessId; processAbsent=$true; ownedWindows=0; posted=0; windows=@() } | ConvertTo-Json -Compress; exit }
if ($owner.ExecutablePath -ne $expected) { throw 'WINDOW_PROCESS_EXECUTABLE_MISMATCH' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Task13Window {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder title, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static uint Pid;
  public static string MainTitle;
  public static string PreviewTitle;
  public class Observation {
    public string handle;
    public uint threadId;
    public bool visible;
    public string role;
    public string className;
    public bool emptyTitle;
    public bool messageOnly;
    public bool closeEligible;
    public IntPtr Window;
  }
  public static readonly List<Observation> Windows = new List<Observation>();
  public static void Observe(IntPtr window, bool messageOnly) {
    uint owner; uint thread=GetWindowThreadProcessId(window,out owner);
    if(owner!=Pid) return;
    var title=new StringBuilder(512); GetWindowText(window,title,512);
    var windowClass=new StringBuilder(256); GetClassName(window,windowClass,256);
    string nativeClass=windowClass.ToString();
    string className=nativeClass=="Tao Thread Event Target" ? "TAO_THREAD_EVENT_TARGET" : nativeClass=="Tao Window" ? "TAO_WINDOW" :
      System.Text.RegularExpressions.Regex.IsMatch(nativeClass, "^[A-Za-z0-9_.-]{1,128}$") ? nativeClass : "UNREPORTED_CLASS";
    string role=title.ToString()==MainTitle ? "main" : title.ToString()==PreviewTitle ? "preview" : "other";
    bool visible=IsWindowVisible(window);
    Windows.Add(new Observation { handle=window.ToInt64().ToString("X"), threadId=thread, visible=visible,
      role=role, className=className, emptyTitle=title.Length==0, messageOnly=messageOnly,
      closeEligible=!messageOnly && (role=="main" || role=="preview"), Window=window });
  }
  public static bool Find(IntPtr window, IntPtr param) {
    Observe(window,false);
    return true;
  }
  public static void FindMessageOnly() {
    IntPtr window=IntPtr.Zero;
    while((window=FindWindowEx(new IntPtr(-3),window,null,null))!=IntPtr.Zero) Observe(window,true);
  }
}
'@
[Task13Window]::Pid = $TargetProcessId
[Task13Window]::MainTitle = $MainTitle
[Task13Window]::PreviewTitle = $PreviewTitle
$callback = [Task13Window+EnumProc]{ param($window,$param) [Task13Window]::Find($window,$param) }
[void][Task13Window]::EnumWindows($callback,[IntPtr]::Zero)
[Task13Window]::FindMessageOnly()
$posted = 0
if ($Action -eq 'close') {
  foreach ($row in [Task13Window]::Windows) {
    if (-not $row.closeEligible) { continue }
    if (-not [Task13Window]::PostMessage($row.Window,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'OWNED_WINDOW_CLOSE_NOT_POSTED' }
    $posted++
  }
}
$windows = @([Task13Window]::Windows | ForEach-Object { @{ handle=$_.handle; threadId=$_.threadId; visible=$_.visible; role=$_.role; className=$_.className; emptyTitle=$_.emptyTitle; messageOnly=$_.messageOnly; closeEligible=$_.closeEligible } })
@{ action=$Action; pid=$TargetProcessId; processAbsent=$false; ownedWindows=$windows.Count; posted=$posted; windows=$windows } | ConvertTo-Json -Depth 4 -Compress
