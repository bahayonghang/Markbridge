$ErrorActionPreference = 'Continue'
$root = 'D:\Documents\Code\Tauri\Markbridge'
Set-Location -LiteralPath $root
$evidence = Join-Path $root '.trellis\tasks\10-10-mb-13-windows-acceptance\evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$summary = Join-Path $evidence 'command-log.txt'
$dailyBookmarks = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Bookmarks'
$dailyRoaming = Join-Path $env:APPDATA 'com.markbridge.desktop'
$dailyLocal = Join-Path $env:LOCALAPPDATA 'com.markbridge.desktop'
$dailyInstall = Join-Path $env:LOCALAPPDATA 'Markbridge'

function Write-Line([string]$text) {
  Add-Content -LiteralPath $summary -Value $text
  Write-Output $text
}

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

function Invoke-Gate([string]$id, [string]$command) {
  $stdout = Join-Path $evidence "$id.stdout.log"
  $stderr = Join-Path $evidence "$id.stderr.log"
  $start = [DateTimeOffset]::Now
  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $command) -WorkingDirectory $root -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $end = [DateTimeOffset]::Now
  $line = "$id`t$($process.ExitCode)`t$command`t$($start.ToString('o'))`t$($end.ToString('o'))"
  Write-Line $line
  return $process.ExitCode
}

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Mb13Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
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

function Stop-OwnedProcess([System.Diagnostics.Process]$process) {
  if ($process.HasExited) { return }
  $tree = Get-ProcessTree ([uint32]$process.Id)
  foreach ($pidValue in $tree) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
  [void]$process.WaitForExit(10000)
}

function Invoke-IsolatedCycle([string]$name, [string]$exe, [string]$appData, [string]$roaming, [string]$local) {
  $stdout = Join-Path $evidence "$name.stdout.log"
  $stderr = Join-Path $evidence "$name.stderr.log"
  $process = Start-Process -FilePath $exe -PassThru -WorkingDirectory $appData -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment @{
    MARKBRIDGE_APP_DATA = $appData
    MARKBRIDGE_CREDENTIAL_NAMESPACE = 'Markbridge.Task05.mb13-accept'
    APPDATA = $roaming
    LOCALAPPDATA = $local
  }
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
  if ($found -ne [IntPtr]::Zero) {
    $posted = [Mb13Win]::PostMessage($found, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  $exited = $process.WaitForExit(20000)
  if (-not $exited) { Stop-OwnedProcess $process }
  $code = $null
  if ($process.HasExited) { $code = $process.ExitCode }
  Write-Line "$name`tcode=$code`tpid=$($process.Id)`twindow=$($found -ne [IntPtr]::Zero)`tposted=$posted`texe=$exe"
  return $code
}

Set-Content -LiteralPath $summary -Value "mb13 gates $($([DateTimeOffset]::Now).ToString('o'))"
Write-Line "HEAD $(& git rev-parse HEAD)"
Write-Line "OS $([System.Environment]::OSVersion.VersionString)"
try {
  $win = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  Write-Line "Windows $($win.ProductName) $($win.DisplayVersion) build $($win.CurrentBuild)"
} catch { Write-Line 'Windows version NOT_RUN' }
try {
  $webview = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  Write-Line "WebView2 $($webview.pv)"
} catch { Write-Line 'WebView2 NOT_RUN' }
$chrome = Join-Path $env:PROGRAMFILES 'Google\Chrome\Application\chrome.exe'
if (Test-Path -LiteralPath $chrome) {
  Write-Line "Chrome file version $([Diagnostics.FileVersionInfo]::GetVersionInfo($chrome).ProductVersion)"
} else { Write-Line 'Chrome exe ABSENT' }
Write-Line "node $(node -v)"
Write-Line "pnpm $(pnpm -v)"
Write-Line "cargo $(cargo --version)"
Write-Line "rustc $(rustc --version)"
Write-Line "BEFORE bookmarks $(Get-Snapshot $dailyBookmarks)"
Write-Line "BEFORE roaming $(Get-Snapshot $dailyRoaming)"
Write-Line "BEFORE local-id $(Get-Snapshot $dailyLocal)"
Write-Line "BEFORE local-install $(Get-Snapshot $dailyInstall)"
Write-Line "BEFORE pairing $(Get-CredentialCount 'Markbridge.Pairing')"
Write-Line "BEFORE model $(Get-CredentialCount 'Markbridge.Model')"

$results = [ordered]@{}
$results['01-install'] = Invoke-Gate '01-install' 'pnpm install --frozen-lockfile'
$results['02-lint'] = Invoke-Gate '02-lint' 'pnpm lint'
$results['03-typecheck'] = Invoke-Gate '03-typecheck' 'pnpm typecheck'
$results['04-test'] = Invoke-Gate '04-test' 'pnpm test'
$results['05-protocol'] = Invoke-Gate '05-protocol' 'pnpm protocol:check'
$results['06-e2e'] = Invoke-Gate '06-e2e' 'pnpm test:e2e'
$results['07-build'] = Invoke-Gate '07-build' 'pnpm build'
$results['08-fmt'] = Invoke-Gate '08-fmt' 'cargo fmt --all -- --check'
$results['09-clippy'] = Invoke-Gate '09-clippy' 'cargo clippy --workspace --all-targets -- -D warnings'
$results['10-cargo-test'] = Invoke-Gate '10-cargo-test' 'cargo test --workspace --locked'
$results['11-build-native'] = Invoke-Gate '11-build-native' 'pnpm build:native'
$results['12-build-package'] = Invoke-Gate '12-build-package' 'pnpm build:package'
Write-Line "13-tauri-build-unmapped`tNOT_RUN`tpnpm --filter @markbridge/desktop tauri build`tskipped; bare tauri build does not remap paths"

if ($results['12-build-package'] -ne 0) {
  Write-Line 'ISOLATED_INSTALL NOT_RUN package command failed'
} else {
  $installer = Get-ChildItem -LiteralPath (Join-Path $root 'target\release\bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $installer) {
    Write-Line 'ISOLATED_INSTALL NOT_RUN installer file absent'
  } else {
    $dest = Join-Path $env:TEMP 'mb13-install'
    $appData = Join-Path $env:TEMP 'mb13-data'
    $roaming = Join-Path $env:TEMP 'mb13-roaming'
    $local = Join-Path $env:TEMP 'mb13-local'
    foreach ($dir in @($dest, $appData, $roaming, $local)) {
      if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $existing = @(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue)
    Write-Line "BEFORE desktop processes $($existing.Count)"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $installer.FullName
    $psi.Arguments = "/S /D=$dest"
    $psi.UseShellExecute = $false
    $psi.WorkingDirectory = $env:TEMP
    $install = [Diagnostics.Process]::Start($psi)
    $installFinished = $install.WaitForExit(120000)
    if (-not $installFinished) {
      Stop-OwnedProcess $install
      Write-Line "14-install`tNOT_RUN`ttimed out without elevation`t$($installer.FullName)"
      $install = $null
    } else {
      Write-Line "14-install`t$($install.ExitCode)`t$($installer.FullName)`t/S /D=$dest"
    }
    $installed = Get-ChildItem -LiteralPath $dest -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'Uninstall*' } | Select-Object -First 1
    if ($null -eq $install -or $install.ExitCode -ne 0 -or $null -eq $installed) {
      Write-Line 'ISOLATED_LAUNCH NOT_RUN installer did not leave an executable in the isolated directory'
    } else {
      $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($installed.FullName)
      Write-Line "INSTALLED path=$($installed.FullName) ProductVersion=$($info.ProductVersion) FileVersion=$($info.FileVersion)"
      [void](Invoke-IsolatedCycle '15-start-exit' $installed.FullName $appData $roaming $local)
      [void](Invoke-IsolatedCycle '16-restart-exit' $installed.FullName $appData $roaming $local)
      Write-Line "APP_DATA $(Get-Snapshot $appData)"
    }
    $uninstaller = Get-ChildItem -LiteralPath $dest -Filter 'Uninstall*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $uninstaller) {
      Write-Line '17-uninstall NOT_RUN uninstaller absent'
    } elseif (-not $uninstaller.FullName.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase)) {
      Write-Line "17-uninstall NOT_RUN path outside isolated directory $($uninstaller.FullName)"
    } else {
      $unpsi = New-Object System.Diagnostics.ProcessStartInfo
      $unpsi.FileName = $uninstaller.FullName
      $unpsi.Arguments = '/S'
      $unpsi.UseShellExecute = $false
      $unpsi.WorkingDirectory = $dest
      $uninstall = [Diagnostics.Process]::Start($unpsi)
      $uninstallFinished = $uninstall.WaitForExit(120000)
      if (-not $uninstallFinished) {
        Stop-OwnedProcess $uninstall
        Write-Line "17-uninstall`tNOT_RUN`ttimed out`t$($uninstaller.FullName)"
      } else {
        Write-Line "17-uninstall`t$($uninstall.ExitCode)`t$($uninstaller.FullName)"
      }
      Write-Line "AFTER install dir $(Get-Snapshot $dest)"
    }
  }
}

Write-Line "AFTER bookmarks $(Get-Snapshot $dailyBookmarks)"
Write-Line "AFTER roaming $(Get-Snapshot $dailyRoaming)"
Write-Line "AFTER local-id $(Get-Snapshot $dailyLocal)"
Write-Line "AFTER local-install $(Get-Snapshot $dailyInstall)"
Write-Line "AFTER pairing $(Get-CredentialCount 'Markbridge.Pairing')"
Write-Line "AFTER model $(Get-CredentialCount 'Markbridge.Model')"
$left = @(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue)
Write-Line "AFTER desktop processes $($left.Count)"
Write-Line 'GATES_DONE'
