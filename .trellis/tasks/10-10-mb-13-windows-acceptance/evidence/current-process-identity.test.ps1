# Extract only the actual pure identity functions; no process query or native operation.
param([string]$TransportIdentities)
$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'current-native-system.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'HELPER_PARSE_FAILED' }
foreach ($name in @('Assert-Task13ProcessIdentity','Get-Task13CreationUtcTicks','ConvertFrom-Task13KnownIdentities','Get-Task13KnownProcessState')) {
  $definition=$ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },$true)
  if (-not $definition) { throw 'PURE_IDENTITY_FUNCTION_NOT_FOUND' }
  . ([ScriptBlock]::Create($definition.Extent.Text))
}
function Assert-Rejected([ScriptBlock]$Action, [string]$Code) {
  $rejected=$false
  try { & $Action | Out-Null } catch { $rejected=$_.Exception.Message -ceq $Code }
  if (-not $rejected) { throw 'IDENTITY_INVALID_CASE_NOT_REJECTED' }
}
$ticks='639275172461613410'
$utc=[datetime]::new([long]$ticks, [DateTimeKind]::Utc)
$known=ConvertFrom-Task13KnownIdentities ('[{"pid":1234,"creationUtcTicks":"'+$ticks+'"}]')
if ($known.Count -ne 1 -or $known[0].creationUtcTicks -cne $ticks) { throw 'IDENTITY_TICK_PRECISION_LOST' }
$identity=$known[0]
$same=[pscustomobject]@{ ProcessId=1234; CreationDate=$utc; Name='msedgewebview2.exe'; CommandLine='PRIVATE_REPLACEMENT_COMMAND'; ExecutablePath='PRIVATE_REPLACEMENT_PATH' }
$present=Get-Task13KnownProcessState $identity $same
if ($present.state -cne 'present' -or $present.observedCreationUtcTicks -cne $ticks) { throw 'ORIGINAL_IDENTITY_NOT_PRESENT' }
if ((Get-Task13CreationUtcTicks ([pscustomobject]@{ CreationDate=$utc.ToLocalTime() })) -cne $ticks) { throw 'UTC_LOCAL_IDENTITY_MISMATCH' }
if ((Get-Task13KnownProcessState $identity $null).state -cne 'absent') { throw 'ABSENT_PROCESS_NOT_ABSENT' }
foreach ($replacementName in @('cmd.exe','msedgewebview2.exe')) {
  $replacement=[pscustomobject]@{ ProcessId=1234; CreationDate=$utc.AddTicks(10); Name=$replacementName; CommandLine='PRIVATE_REPLACEMENT_COMMAND'; ExecutablePath='PRIVATE_REPLACEMENT_PATH' }
  $state=Get-Task13KnownProcessState $identity $replacement
  if ($state.state -cne 'pid_reused') { throw 'REUSED_PID_NOT_RECOGNIZED' }
  $wire=$state | ConvertTo-Json -Compress
  if ($wire.Contains($replacementName) -or $wire.Contains('PRIVATE_REPLACEMENT')) { throw 'REPLACEMENT_PROCESS_DETAILS_EXPOSED' }
}
$nextTicks=$utc.AddTicks(10).Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
$history=ConvertFrom-Task13KnownIdentities ('[{"pid":1234,"creationUtcTicks":"'+$ticks+'"},{"pid":1234,"creationUtcTicks":"'+$nextTicks+'"}]')
if ($history.Count -ne 2) { throw 'REUSED_OWNED_PID_OVERWROTE_HISTORY' }
$states=@($history | ForEach-Object { Get-Task13KnownProcessState $_ ([pscustomobject]@{ ProcessId=1234; CreationDate=$utc.AddTicks(10) }) })
if (@($states | Where-Object { $_.state -eq 'present' }).Count -ne 1 -or @($states | Where-Object { $_.state -eq 'pid_reused' }).Count -ne 1) { throw 'REUSED_OWNED_IDENTITY_CLASSIFICATION_WRONG' }
foreach ($creation in @($null,'unreadable',[datetime]::MinValue,[datetime]::SpecifyKind($utc,[DateTimeKind]::Unspecified))) {
  Assert-Rejected { Get-Task13KnownProcessState $identity ([pscustomobject]@{ ProcessId=1234; CreationDate=$creation }) } 'WEBVIEW_PROCESS_CREATION_UNAVAILABLE'
}
Assert-Rejected { Get-Task13KnownProcessState $identity ([pscustomobject]@{ ProcessId=9999; CreationDate=$utc }) } 'WEBVIEW_PROCESS_QUERY_IDENTITY_MISMATCH'
foreach ($json in @('', '[]', '{}', 'not-json', '[null]', ('[{"pid":0,"creationUtcTicks":"'+$ticks+'"}]'),
    ('[{"pid":4294967296,"creationUtcTicks":"'+$ticks+'"}]'), ('[{"pid":1.5,"creationUtcTicks":"'+$ticks+'"}]'),
    ('[{"pid":"1234","creationUtcTicks":"'+$ticks+'"}]'), '[{"pid":1234,"creationUtcTicks":639275172461613410}]',
    ('[{"pid":1234,"creationUtcTicks":"0'+$ticks+'"}]'), '[{"pid":1234,"creationUtcTicks":"3155378976000000000"}]',
    ('[{"pid":1234,"creationUtcTicks":"'+$ticks+'","extra":"private"}]'))) {
  $rejected=$false
  try { ConvertFrom-Task13KnownIdentities $json | Out-Null } catch { $rejected=$_.Exception.Message -in @('WEBVIEW_KNOWN_IDENTITY_LIST_INVALID','WEBVIEW_PROCESS_IDENTITY_INVALID') }
  if (-not $rejected) { throw 'MALFORMED_IDENTITY_LIST_ACCEPTED' }
}
Assert-Rejected { ConvertFrom-Task13KnownIdentities ('[{"pid":1234,"creationUtcTicks":"'+$ticks+'"},{"pid":1234,"creationUtcTicks":"'+$ticks+'"}]') } 'WEBVIEW_KNOWN_IDENTITY_DUPLICATED'
$maximum='[' + ((1..32 | ForEach-Object { '{"pid":'+$_+',"creationUtcTicks":"'+$ticks+'"}' }) -join ',') + ']'
if ((ConvertFrom-Task13KnownIdentities $maximum).Count -ne 32) { throw 'VALID_BOUNDED_IDENTITIES_REJECTED' }
$tooMany='[' + ((1..33 | ForEach-Object { '{"pid":'+$_+',"creationUtcTicks":"'+$ticks+'"}' }) -join ',') + ']'
Assert-Rejected { ConvertFrom-Task13KnownIdentities $tooMany } 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID'
Assert-Rejected { ConvertFrom-Task13KnownIdentities ((' ' * 4096) + $maximum) } 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID'
foreach ($whitespace in @("`n","`r","`r`n",' ',"`t")) {
  foreach ($noncanonical in @(($ticks+$whitespace),($whitespace+$ticks))) {
    $invalid=@([pscustomobject]@{ pid=1234; creationUtcTicks=$noncanonical })
    $invalidWire=ConvertTo-Json -InputObject $invalid -Compress
    Assert-Rejected { ConvertFrom-Task13KnownIdentities $invalidWire } 'WEBVIEW_PROCESS_IDENTITY_INVALID'
  }
}
if ($TransportIdentities) {
  $transport=ConvertFrom-Task13KnownIdentities $TransportIdentities
  if ($transport.Count -ne 2 -or $transport[0].pid -ne 1234 -or $transport[0].creationUtcTicks -cne $ticks -or
      $transport[1].pid -ne [uint32]::MaxValue -or $transport[1].creationUtcTicks -cne '3155378975999999999') { throw 'IDENTITY_ARGUMENT_TRANSPORT_CHANGED_VALUES' }
  'IDENTITY_ARGUMENT_TRANSPORT_PASS'
}
'Process identity contract PASS: exact UTC ticks, local conversion, present/absent/reused identity, same-exe reuse, history preservation, unknown creation and bounded schema rejection; no native operations.'
