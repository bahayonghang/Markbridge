import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  InstalledFontCatalog,
  SemanticSettings, SemanticConfig, SemanticScope, SemanticScopeReview, SemanticStatus,
  SemanticQuery, SemanticQueryResult, SemanticModelCheck, DiagnosticSaveResult,
  OperationDetail, UndoPreview, ExportSaveResult, ExportSource,
  BatchEditPreview, BatchEditStatus, ApplyResult, BridgeState, ChromeProfileList, ContentPreview, EditDocument, EditPreview,
  LibraryCount, LibraryDetail, LibraryNodes, LibraryPage, LibrarySearch, LibraryQuery, LibraryQueryPage,
  AiApplyResult, AiConnection, AiSettings, AiSuggestion, MaintenanceReport, MirrorTree, OperationList,
  OrganizationFolder, OrganizationPlan, StartupState, TagCatalog, TextSearchPage, TitleEncodingPreview, WebPreviewState,
} from '@markbridge/protocol';

const loadStartup = () => import('@markbridge/protocol/startup');
const loadBridge = () => import('@markbridge/protocol/bridge');
const loadHistory = () => import('@markbridge/protocol/history');
const loadDiagnostics = () => import('@markbridge/protocol/diagnostics');
const loadBatch = () => import('@markbridge/protocol/batch-edit');
const loadAi = () => import('@markbridge/protocol/ai');
const loadOrganization = () => import('@markbridge/protocol/organization');
const loadMaintenance = () => import('@markbridge/protocol/maintenance');
const loadSemantic = () => import('@markbridge/protocol/semantic');
const loadUiFonts = () => import('@markbridge/protocol/ui-fonts');

export async function listInstalledFonts(): Promise<InstalledFontCatalog> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseInstalledFontCatalog } = await loadUiFonts();
  return parseInstalledFontCatalog(await invoke<unknown>('list_installed_fonts'));
}

export async function semanticSettings(): Promise<SemanticSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticSettings } = await loadSemantic();
  return parseSemanticSettings(await invoke<unknown>('semantic_settings'));
}
export async function saveSemanticConfig(config: SemanticConfig): Promise<SemanticSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticSettings, parseSemanticConfig } = await loadSemantic();
  return parseSemanticSettings(await invoke<unknown>('save_semantic_config', { config: parseSemanticConfig(config) }));
}
export async function checkSemanticModel(endpoint: string, model: string): Promise<SemanticModelCheck> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticModelCheck } = await loadSemantic();
  return parseSemanticModelCheck(await invoke<unknown>('semantic_model_check', { endpoint, model }));
}
export async function reviewSemanticScope(scope: SemanticScope): Promise<SemanticScopeReview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticScopeReview, parseSemanticScope } = await loadSemantic();
  return parseSemanticScopeReview(await invoke<unknown>('semantic_review_scope', { scope: parseSemanticScope(scope) }));
}
export async function startSemanticIndex(reviewId: string): Promise<SemanticStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticStatus } = await loadSemantic();
  return parseSemanticStatus(await invoke<unknown>('semantic_start_index', { reviewId }));
}
export async function semanticStatus(profileId: string, sourceEpoch: number): Promise<SemanticStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticStatus } = await loadSemantic();
  return parseSemanticStatus(await invoke<unknown>('semantic_status', { profileId, sourceEpoch }));
}
export async function pauseSemanticIndex(profileId: string, sourceEpoch: number): Promise<SemanticStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticStatus } = await loadSemantic();
  return parseSemanticStatus(await invoke<unknown>('semantic_pause', { profileId, sourceEpoch }));
}
export async function resumeSemanticIndex(profileId: string, sourceEpoch: number): Promise<SemanticStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticStatus } = await loadSemantic();
  return parseSemanticStatus(await invoke<unknown>('semantic_resume', { profileId, sourceEpoch }));
}
export async function deleteSemanticIndex(profileId: string, sourceEpoch: number): Promise<SemanticStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticStatus } = await loadSemantic();
  return parseSemanticStatus(await invoke<unknown>('semantic_delete_index', { profileId, sourceEpoch }));
}
export async function querySemantic(query: SemanticQuery): Promise<SemanticQueryResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseSemanticQueryResult, parseSemanticQuery } = await loadSemantic();
  return parseSemanticQueryResult(await invoke<unknown>('semantic_query', { query: parseSemanticQuery(query) }));
}
export async function cancelSemanticQuery(profileId: string, requestId: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('semantic_cancel_query', { profileId, requestId });
}

export type EditAction =
  | { kind: 'create'; parentId: string; position: number; title: string; url?: string | null }
  | { kind: 'update'; chromeId: string; title?: string | null; url?: string | null }
  | { kind: 'move'; chromeId: string; parentId: string; position: number }
  | { kind: 'reorder'; parentId: string; childIds: string[] }
  | { kind: 'delete'; chromeId: string }
  | { kind: 'undo'; operationId: string };

export type BatchEditAction = { kind: 'move'; parentId: string } | { kind: 'delete' };
export async function previewBatchEdit(profileId: string, expectedRevision: number, chromeIds: string[], action: BatchEditAction): Promise<BatchEditPreview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseBatchEditPreview } = await loadBatch();
  return parseBatchEditPreview(await invoke<unknown>('preview_batch_edit', { profileId, expectedRevision, chromeIds, action }));
}
export async function applyBatchEdit(profileId: string, planId: string, planHash: string, secondConfirm: boolean): Promise<BatchEditStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseBatchEditStatus } = await loadBatch();
  return parseBatchEditStatus(await invoke<unknown>('apply_batch_edit', { profileId, planId, planHash, secondConfirm }));
}
export async function getBatchEdit(profileId: string, operationId: string): Promise<BatchEditStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseBatchEditStatus } = await loadBatch();
  return parseBatchEditStatus(await invoke<unknown>('get_batch_edit', { profileId, operationId }));
}
export async function cancelBatchEdit(profileId: string, operationId: string): Promise<BatchEditStatus> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseBatchEditStatus } = await loadBatch();
  return parseBatchEditStatus(await invoke<unknown>('cancel_batch_edit', { profileId, operationId }));
}

export function hasNativeBridge(): boolean { return isTauri(); }

export async function getStartupState(): Promise<StartupState> {
  const { parseStartupState } = await loadStartup();
  const value: unknown = isTauri()
    ? await invoke('get_startup_state')
    : { protocolVersion: 1, state: 'unpaired' };
  return parseStartupState(value);
}

export async function getBridgeState(): Promise<BridgeState> {
  const { parseBridgeState } = await loadBridge();
  const value: unknown = isTauri()
    ? await invoke('get_bridge_state')
    : { protocolVersion: 1, revision: 0, port: null, errorCode: null, profiles: [], mirrors: [] };
  return parseBridgeState(value);
}

export async function subscribeBridgeState(
  onState: (state: BridgeState) => void,
  onInvalid: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { parseBridgeState } = await loadBridge();
  return listen<unknown>('bridge-state', ({ payload }) => {
    try { onState(parseBridgeState(payload)); } catch { onInvalid(); }
  });
}

async function bridgeCommand(command: string, args: Record<string, unknown>): Promise<BridgeState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseBridgeState } = await loadBridge();
  return parseBridgeState(await invoke<unknown>(command, args));
}

export function retryBridgeListener(): Promise<BridgeState> {
  return bridgeCommand('retry_bridge_listener', {});
}

export function renameProfile(profileId: string, displayName: string): Promise<BridgeState> {
  return bridgeCommand('rename_profile', { profileId, displayName });
}

export function setProfileWritePaused(profileId: string, paused: boolean): Promise<BridgeState> {
  return bridgeCommand('set_profile_write_paused', { profileId, paused });
}

export function ignoreProfile(profileId: string): Promise<BridgeState> {
  return bridgeCommand('ignore_profile', { profileId });
}

export function resumeProfile(profileId: string): Promise<BridgeState> {
  return bridgeCommand('resume_profile', { profileId });
}

export function reconnectProfile(profileId: string): Promise<BridgeState> {
  return bridgeCommand('reconnect_profile', { profileId });
}

export function ensureLocalLibrary(): Promise<BridgeState> {
  return bridgeCommand('ensure_local_library', {});
}

export async function enumerateChromeUserData(userDataPath: string): Promise<ChromeProfileList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseChromeProfileList } = await loadBridge();
  return parseChromeProfileList(await invoke<unknown>('enumerate_chrome_user_data', { userDataPath }));
}

export function attachFileMirror(userDataPath: string, directoryKey: string): Promise<BridgeState> {
  return bridgeCommand('attach_file_mirror', { userDataPath, directoryKey });
}

export function rescanFileMirrors(): Promise<BridgeState> {
  return bridgeCommand('rescan_file_mirrors', {});
}

export function detachFileMirror(mirrorSourceId: string): Promise<BridgeState> {
  return bridgeCommand('detach_file_mirror', { mirrorSourceId });
}

export function associateFileMirror(mirrorSourceId: string, profileId: string): Promise<BridgeState> {
  return bridgeCommand('associate_file_mirror', { mirrorSourceId, profileId });
}

export async function getMirrorTree(mirrorSourceId: string): Promise<MirrorTree> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseMirrorTree } = await loadBridge();
  return parseMirrorTree(await invoke<unknown>('get_mirror_tree', { mirrorSourceId }));
}

export async function readCacheTree(profileId: string, folderId: string | null, depth: number): Promise<LibraryNodes> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibraryNodes } = await loadBridge();
  return parseLibraryNodes(await invoke<unknown>('cache_tree', { profileId, folderId, depth }));
}

export async function readCacheList(profileId: string, folderId: string, offset: number, limit: number): Promise<LibraryPage> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibraryPage } = await loadBridge();
  return parseLibraryPage(await invoke<unknown>('cache_list', { profileId, folderId, offset, limit }));
}

export async function readCacheQuery(profileId: string, request: LibraryQuery): Promise<LibraryQueryPage> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibraryQueryPage, parseLibraryQuery } = await loadBridge();
  return parseLibraryQueryPage(await invoke<unknown>('cache_query', { profileId, request: parseLibraryQuery(request) }));
}

export async function readCacheSearch(profileId: string, query: string, folderId: string | null, limit: number): Promise<LibrarySearch> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibrarySearch } = await loadBridge();
  return parseLibrarySearch(await invoke<unknown>('cache_search', { profileId, query, folderId, limit }));
}

export async function readCacheNode(profileId: string, chromeId: string): Promise<LibraryDetail> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibraryDetail } = await loadBridge();
  return parseLibraryDetail(await invoke<unknown>('cache_get', { profileId, chromeId }));
}

export async function readCacheCount(profileId: string, folderId: string | null): Promise<LibraryCount> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseLibraryCount } = await loadBridge();
  return parseLibraryCount(await invoke<unknown>('cache_count', { profileId, folderId }));
}

export async function openHttpUrl(url: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('open_http_url', { url });
}

export async function previewEdit(profileId: string, expectedRevision: number, action: EditAction): Promise<EditPreview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseEditPreview } = await loadBridge();
  return parseEditPreview(await invoke<unknown>('preview_edit', { profileId, expectedRevision, action }));
}

export async function applyEdit(profileId: string, expectedRevision: number, action: EditAction, secondConfirm: boolean): Promise<ApplyResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseApplyResult } = await loadBridge();
  return parseApplyResult(await invoke<unknown>('apply_edit', { profileId, expectedRevision, action, secondConfirm }));
}

export async function listOperations(profileId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOperationList } = await loadBridge();
  return parseOperationList(await invoke<unknown>('list_operations', { profileId }));
}

export async function operationDetail(profileId: string, operationId: string): Promise<OperationDetail> {
  const { parseOperationDetail } = await loadHistory();
  return parseOperationDetail(await invoke<unknown>('operation_detail', { profileId, operationId }));
}
export async function previewUndo(profileId: string, operationId: string, expectedRevision: number): Promise<UndoPreview> {
  const { parseUndoPreview } = await loadHistory();
  return parseUndoPreview(await invoke<unknown>('preview_undo', { profileId, operationId, expectedRevision }));
}
export async function saveExport(source: ExportSource, format: 'html' | 'sidecar'): Promise<ExportSaveResult> {
  const { parseExportSaveResult } = await loadHistory();
  return parseExportSaveResult(await invoke<unknown>('save_export', { source, format }));
}
export async function saveDiagnostics(): Promise<DiagnosticSaveResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseDiagnosticSaveResult } = await loadDiagnostics();
  return parseDiagnosticSaveResult(await invoke<unknown>('save_diagnostics'));
}

export async function reviewOperation(profileId: string, operationId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOperationList } = await loadBridge();
  return parseOperationList(await invoke<unknown>('review_operation', { profileId, operationId }));
}

export async function refreshOperations(profileId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOperationList } = await loadBridge();
  return parseOperationList(await invoke<unknown>('refresh_operations', { profileId }));
}

export async function exportHtml(profileId: string): Promise<EditDocument> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseEditDocument } = await loadBridge();
  return parseEditDocument(await invoke<unknown>('export_html', { profileId }));
}

export async function exportSidecar(profileId: string): Promise<EditDocument> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseEditDocument } = await loadBridge();
  return parseEditDocument(await invoke<unknown>('export_sidecar', { profileId }));
}

export type TagCommand =
  | { kind: 'set_note'; chromeIds: string[]; note: string }
  | { kind: 'add'; chromeIds: string[]; name: string }
  | { kind: 'remove'; chromeIds: string[]; tagId: string }
  | { kind: 'rename'; tagId: string; name: string }
  | { kind: 'merge'; sourceId: string; targetId: string }
  | { kind: 'delete'; tagId: string }
  | { kind: 'undo'; journalId: string }
  | { kind: 'set_encoding'; enabled: boolean };

export async function readTagState(profileId: string, chromeIds: string[], filterTagId: string | null, expectedSourceEpoch?: number): Promise<TagCatalog> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseTagCatalog } = await loadBridge();
  return parseTagCatalog(await invoke<unknown>('tag_state', { profileId, chromeIds, filterTagId, ...(expectedSourceEpoch === undefined ? {} : { expectedSourceEpoch }) }));
}

export async function tagCommand(profileId: string, command: TagCommand, expectedSourceEpoch?: number): Promise<TagCatalog> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseTagCatalog } = await loadBridge();
  return parseTagCatalog(await invoke<unknown>('tag_command', { profileId, command, ...(expectedSourceEpoch === undefined ? {} : { expectedSourceEpoch }) }));
}

export async function previewTitleEncoding(profileId: string, expectedRevision: number, chromeIds: string[], restore: boolean, expectedSourceEpoch?: number): Promise<TitleEncodingPreview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseTitleEncoding } = await loadBridge();
  return parseTitleEncoding(await invoke<unknown>('preview_title_encoding', { profileId, expectedRevision, chromeIds, restore, ...(expectedSourceEpoch === undefined ? {} : { expectedSourceEpoch }) }));
}

export async function readContentPreview(profileId: string, chromeId: string, requestId: string): Promise<ContentPreview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const [value, { parseContentPreview }] = await Promise.all([
    invoke<unknown>('content_preview', { profileId, chromeId, requestId }), loadBridge(),
  ]);
  return parseContentPreview(value);
}

export interface AiDraft {
  jobId: string;
  profileId: string;
  chromeId: string;
  inputFingerprint: string;
  title: string;
  tags: string[];
  summary: string | null;
  applyTitle: boolean;
  applyTags: boolean;
  applySummary: boolean;
}

export async function aiSettings(): Promise<AiSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiSettings } = await loadAi();
  return parseAiSettings(await invoke<unknown>('ai_settings'));
}

export async function saveAiConfig(enabled: boolean, provider: string, baseUrl: string, model: string): Promise<AiSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiSettings } = await loadAi();
  return parseAiSettings(await invoke<unknown>('save_ai_config', { enabled, provider, baseUrl, model }));
}

export async function setAiCredential(secret: string): Promise<AiSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiSettings } = await loadAi();
  return parseAiSettings(await invoke<unknown>('set_ai_credential', { secret }));
}

export async function clearAiCredential(): Promise<AiSettings> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiSettings } = await loadAi();
  return parseAiSettings(await invoke<unknown>('clear_ai_credential'));
}

export async function testAiConnection(): Promise<AiConnection> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiConnection } = await loadAi();
  return parseAiConnection(await invoke<unknown>('test_ai_connection'));
}

export async function suggestAi(profileId: string, chromeId: string, requestId: string): Promise<AiSuggestion> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const [value, { parseAiSuggestion }] = await Promise.all([
    invoke<unknown>('suggest_ai', { profileId, chromeId, requestId }), loadAi(),
  ]);
  return parseAiSuggestion(value);
}

export async function cancelAi(requestId: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('cancel_ai', { requestId });
}

export async function proposeOrganization(profileId: string, chromeIds: string[], requestId?: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const [value, { parseOrganizationPlan }] = await Promise.all([
    invoke<unknown>('propose_organization', { profileId, chromeIds, ...(requestId ? { requestId } : {}) }), loadOrganization(),
  ]);
  return parseOrganizationPlan(value);
}

export async function reviewOrganization(jobId: string, folders: OrganizationFolder[]): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('review_organization', { jobId, folders }));
}

export async function assignOrganization(jobId: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('assign_organization', { jobId }));
}

export async function editOrganization(jobId: string, chromeId: string, targetFolderId: string, rejected: boolean): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('edit_organization', { jobId, chromeId, targetFolderId, rejected }));
}

export async function applyOrganization(jobId: string, planHash: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('apply_organization', { jobId, planHash }));
}

export async function pauseOrganization(jobId: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('pause_organization', { jobId }));
}

export async function cancelOrganization(jobId: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('cancel_organization', { jobId }));
}

export async function cleanupOrganization(jobId: string, confirm: boolean, secondConfirm: boolean): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('cleanup_organization', { jobId, confirm, secondConfirm }));
}

export async function inspectLibrary(profileId: string, chromeIds: string[]): Promise<MaintenanceReport> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseMaintenanceReport } = await loadMaintenance();
  return parseMaintenanceReport(await invoke<unknown>('inspect_library', { profileId, chromeIds }));
}

export async function checkLinks(profileId: string, chromeIds: string[], requestId: string): Promise<MaintenanceReport> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const [value, { parseMaintenanceReport }] = await Promise.all([
    invoke<unknown>('check_links', { profileId, chromeIds, requestId }), loadMaintenance(),
  ]);
  return parseMaintenanceReport(value);
}

export async function cancelLinkCheck(requestId: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('cancel_link_check', { requestId });
}

export async function previewCleanup(profileId: string, expectedRevision: number, chromeIds: string[], keeperChromeId: string): Promise<MaintenanceReport> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseMaintenanceReport } = await loadMaintenance();
  return parseMaintenanceReport(await invoke<unknown>('preview_cleanup', { profileId, expectedRevision, chromeIds, keeperChromeId }));
}

export async function confirmCleanup(profileId: string, expectedRevision: number, chromeIds: string[], keeperChromeId: string, confirm: boolean, secondConfirm: boolean): Promise<MaintenanceReport> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseMaintenanceReport } = await loadMaintenance();
  return parseMaintenanceReport(await invoke<unknown>('confirm_cleanup', { args: { profileId, expectedRevision, chromeIds, keeperChromeId, confirm, secondConfirm } }));
}

export async function searchLibraryText(profileId: string, query: string): Promise<TextSearchPage> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseTextSearch } = await loadMaintenance();
  return parseTextSearch(await invoke<unknown>('search_library_text', { profileId, query }));
}

export async function organizationPlan(jobId: string): Promise<OrganizationPlan> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseOrganizationPlan } = await loadOrganization();
  return parseOrganizationPlan(await invoke<unknown>('organization_plan', { jobId }));
}

export async function applyAi(draft: AiDraft): Promise<AiApplyResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseAiApply } = await loadAi();
  return parseAiApply(await invoke<unknown>('apply_ai', { draft }));
}

export async function cancelContentPreview(requestId: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('cancel_content_preview', { requestId });
}

export async function applyTitleEncoding(profileId: string, expectedRevision: number, chromeIds: string[], restore: boolean, expectedSourceEpoch?: number): Promise<ApplyResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseApplyResult } = await loadBridge();
  return parseApplyResult(await invoke<unknown>('apply_title_encoding', { profileId, expectedRevision, chromeIds, restore, ...(expectedSourceEpoch === undefined ? {} : { expectedSourceEpoch }) }));
}

export async function webPreviewState(): Promise<WebPreviewState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseWebPreview } = await loadBridge();
  return parseWebPreview(await invoke<unknown>('web_preview_state'));
}

export async function openWebPreview(profileId: string, chromeId: string, requestId: string, url: string): Promise<WebPreviewState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseWebPreview } = await loadBridge();
  return parseWebPreview(await invoke<unknown>('open_web_preview', { profileId, chromeId, requestId, url }));
}

export async function webPreviewAction(action: 'back' | 'forward' | 'reload' | 'close'): Promise<WebPreviewState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseWebPreview } = await loadBridge();
  return parseWebPreview(await invoke<unknown>('web_preview_action', { action }));
}

export async function clearWebPreviewSession(profileId: string, requestId: string): Promise<WebPreviewState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  const { parseWebPreview } = await loadBridge();
  return parseWebPreview(await invoke<unknown>('clear_web_preview_session', { profileId, requestId }));
}

export async function subscribeWebPreview(onState: (state: WebPreviewState) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { parseWebPreview } = await loadBridge();
  const stop = await listen<unknown>('web-preview', ({ payload }) => {
    try { onState(parseWebPreview(payload)); } catch { /* Ignore a malformed preview event. */ }
  });
  return () => { stop(); };
}
