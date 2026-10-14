param(
  [Parameter(Mandatory=$true)][uint32]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$IsolationRoot,
  [Parameter(Mandatory=$true)][string]$MainTitle,
  [int]$ClientWidth, [int]$ClientHeight,
  [string]$OutPath
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
$root=[IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($root) -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-s02-[A-Za-z0-9-]+$') { throw 'NON_ISOLATED_ROOT' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ROOT_REDIRECTED' }
$owner=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if ($null -eq $owner -or $owner.ExecutablePath -ne (Join-Path $root 'install\markbridge-desktop.exe')) { throw 'OWNED_EXECUTABLE_MISMATCH' }
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S02Window {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window,StringBuilder title,int length);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window,int index);
  [DllImport("user32.dll")] public static extern bool AdjustWindowRectExForDpi(ref Rect rect,uint style,bool menu,uint exStyle,uint dpi);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window,IntPtr hdc,uint flags);
  public struct Rect { public int Left,Top,Right,Bottom; }
  public static uint Pid; public static string Title; public static IntPtr Found;
  public static bool Find(IntPtr window,IntPtr parameter) {
    uint pid; GetWindowThreadProcessId(window,out pid);
    if(pid!=Pid)return true;
    var text=new StringBuilder(512);GetWindowText(window,text,512);
    if(text.ToString()==Title)Found=window;
    return true;
  }
}
'@
[void][S02Window]::SetProcessDpiAwarenessContext([IntPtr](-4))
[S02Window]::Pid=$TargetProcessId; [S02Window]::Title=$MainTitle
$callback=[S02Window+EnumProc]{param($window,$parameter)[S02Window]::Find($window,$parameter)}
[void][S02Window]::EnumWindows($callback,[IntPtr]::Zero)
$window=[S02Window]::Found
if($window -eq [IntPtr]::Zero){throw 'OWNED_MAIN_WINDOW_NOT_FOUND'}
$dpi=[S02Window]::GetDpiForWindow($window)
if($ClientWidth -gt 0 -and $ClientHeight -gt 0){
  $rect=New-Object S02Window+Rect
  $rect.Right=$ClientWidth; $rect.Bottom=$ClientHeight
  [void][S02Window]::AdjustWindowRectExForDpi([ref]$rect,[uint32][S02Window]::GetWindowLong($window,-16),$false,[uint32][S02Window]::GetWindowLong($window,-20),$dpi)
  if(-not [S02Window]::SetWindowPos($window,[IntPtr]::Zero,0,0,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top),0x16)){throw 'OWNED_WINDOW_RESIZE_FAILED'}
}
$client=New-Object S02Window+Rect
[void][S02Window]::GetClientRect($window,[ref]$client)
if($OutPath){
  $path=[IO.Path]::GetFullPath($OutPath)
  $evidenceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'native'))+'\'
  if(-not $path.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'SCREENSHOT_OUTSIDE_TASK'}
  $rect=New-Object S02Window+Rect
  [void][S02Window]::GetWindowRect($window,[ref]$rect)
  $bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
  $graphics=[Drawing.Graphics]::FromImage($bitmap); $hdc=$graphics.GetHdc()
  $printed=[S02Window]::PrintWindow($window,$hdc,2);$graphics.ReleaseHdc($hdc)
  $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png);$graphics.Dispose();$bitmap.Dispose()
  if(-not $printed){throw 'OWNED_WINDOW_PRINT_FAILED'}
}
@{pid=$TargetProcessId;title=$MainTitle;ownedExecutableVerified=$true;dpi=$dpi;clientWidth=$client.Right;clientHeight=$client.Bottom} | ConvertTo-Json -Compress
