param([Parameter(Mandatory=$true)][string]$TargetPath,[Parameter(Mandatory=$true)][string]$IsolationRoot)
$ErrorActionPreference='Stop'
$root=[System.IO.Path]::GetFullPath($IsolationRoot).TrimEnd('\')
$path=[System.IO.Path]::GetFullPath($TargetPath)
$temp=[System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
if ([System.IO.Path]::GetDirectoryName($root) -ne $temp -or -not [System.IO.Path]::GetFileName($root).StartsWith('markbridge-r08-native-')) { throw 'NON_ISOLATED_ROOT' }
if (-not $path.StartsWith($root+'\',[System.StringComparison]::OrdinalIgnoreCase)) { throw 'OUTPUT_OUTSIDE_FIXTURE' }
$file=[System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
try {
  [Console]::WriteLine('LOCKED')
  [Console]::Out.Flush()
  [void][Console]::ReadLine()
} finally { $file.Dispose() }
[Console]::WriteLine('RELEASED')
