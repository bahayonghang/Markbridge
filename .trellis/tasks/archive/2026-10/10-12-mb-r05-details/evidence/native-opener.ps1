param([uint32]$TargetProcessId,[uint32]$ExpectedParentId,[string]$ExpectedUrl)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class R05ThreadQuery {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")]
  public static extern int NtQueryInformationThread(IntPtr thread, int cls, out uint info, int len, IntPtr ret);
}
'@
$pidValue = $TargetProcessId
$p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue"
if (-not $p) { '{"missing":true}'; exit 0 }
if ([int]$p.ParentProcessId -ne $ExpectedParentId -or $p.Name -ne 'rundll32.exe') { throw 'UNEXPECTED_OPENER_PROCESS' }
$cmd = [string]$p.CommandLine
$needle = $ExpectedUrl
$handler = $cmd.Contains('url.dll,FileProtocolHandler')
$urlMatched = $cmd.Contains($needle)
$kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $pidValue").Count
$threads = @(Get-CimInstance Win32_Thread -Filter "ProcessHandle = $pidValue")
$suspended = @($threads | Where-Object { $_.ThreadState -eq 5 -and $_.ThreadWaitReason -eq 5 }).Count
$state = 'NONE'
if ($threads.Count -gt 0) { $state = '{0}:{1}' -f $threads[0].ThreadState, $threads[0].ThreadWaitReason }
$nt = -2
$suspend = 0
if ($threads.Count -gt 0) {
  $opened = [R05ThreadQuery]::OpenThread([uint32]0x0840, $false, [uint32]$threads[0].Handle)
  if ($opened -ne [IntPtr]::Zero) {
    $value = [uint32]0
    $nt = [R05ThreadQuery]::NtQueryInformationThread($opened, 35, [ref]$value, 4, [IntPtr]::Zero)
    $suspend = [int]$value
    [void][R05ThreadQuery]::CloseHandle($opened)
  }
}
$out = [ordered]@{
  missing = $false
  parent = [int]$p.ParentProcessId
  imageName = [string]$p.Name
  handler = [bool]$handler
  urlMatched = [bool]$urlMatched
  childCount = [int]$kids
  threadCount = [int]$threads.Count
  suspendedThreadCount = [int]$suspended
  threadState = [string]$state
  ntStatus = [int]$nt
  suspendCount = [int]$suspend
}
$out | ConvertTo-Json -Compress
