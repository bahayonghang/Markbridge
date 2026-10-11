param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$AppData,
  [int]$Port = 9333
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $AppData | Out-Null
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $Exe
$psi.WorkingDirectory = $AppData
$psi.UseShellExecute = $false
$psi.Environment['MARKBRIDGE_APP_DATA'] = $AppData
$psi.Environment['MARKBRIDGE_CREDENTIAL_NAMESPACE'] = 'Markbridge.Task05.mb01-native'
$psi.Environment['WEBVIEW2_USER_DATA_FOLDER'] = (Join-Path $AppData 'webview2')
$psi.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$Port"
$process = [System.Diagnostics.Process]::Start($psi)
Write-Output "PID=$($process.Id)"
$process.Id | Set-Content -Encoding ascii (Join-Path $AppData 'pid.txt')
