import validateReport from './generated/maintenance-report.validator.js';
import type { MaintenanceReport } from './generated/maintenance-report';
import validateSearch from './generated/text-search.validator.js';
import type { TextSearchPage } from './generated/text-search';

export type { CleanupView, DuplicateGroup, LibraryMember, LinkRow, LinkVerdict, MaintenanceReport, MetadataHandling, NoteConflict } from './generated/maintenance-report';
export type { TextHit, TextSearchPage } from './generated/text-search';

export function parseMaintenanceReport(value: unknown): MaintenanceReport {
  if (!validateReport(value)) throw new Error('INVALID_MAINTENANCE_REPORT');
  return value;
}

export function parseTextSearch(value: unknown): TextSearchPage {
  if (!validateSearch(value)) throw new Error('INVALID_TEXT_SEARCH');
  return value;
}
