param(
  [Parameter(Mandatory=$true)][ValidateSet('preflight','install-state','processes','file-version','credential','webview-data','debug-listener-owner','known-webview-presence','recovery-proof','restore-install-location')][string]$Action,
  [Parameter(Mandatory=$true)][string]$IsolationRoot,
  [string]$TargetFile,
  [string]$Namespace,
  [string]$Reference,
  [string]$PlanPath,
  [string]$ReceiptPath,
  [uint32]$TargetProcessId,
  [int]$DebugPort,
  [string]$PreviewProfileId,
  [string]$LateCloseProofPath,
  [string]$KnownProcessIdentities
)
$ErrorActionPreference = 'Stop'
function Assert-Task13ProcessIdentity([object]$Identity) {
  $names = @($Identity.PSObject.Properties.Name | Sort-Object)
  $ticks = [long]0
  if (($names -join ',') -ne 'creationUtcTicks,pid' -or
      -not ($Identity.pid -is [int] -or $Identity.pid -is [long] -or $Identity.pid -is [uint32]) -or
      $Identity.pid -lt 1 -or $Identity.pid -gt [uint32]::MaxValue -or
      $Identity.creationUtcTicks -isnot [string] -or $Identity.creationUtcTicks -notmatch '^[1-9][0-9]{0,18}\z' -or
      -not [long]::TryParse($Identity.creationUtcTicks, [ref]$ticks) -or $ticks -gt [datetime]::MaxValue.Ticks) { throw 'WEBVIEW_PROCESS_IDENTITY_INVALID' }
}
function Get-Task13CreationUtcTicks([object]$Process) {
  $creation = $Process.CreationDate
  if ($creation -isnot [datetime] -or $creation -eq [datetime]::MinValue -or $creation.Kind -eq [DateTimeKind]::Unspecified) { throw 'WEBVIEW_PROCESS_CREATION_UNAVAILABLE' }
  return $creation.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
}
function ConvertFrom-Task13KnownIdentities([string]$Json) {
  if (-not $Json -or $Json.Length -gt 4096 -or $Json.Trim() -notmatch '^\[.*\]$') { throw 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID' }
  try { $parsed = ConvertFrom-Json -InputObject $Json; $items = @($parsed) } catch { throw 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID' }
  if ($items.Count -lt 1 -or $items.Count -gt 32) { throw 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID' }
  $keys = @{}
  foreach ($identity in $items) {
    Assert-Task13ProcessIdentity $identity
    $key = "$($identity.pid):$($identity.creationUtcTicks)"
    if ($keys.ContainsKey($key)) { throw 'WEBVIEW_KNOWN_IDENTITY_DUPLICATED' }
    $keys[$key] = $true
  }
  return ,$items
}
function Get-Task13KnownProcessState([object]$Identity, [object]$Current) {
  Assert-Task13ProcessIdentity $Identity
  $result = @{ pid=$Identity.pid; creationUtcTicks=$Identity.creationUtcTicks; state='absent' }
  if ($null -ne $Current) {
    if ($Current.ProcessId -ne $Identity.pid) { throw 'WEBVIEW_PROCESS_QUERY_IDENTITY_MISMATCH' }
    $observedTicks = Get-Task13CreationUtcTicks $Current
    $result.observedCreationUtcTicks = $observedTicks
    $result.state = if ($observedTicks -ceq $Identity.creationUtcTicks) { 'present' } else { 'pid_reused' }
  }
  return $result
}
function Get-Task13PreviewComponent([string]$ProfileId) {
  if ($ProfileId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z') { throw 'WEBVIEW_PREVIEW_PROFILE_ID_INVALID' }
  $digest = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes('markbridge:preview-session:v1' + [char]0 + $ProfileId)
    return 'v1-' + [BitConverter]::ToString($digest.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
  } finally { $digest.Dispose() }
}
function Test-Task13WebviewDirectory([string]$ActualDirectory, [string]$ExpectedDirectory) {
  return [bool]($ExpectedDirectory -and ($ActualDirectory -eq $ExpectedDirectory -or $ActualDirectory -eq (Join-Path $ExpectedDirectory 'EBWebView')))
}
$root = [IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if (-not [IO.Path]::IsPathRooted($IsolationRoot) -or [IO.Path]::GetDirectoryName($root) -ne $temp -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-[A-Za-z0-9-]+$') { throw 'NON_ISOLATED_ROOT' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ROOT_REDIRECTED' }

if ($Action -eq 'debug-listener-owner') {
  if ($DebugPort -lt 1 -or $DebugPort -gt 65535) { throw 'WEBVIEW_DEBUG_PORT_INVALID' }
  $expected = Join-Path $root 'install\markbridge-desktop.exe'
  $app = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
  if ($null -eq $app -or $app.ExecutablePath -ne $expected) { throw 'WEBVIEW_DEBUG_APP_EXECUTABLE_MISMATCH' }
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $DebugPort -ErrorAction SilentlyContinue)
  $owners = @($listeners.OwningProcess | Select-Object -Unique)
  if ($owners.Count -ne 1) { throw 'WEBVIEW_DEBUG_LISTENER_NOT_UNIQUE' }
  $child = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
  if ($null -eq $child -or $child.ParentProcessId -ne $TargetProcessId -or $child.Name -ne 'msedgewebview2.exe' -or
      [IO.Path]::GetFileName($child.ExecutablePath) -ne 'msedgewebview2.exe' -or -not [IO.Path]::IsPathRooted($child.ExecutablePath)) { throw 'WEBVIEW_DEBUG_LISTENER_NOT_OWNED' }
  @{ appPid=$TargetProcessId; webviewPid=$child.ProcessId; creationUtcTicks=(Get-Task13CreationUtcTicks $child); debugPort=$DebugPort; listenerOwned=$true; appExecutableMatched=$true; directWebviewChild=$true } | ConvertTo-Json -Compress
  exit
}

if ($Action -eq 'known-webview-presence') {
  $identities = ConvertFrom-Task13KnownIdentities $KnownProcessIdentities
  $observations = @()
  foreach ($identity in $identities) {
    $knownPid = [uint32]$identity.pid
    # A reused PID is not the original WebView. Read no replacement command, name or path.
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$knownPid" -Property ProcessId,CreationDate
    $observations += Get-Task13KnownProcessState $identity $current
  }
  @{ presentPids=@($observations | Where-Object { $_.state -eq 'present' } | ForEach-Object { $_.pid });
     reusedPids=@($observations | Where-Object { $_.state -eq 'pid_reused' } | ForEach-Object { $_.pid }); observations=$observations } | ConvertTo-Json -Compress -Depth 4
  exit
}

if ($Action -eq 'webview-data') {
  $expectedExe = Join-Path $root 'install\markbridge-desktop.exe'
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
  if ($null -eq $owner -or $owner.ExecutablePath -ne $expectedExe) { throw 'WEBVIEW_OWNER_EXECUTABLE_MISMATCH' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Task13Arguments {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CommandLineToArgvW(string command, out int count);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
  public static string[] Split(string command) {
    int count; var pointer=CommandLineToArgvW(command,out count);
    if(pointer==IntPtr.Zero) throw new Exception("WEBVIEW_ARGUMENT_PARSE_FAILED");
    try { var args=new string[count]; for(int i=0;i<count;i++) args[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size)); return args; }
    finally { LocalFree(pointer); }
  }
}
'@
  function Normalize-Task13Path([string]$value) {
    $path = $value.Trim('"').Replace('/','\')
    if ($path.StartsWith('\\?\')) { $path=$path.Substring(4) }
    if ($path.StartsWith('\??\')) { $path=$path.Substring(4) }
    if (-not [IO.Path]::IsPathRooted($path)) { throw 'WEBVIEW_DATA_ARGUMENT_NOT_ABSOLUTE' }
    return [IO.Path]::GetFullPath($path).TrimEnd('\')
  }
  $main = Join-Path $root 'app-data\main-webview'
  $preview = $null
  if ($PreviewProfileId) {
    $component = Get-Task13PreviewComponent $PreviewProfileId
    $preview = Join-Path (Join-Path $root 'app-data\preview-sessions') $component
  }
  foreach ($directory in @((Join-Path $root 'app-data'), $main, (Join-Path $main 'EBWebView'), (Join-Path $root 'app-data\preview-sessions'), $preview,
      $(if ($preview) { Join-Path $preview 'EBWebView' })) | Where-Object { $_ }) {
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'WEBVIEW_EXPECTED_DIRECTORY_REDIRECTED' }
  }
  $observations = @()
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$TargetProcessId AND Name='msedgewebview2.exe'")) {
    if (-not $child.CommandLine) { throw 'WEBVIEW_CHILD_ARGUMENTS_UNAVAILABLE' }
    $webviewArgs = [Task13Arguments]::Split($child.CommandLine)
    $value = $null
    for ($index=0; $index -lt $webviewArgs.Length; $index++) {
      if ($webviewArgs[$index].StartsWith('--user-data-dir=')) { $value=$webviewArgs[$index].Substring(16); break }
      if ($webviewArgs[$index] -eq '--user-data-dir' -and $index+1 -lt $webviewArgs.Length) { $value=$webviewArgs[$index+1]; break }
    }
    if (-not $value) { continue }
    $actual = Normalize-Task13Path $value
    $inside = $actual.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
    # WebView2 may append only this documented runtime suffix to the host's folder.
    $matchesMain = Test-Task13WebviewDirectory $actual $main
    $matchesPreview = Test-Task13WebviewDirectory $actual $preview
    $relative = if ($inside) { $actual.Substring($root.Length+1).Replace('\','/') } else { $null }
    $exists = [bool](($matchesMain -or $matchesPreview) -and (Test-Path -LiteralPath $actual -PathType Container))
    $observations += @{ pid=$child.ProcessId; creationUtcTicks=(Get-Task13CreationUtcTicks $child); parent=$child.ParentProcessId; insideFixture=$inside; expectedMain=$matchesMain; expectedPreview=$matchesPreview; observedDirectoryExists=$exists; relativeDirectory=$relative }
  }
  # Never return or probe the contents/existence of an observed directory outside this fixture.
  @{ owner=$TargetProcessId; observations=$observations; mainDirectoryExists=[bool](Test-Path -LiteralPath $main -PathType Container);
     previewDirectoryExists=[bool]($null -ne $preview -and (Test-Path -LiteralPath $preview -PathType Container)) } | ConvertTo-Json -Compress -Depth 4
  exit
}

if ($Action -eq 'restore-install-location' -or $Action -eq 'recovery-proof') {
  $planFile = [IO.Path]::GetFullPath($PlanPath)
  $receiptFile = [IO.Path]::GetFullPath($ReceiptPath)
  if (-not [IO.Path]::IsPathRooted($PlanPath) -or -not [IO.Path]::IsPathRooted($ReceiptPath) -or
      [IO.Path]::GetDirectoryName($planFile) -ne $PSScriptRoot -or [IO.Path]::GetDirectoryName($receiptFile) -ne $PSScriptRoot) { throw 'RESTORE_EVIDENCE_OUTSIDE_TASK' }
  $plan = Get-Content -LiteralPath $planFile -Raw | ConvertFrom-Json
  $receipt = Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
  $marker = Get-Content -LiteralPath (Join-Path $root 'task13-plan.json') -Raw | ConvertFrom-Json
  $uuid = '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  if ($plan.runId -notmatch $uuid -or $receipt.attemptId -notmatch $uuid -or $receipt.runId -ne $plan.runId -or $marker.runId -ne $plan.runId -or
      [IO.Path]::GetFileName($planFile) -ne "current-installer-$($plan.runId)-plan.json" -or
      [IO.Path]::GetFileName($receiptFile) -ne "current-installer-$($plan.runId)-$($receipt.attemptId)-receipt.json" -or $plan.state -ne 'PREPARED') { throw 'RESTORE_RUN_IDENTITY_MISMATCH' }
  $install = Join-Path $root 'install'
  $exe = Join-Path $install 'markbridge-desktop.exe'
  if ($plan.root -ne $root -or $receipt.root -ne $root -or $plan.installDirectory -ne $install -or $plan.executable -ne $exe -or
      $receipt.plan -ne [IO.Path]::GetFileName($planFile)) { throw 'RESTORE_INSTALL_DIRECTORY_MISMATCH' }
  if (-not $receipt.finishedAt -or -not $receipt.install -or $receipt.install.exitCode -ne 0 -or $null -ne $receipt.install.signal -or
      -not $plan.preflight -or @($plan.preflight.keys).Count -ne 0 -or $plan.preflight.shortcutCount -ne 0 -or $plan.preflight.runPresent -or
      -not $receipt.preflight -or @($receipt.preflight.keys).Count -ne 0 -or $receipt.preflight.shortcutCount -ne 0 -or $receipt.preflight.runPresent) { throw 'RESTORE_PREFLIGHT_ABSENCE_OR_COMPLETED_INSTALL_PROOF_MISSING' }
  if (-not $receipt.registration.registration -or $receipt.registration.registration.installLocation.Trim('"') -ne $install -or
      $receipt.registration.registration.mainBinaryName -ne 'markbridge-desktop.exe' -or $receipt.registration.registration.displayVersion -ne $plan.appVersion) { throw 'RESTORE_CREATED_REGISTRATION_PROOF_MISSING' }
  if ((Test-Path -LiteralPath $install) -and ((Get-Item -LiteralPath $install).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INSTALL_DIRECTORY_REDIRECTED' }
  if ($Action -eq 'recovery-proof') {
    $normalExit = $receipt.finalExit -and $receipt.finalExit.exitCode -eq 0 -and $null -eq $receipt.finalExit.signal
    $recordedCloseTimeout = @($receipt.errors | Where-Object { $_.phase -eq 'app-close' -and $_.code -eq 'NORMAL_APP_CLOSE_TIMEOUT' }).Count -eq 1
    if ((-not $normalExit -and -not $recordedCloseTimeout) -or
        @($receipt.controls | Where-Object { $_.control -eq 'exact_test_os_credentials_revoked' -and $_.status -eq 'PASS' }).Count -ne 1) { throw 'RECOVERY_REQUIRES_RECORDED_APP_CLOSE_AND_TEST_CREDENTIAL_REVOCATION' }
    $remaining = @(Get-CimInstance Win32_Process | Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\', [StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($root+'\', [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($remaining.Count -ne 0) { throw 'RECOVERY_REQUIRES_CURRENT_FIXTURE_PROCESS_ABSENCE' }
    $knownAbsence = @()
    $lateClose = $null
    if (-not $normalExit -and -not $LateCloseProofPath) { throw 'RECOVERY_REQUIRES_EXACT_LATE_OWNED_PID_ABSENCE' }
    if ($LateCloseProofPath) {
      $proofPath = [IO.Path]::GetFullPath($LateCloseProofPath)
      if (-not [IO.Path]::IsPathRooted($LateCloseProofPath) -or [IO.Path]::GetDirectoryName($proofPath) -ne $PSScriptRoot -or
          [IO.Path]::GetFileName($proofPath) -ne "current-late-close-$($plan.runId.Split('-')[0]).json") { throw 'RECOVERY_LATE_CLOSE_PROOF_OUTSIDE_RUN' }
      $lateClose = Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
      if ($lateClose.kind -ne 'late_owned_normal_close_observation' -or $lateClose.runId -ne $plan.runId -or
          $lateClose.normalWmClosePosted -ne $true -or $lateClose.appProcessAbsent -ne $true -or $lateClose.webviewProcessAbsent -ne $true -or
          $lateClose.originalNativeRunStatus -ne 'FAIL' -or $lateClose.forcedTermination -ne $false -or $null -ne $lateClose.observedExitCode -or
          [uint32]$lateClose.appPid -eq 0 -or [uint32]$lateClose.webviewPid -eq 0 -or $lateClose.appPid -eq $lateClose.webviewPid) { throw 'RECOVERY_LATE_CLOSE_PROOF_INVALID' }
      foreach ($knownId in @($lateClose.appPid, $lateClose.webviewPid)) {
        $knownPid = [uint32]$knownId
        if ($null -ne (Get-CimInstance Win32_Process -Filter "ProcessId=$knownPid")) { throw 'RECOVERY_KNOWN_OWNED_PROCESS_REMAINED' }
        $knownAbsence += @{ pid=$knownPid; absent=$true }
      }
    }
    @{ runId=$plan.runId; attemptId=$receipt.attemptId; guardedInstall=$install; proof='completed_owned_fixture_run';
       originalNormalExitRecorded=[bool]$normalExit; recordedCloseTimeout=[bool]$recordedCloseTimeout; currentFixtureProcessesAbsent=$true;
       exactKnownProcessAbsence=$knownAbsence; lateCloseObservation=$lateClose; knownPidSource='adjacent_main_session_owned_process_observation' } | ConvertTo-Json -Compress -Depth 4
    exit
  }
  if (-not $receipt.uninstall -or $receipt.uninstall.exitCode -ne 0 -or $null -ne $receipt.uninstall.signal) { throw 'RESTORE_NORMAL_UNINSTALL_RECEIPT_MISSING' }
  if ((Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Markbridge') -or
      (Test-Path -LiteralPath $exe) -or (Test-Path -LiteralPath (Join-Path $install 'uninstall.exe'))) { throw 'RESTORE_REQUIRES_COMPLETED_NORMAL_UNINSTALL' }
  $owned = @(Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($root+'\', [StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
  if ($owned.Count -ne 0) { throw 'RESTORE_REQUIRES_STOPPED_FIXTURE_PROCESSES' }
  $keyPath = 'Software\markbridge\Markbridge'
  $hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  $key = $null
  try {
    $key = $hive.OpenSubKey($keyPath, $true)
    if ($null -eq $key) { @{ status='already_absent'; removedDefaultValue=$false; removedEmptyProductKey=$false } | ConvertTo-Json -Compress; exit }
    $names = @($key.GetValueNames())
    if ($names.Count -ne 1 -or $names[0] -ne '' -or $key.GetSubKeyNames().Length -ne 0 -or $key.GetValue('') -ne $install -or
        $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'INSTALL_LOCATION_RESIDUE_CONFLICT_PRESERVED' }
    # Restore only the unnamed value created by this guarded run. Never delete a parent key.
    $key.DeleteValue('', $true)
    if ($key.GetValueNames().Length -ne 0 -or $key.GetSubKeyNames().Length -ne 0) { throw 'PRODUCT_KEY_CHANGED_AFTER_DEFAULT_REMOVAL_PRESERVED' }
    $key.Dispose(); $key = $null
    $hive.DeleteSubKey($keyPath, $true)
    if ($null -ne $hive.OpenSubKey($keyPath)) { throw 'PRODUCT_KEY_REMAINS_AFTER_RESTORE' }
    @{ status='restored'; removedDefaultValue=$true; removedEmptyProductKey=$true } | ConvertTo-Json -Compress
  } finally { if ($null -ne $key) { $key.Dispose() }; $hive.Dispose() }
  exit
}

if ($Action -eq 'file-version') {
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo([IO.Path]::GetFullPath($TargetFile))
  @{ fileVersion=$info.FileVersion; productVersion=$info.ProductVersion } | ConvertTo-Json -Compress
  exit
}
if ($Action -eq 'credential') {
  if ($Namespace -notmatch '^Markbridge\.Task06\.[A-Za-z0-9-]{1,80}$' -or $Reference -notmatch '^credential:[A-Za-z0-9-]{1,80}$') { throw 'NON_FIXTURE_CREDENTIAL_TARGET' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Task13Credential {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
}
'@
  $pointer = [IntPtr]::Zero
  $present = [Task13Credential]::CredRead("Markbridge/$Namespace/$Reference", 1, 0, [ref]$pointer)
  $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($present) { [Task13Credential]::CredFree($pointer) }
  elseif ($errorCode -ne 1168) { throw 'FIXTURE_CREDENTIAL_QUERY_FAILED' }
  # Read only the exact generated test target; never enumerate credentials or blobs.
  @{ present=$present } | ConvertTo-Json -Compress
  exit
}
if ($Action -eq 'processes') {
  $rows = @(Get-CimInstance Win32_Process)
  $owned = @($rows | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($root+'\', [StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
  $ids = @($owned | ForEach-Object { [uint32]$_.ProcessId })
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | ForEach-Object {
    @{ pid=$_.OwningProcess; address=$_.LocalAddress; port=$_.LocalPort }
  })
  @{ processes=@($owned | ForEach-Object { @{ pid=$_.ProcessId; parent=$_.ParentProcessId; name=$_.Name } }); listeners=$listeners } | ConvertTo-Json -Compress -Depth 4
  exit
}

# Exact installer registration and shortcut collisions only. No application or Chrome data discovery.
$keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Markbridge', 'HKCU:\Software\markbridge\Markbridge',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Markbridge', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Markbridge', 'HKLM:\Software\markbridge\Markbridge')
$presentKeys = @($keys | Where-Object { Test-Path -LiteralPath $_ })
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Markbridge.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Markbridge.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Markbridge\Markbridge.lnk'))
$presentShortcuts = @($shortcuts | Where-Object { Test-Path -LiteralPath $_ })
$runKey = Get-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
$runPresent = $runKey -and $runKey.GetValueNames() -contains 'Markbridge'
$wvKeys = @('HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
$runtime = @($wvKeys | ForEach-Object { (Get-ItemProperty -LiteralPath $_ -Name pv -ErrorAction SilentlyContinue).pv } | Where-Object { $_ -and $_ -ne '0.0.0.0' })
$registration = $null
$installKey = $keys[0]
if (Test-Path -LiteralPath $installKey) {
  $value = Get-ItemProperty -LiteralPath $installKey
  $registration = @{ installLocation=$value.InstallLocation; uninstallString=$value.UninstallString; displayVersion=$value.DisplayVersion; mainBinaryName=$value.MainBinaryName }
}
$result = @{ keys=$presentKeys; shortcutCount=$presentShortcuts.Count; runPresent=[bool]$runPresent; webview2Versions=$runtime; registration=$registration }
if ($Action -eq 'preflight') {
  if ($presentKeys.Count -gt 0 -or $presentShortcuts.Count -gt 0 -or $runPresent) { throw 'EXISTING_MARKBRIDGE_REGISTRATION_OR_SHORTCUT_BLOCKS_INSTALL' }
  if ($runtime.Count -eq 0) { throw 'WEBVIEW2_RUNTIME_ABSENT_NO_BOOTSTRAPPER_AUTHORIZED' }
}
$result | ConvertTo-Json -Compress -Depth 4
