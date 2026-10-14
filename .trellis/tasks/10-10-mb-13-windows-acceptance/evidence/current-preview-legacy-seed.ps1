param([Parameter(Mandatory=$true)][string]$IsolationRoot, [Parameter(Mandatory=$true)][string]$ProfileId,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$AppProcessId)
$ErrorActionPreference = 'Stop'

# Test-only move of a closed, owned preview directory into its legacy name.
function Assert-PlainAncestors([string]$Path) {
  $cursor = [IO.Path]::GetFullPath($Path)
  while ($cursor) {
    $item = Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'SEED_PATH_REDIRECTED' }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
}
function Assert-PlainTree([string]$Path) {
  foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SEED_TREE_REDIRECTED' }
    if ($item.PSIsContainer) { Assert-PlainTree $item.FullName }
  }
}
function Extended([string]$Path) {
  if ($Path.StartsWith('\\?\')) { return $Path }
  if ($Path.StartsWith('\\')) { return '\\?\UNC\' + $Path.Substring(2) }
  return '\\?\' + $Path
}

$root = [IO.Path]::GetFullPath($IsolationRoot)
$temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($root) -cne $temporary -or [IO.Path]::GetFileName($root) -notmatch '^markbridge-task13-native-[A-Za-z0-9-]+$') { throw 'SEED_ROOT_NOT_DISPOSABLE' }
if ($ProfileId -cne ('p:' + ('a' * 64)) -and $ProfileId -cne 'task13-preview-A') { throw 'SEED_ID_NOT_SYNTHETIC_A' }
$app = Get-CimInstance Win32_Process -Filter "ProcessId = $AppProcessId"
if (-not $app -or -not [string]::Equals($app.ExecutablePath, (Join-Path $root 'install\markbridge-desktop.exe'), [StringComparison]::OrdinalIgnoreCase)) { throw 'SEED_APP_NOT_OWNED' }
$sessionRoot = Join-Path $root 'app-data\preview-sessions'
Assert-PlainAncestors $sessionRoot
$utf8 = [Text.Encoding]::UTF8
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash($utf8.GetBytes("markbridge:preview-session:v1`0" + $ProfileId)) } finally { $sha.Dispose() }
$hashName = 'v1-' + [BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()
$legacyName = [BitConverter]::ToString($utf8.GetBytes($ProfileId)).Replace('-', '').ToLowerInvariant()
$source = Join-Path $sessionRoot $hashName
$target = Join-Path $sessionRoot $legacyName
if ([IO.Path]::GetDirectoryName($source) -cne $sessionRoot -or [IO.Path]::GetDirectoryName($target) -cne $sessionRoot) { throw 'SEED_PATH_OUTSIDE_ROOT' }
Assert-PlainAncestors $source
Assert-PlainTree $source
if (Test-Path -LiteralPath $target) { throw 'SEED_TARGET_EXISTS' }
# Every WebView belonging to this exact UDF must have exited before the seed move.
foreach ($process in Get-CimInstance Win32_Process -Filter "ParentProcessId = $AppProcessId AND Name = 'msedgewebview2.exe'") {
  $command = ([string]$process.CommandLine).Replace('/', '\')
  if ($command.IndexOf($source, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'SEED_PREVIEW_PROCESS_REMAINED' }
}
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class PreviewLegacySeed {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileW(string source, string target);
}
'@
if (-not [PreviewLegacySeed]::MoveFileW((Extended $source), (Extended $target))) { throw 'SEED_NO_REPLACE_MOVE_FAILED' }
@{ seeded=$true; sourceAbsent=(-not (Test-Path -LiteralPath $source)); legacyPresent=(Test-Path -LiteralPath $target -PathType Container) } | ConvertTo-Json -Compress
