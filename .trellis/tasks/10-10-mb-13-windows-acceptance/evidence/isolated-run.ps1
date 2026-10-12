$ErrorActionPreference = 'Continue'
$installer = 'D:\Documents\Code\Tauri\Markbridge\target\release\bundle\nsis\Markbridge_0.1.0_x64-setup.exe'
$dest = Join-Path $env:TEMP 'mb13-install'
$appData = Join-Path $env:TEMP 'mb13-data'
$roaming = Join-Path $env:TEMP 'mb13-roaming'
$local = Join-Path $env:TEMP 'mb13-local'
$dailyBookmarks = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Bookmarks'
$dailyRoaming = Join-Path $env:APPDATA 'com.markbridge.desktop'
$dailyLocal = Join-Path $env:LOCALAPPDATA 'com.markbridge.desktop'
$dailyInstall = Join-Path $env:LOCALAPPDATA 'Markbridge'

function Get-Snapshot([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return "ABSENT $path" }
  $item = Get-Item -LiteralPath $path
  if (-not $item.PSIsContainer) {
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    return "FILE len=$($item.Length) mtime=$($item.LastWriteTimeUtc.ToString('o')) sha256=$hash $path"
  }
  $files = @(Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue)
  $newest = $null
  if ($files.Count -gt 0) { $newest = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString('o') }
  return "DIR files=$($files.Count) newest=$newest $path"
}

function Get-CredentialCount([string]$name) {
  $raw = cmdkey /list 2>&1 | Out-String
  return ([regex]::Matches($raw, [regex]::Escape($name))).Count
}

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Mb13Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr Found;
  public static uint Target;
  public static bool EnumTop(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner;
    GetWindowThreadProcessId(hWnd, out owner);
    if (owner != Target) return true;
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    if (buffer.ToString().IndexOf("Markbridge", StringComparison.Ordinal) >= 0) Found = hWnd;
    return true;
  }
  public static void Enumerate() {
    Found = IntPtr.Zero;
    EnumWindows(EnumTop, IntPtr.Zero);
  }
}
"@

function Get-ProcessTree([uint32]$rootPid) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
  $queue = New-Object 'System.Collections.Generic.Queue[uint32]'
  $queue.Enqueue($rootPid)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $set.Add($current)) { continue }
    foreach ($row in $all) {
      if ([uint32]$row.ParentProcessId -eq $current) { $queue.Enqueue([uint32]$row.ProcessId) }
    }
  }
  return @($set)
}

function Invoke-Cycle([string]$name, [string]$exe) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.UseShellExecute = $false
  $psi.WorkingDirectory = $appData
  $psi.EnvironmentVariables['MARKBRIDGE_APP_DATA'] = $appData
  $psi.EnvironmentVariables['MARKBRIDGE_CREDENTIAL_NAMESPACE'] = 'Markbridge.Task05.mb13-accept'
  $psi.EnvironmentVariables['APPDATA'] = $roaming
  $psi.EnvironmentVariables['LOCALAPPDATA'] = $local
  $process = [Diagnostics.Process]::Start($psi)
  $found = [IntPtr]::Zero
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
    foreach ($pidValue in (Get-ProcessTree ([uint32]$process.Id))) {
      [Mb13Win]::Target = [uint32]$pidValue
      [Mb13Win]::Enumerate()
      if ([Mb13Win]::Found -ne [IntPtr]::Zero) { $found = [Mb13Win]::Found; break }
    }
    if ($found -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 500
  }
  $posted = $false
  if ($found -ne [IntPtr]::Zero) { $posted = [Mb13Win]::PostMessage($found, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  $exited = $process.WaitForExit(20000)
  if (-not $exited) {
    foreach ($pidValue in (Get-ProcessTree ([uint32]$process.Id))) { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }
    [void]$process.WaitForExit(10000)
  }
  $code = $null
  if ($process.HasExited) { $code = $process.ExitCode }
  Write-Output "$name code=$code pid=$($process.Id) window=$($found -ne [IntPtr]::Zero) posted=$posted exe=$exe"
}

Write-Output "BEFORE bookmarks $(Get-Snapshot $dailyBookmarks)"
Write-Output "BEFORE roaming $(Get-Snapshot $dailyRoaming)"
Write-Output "BEFORE local-id $(Get-Snapshot $dailyLocal)"
Write-Output "BEFORE local-install $(Get-Snapshot $dailyInstall)"
Write-Output "BEFORE pairing $(Get-CredentialCount 'Markbridge.Pairing')"
Write-Output "BEFORE model $(Get-CredentialCount 'Markbridge.Model')"
Write-Output "BEFORE desktop processes $((@(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue)).Count)"

foreach ($dir in @($appData, $roaming, $local)) {
  if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $installer
$psi.Arguments = "/S /D=$dest"
$psi.UseShellExecute = $false
$psi.WorkingDirectory = $env:TEMP
$install = [Diagnostics.Process]::Start($psi)
if (-not $install.WaitForExit(120000)) {
  Stop-Process -Id $install.Id -Force -ErrorAction SilentlyContinue
  Write-Output 'INSTALL NOT_RUN timeout'
  exit 1
}
Write-Output "INSTALL code=$($install.ExitCode) dest=$dest"
Write-Output "AFTER install dest $(Get-Snapshot $dest)"
Write-Output "AFTER install default $(Get-Snapshot $dailyInstall)"

$installed = Get-ChildItem -LiteralPath $dest -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'Uninstall*' } | Select-Object -First 1
if ($install.ExitCode -ne 0 -or $null -eq $installed) {
  Write-Output 'LAUNCH NOT_RUN'
} else {
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($installed.FullName)
  $hash = (Get-FileHash -LiteralPath $installed.FullName -Algorithm SHA256).Hash
  Write-Output "INSTALLED path=$($installed.FullName) bytes=$((Get-Item -LiteralPath $installed.FullName).Length) sha256=$hash ProductVersion=$($info.ProductVersion) FileVersion=$($info.FileVersion)"
  Invoke-Cycle 'START_EXIT' $installed.FullName
  Invoke-Cycle 'RESTART_EXIT' $installed.FullName
  Write-Output "APP_DATA $(Get-Snapshot $appData)"
  $sqlite = Join-Path $appData 'markbridge.sqlite'
  if (Test-Path -LiteralPath $sqlite) {
    $file = Get-Item -LiteralPath $sqlite
    $sqlHash = (Get-FileHash -LiteralPath $sqlite -Algorithm SHA256).Hash
    Write-Output "SQLITE len=$($file.Length) sha256=$sqlHash path=$sqlite"
  } else {
    Write-Output 'SQLITE ABSENT'
  }
}

$uninstaller = Get-ChildItem -LiteralPath $dest -Filter 'Uninstall*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $uninstaller) {
  Write-Output 'UNINSTALL NOT_RUN uninstaller absent'
} elseif (-not $uninstaller.FullName.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase)) {
  Write-Output "UNINSTALL NOT_RUN outside $dest"
} else {
  $unpsi = New-Object System.Diagnostics.ProcessStartInfo
  $unpsi.FileName = $uninstaller.FullName
  $unpsi.Arguments = '/S'
  $unpsi.UseShellExecute = $false
  $unpsi.WorkingDirectory = $dest
  $uninstall = [Diagnostics.Process]::Start($unpsi)
  if (-not $uninstall.WaitForExit(120000)) {
    Stop-Process -Id $uninstall.Id -Force -ErrorAction SilentlyContinue
    Write-Output 'UNINSTALL NOT_RUN timeout'
  } else {
    Write-Output "UNINSTALL code=$($uninstall.ExitCode) path=$($uninstaller.FullName)"
  }
}

Write-Output "AFTER bookmarks $(Get-Snapshot $dailyBookmarks)"
Write-Output "AFTER roaming $(Get-Snapshot $dailyRoaming)"
Write-Output "AFTER local-id $(Get-Snapshot $dailyLocal)"
Write-Output "AFTER local-install $(Get-Snapshot $dailyInstall)"
Write-Output "AFTER install dest $(Get-Snapshot $dest)"
Write-Output "AFTER app data $(Get-Snapshot $appData)"
Write-Output "AFTER pairing $(Get-CredentialCount 'Markbridge.Pairing')"
Write-Output "AFTER model $(Get-CredentialCount 'Markbridge.Model')"
Write-Output "AFTER desktop processes $((@(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue)).Count)"
