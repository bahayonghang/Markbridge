param([Parameter(Mandatory=$true)][string]$Since)
$ErrorActionPreference = 'Stop'
$start = [DateTimeOffset]::Parse($Since, [Globalization.CultureInfo]::InvariantCulture).LocalDateTime
try {
  $events = @(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-Power';Id=42,107,506,507;StartTime=$start} -ErrorAction Stop)
} catch {
  if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw }
  $events = @()
}
# Only IDs and timing from this run, never event bodies or unrelated system history.
$values = @($events | Sort-Object RecordId | ForEach-Object { @{id=$_.Id;recordId=$_.RecordId;at=$_.TimeCreated.ToUniversalTime().ToString('o')} })
ConvertTo-Json -InputObject $values -Compress
