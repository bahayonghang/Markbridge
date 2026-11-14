# Execute only two pure function definitions extracted from the actual helper; no native actions.
$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'current-native-system.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'HELPER_PARSE_FAILED' }
foreach ($name in @('Get-Task13PreviewComponent','Test-Task13WebviewDirectory')) {
  $definition=$ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },$true)
  if (-not $definition) { throw 'PURE_HELPER_FUNCTION_NOT_FOUND' }
  . ([ScriptBlock]::Create($definition.Extent.Text))
}
$profileA='p:' + ('a' * 64)
$profileB='p:' + ('b' * 64)
$vectors=@(
  @{ id='p:abc'; component='v1-e48d50a81ee3450477402be70fefdfd051e40cf1a20d02b8c69d0d3cfa5c3f49' },
  @{ id='a.b'; component='v1-86fc5c612bf5e4f5ade274dd208bd3c94185b835b3ce725f362869c5a063ab82' },
  @{ id=$profileA; component='v1-1e8b1719ad8820ff052aad43fffc0161b789f8e67db43ed3d05c94dd40b345f7' },
  @{ id=('m' * 128); component='v1-98283d95e15ef246edd3fbbfa935e436ede7b9b7f84342ba86e081d716251f50' }
)
foreach ($vector in $vectors) {
  $actual=Get-Task13PreviewComponent $vector.id
  if ($actual -cne $vector.component -or $actual.Length -ne 67) { throw 'CROSS_LANGUAGE_HASH_CONTRACT_MISMATCH' }
}
foreach ($invalid in @('','..',':a','_a','-a','.a','a/b','a\b',('a' * 129),"a`n","a`r`n")) {
  $rejected=$false
  try { [void](Get-Task13PreviewComponent $invalid) } catch { $rejected=$_.Exception.Message -eq 'WEBVIEW_PREVIEW_PROFILE_ID_INVALID' }
  if (-not $rejected) { throw 'INVALID_PROFILE_ACCEPTED' }
}
$root=Join-Path ([IO.Path]::GetTempPath()) 'markbridge-task13-native-contract-only'
$base=Join-Path (Join-Path $root 'app-data\preview-sessions') (Get-Task13PreviewComponent $profileA)
$other=Join-Path (Join-Path $root 'app-data\preview-sessions') (Get-Task13PreviewComponent $profileB)
$legacy=Join-Path (Join-Path $root 'app-data\preview-sessions') (-join ([Text.Encoding]::UTF8.GetBytes($profileA) | ForEach-Object { $_.ToString('x2') }))
foreach ($allowed in @($base,(Join-Path $base 'EBWebView'))) {
  if (-not (Test-Task13WebviewDirectory $allowed $base)) { throw 'EXACT_PROFILE_DIRECTORY_REJECTED' }
}
foreach ($denied in @($other,(Join-Path $other 'EBWebView'),$legacy,(Join-Path $legacy 'EBWebView'),(Join-Path $base 'arbitrary-child'),(Join-Path $root 'outside-profile'))) {
  if (Test-Task13WebviewDirectory $denied $base) { throw 'WRONG_OR_LEGACY_PROFILE_DIRECTORY_ACCEPTED' }
}
if (Test-Task13WebviewDirectory $base $null) { throw 'EMPTY_EXPECTED_DIRECTORY_ACCEPTED' }
'Preview path contract PASS: hash vectors, invalid IDs, exact base/runtime suffix, wrong-profile and legacy rejection; no native operations or fixture mutations.'
