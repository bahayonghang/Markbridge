import type { Page } from '@playwright/test';

// The mock module exists only in this test route. Production browser previews stay unpaired.
export async function mockBridge(page: Page, scenario: 'connected' | 'startup-error' | 'port-conflict' | 'library' | 'readonly' | 'loading' | 'cache-error' | 'empty' | 'sources' | 'editing' | 'details' = 'connected') {
  await page.route('**/src/backend.ts*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const initial = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], pending: [], mirrors: [] };
      let receive;
      let state = initial;
      let starts = 0;
      const profile = { profileId: 'profile-test', instanceId: 'instance-test', displayName: '测试研究资料', connection: '${['readonly', 'details'].includes(scenario) ? 'cached_read_only' : 'live'}', nodeCount: 27, revision: 8, lastSyncedAt: null, errorCode: null };
      const root = { chromeId: '1', parentId: ${scenario === 'editing' ? "'0'" : 'null'}, position: 0, kind: 'folder', title: '书签栏', url: null };
      const names = ['Human Interface Guidelines', '设计系统里的留白与秩序', 'TypeScript Handbook', 'Tauri 2 · 桌面应用开发', '可访问性：让键盘也能完成每一步', '长中文标题，跨设备浏览与本地整理的工作方式，以及更多值得保留的阅读笔记'];
      const rows = Array.from({ length: 24 }, (_, index) => ({ chromeId: String(index + 10), parentId: '1', position: index, kind: 'bookmark', title: names[index % names.length] + (index > 5 ? ' ' + (index + 1) : ''), url: 'https://example.com/reference/' + index + '?topic=design' }));
      ${scenario === 'editing' ? `rows.unshift({ chromeId: 'empty', parentId: '1', position: 0, kind: 'folder', title: '空目录', url: null }, { chromeId: 'target', parentId: '1', position: 1, kind: 'folder', title: '阅读归档', url: null }); rows.forEach((row, index) => { row.position = index; });` : ''}
      window.__r01calls = [];
      window.__r07patch = (patch) => { state = { ...state, revision: state.revision + 1, profiles: state.profiles.map((item) => ({ ...item, ...patch })) }; receive?.(state); };
      const currentProfile = () => state.profiles[0] || profile;
      const member = (node) => ({ bookmarkId: 'bm-' + node.chromeId, chromeId: node.chromeId, title: node.title, url: 'https://example.com/reference', tags: ['阅读'], note: '保留的本地备注' });
      const maintenanceReport = (ids) => ({ profileId: profile.profileId, sourceEpoch: 1, revision: currentProfile().revision, requestId: 'fixture-maintenance', duplicates: [{ normalizedUrl: 'https://example.com/reference', members: rows.filter((row) => ids.includes(row.chromeId)).slice(0, 2).map(member) }], links: [], cleanup: null, running: false, failure: null, failureMessage: null });
      let orgPlan;

      const nodesFor = (profileId) => window.__r03nodes || (profileId === 'profile-second' ? rows.map((row) => ({ ...row, title: '另一份资料 ' + row.chromeId })) : rows);
      window.__r02disconnect = () => { state = { ...state, revision: state.revision + 1, profiles: state.profiles.map((item) => item.profileId === 'profile-second' ? { ...item, connection: 'cached_read_only' } : item) }; receive?.(state); };
      export const hasNativeBridge = () => true;
      export async function subscribeBridgeState(next) { receive = next; return () => { if (receive === next) receive = undefined; }; }
      export async function getStartupState() { ${scenario === 'startup-error' ? "throw new Error('sensitive-raw-error');" : "return { protocolVersion: 1, state: 'unpaired' };"} }
      export async function getBridgeState() {
        ${['connected', 'library', 'readonly', 'loading', 'cache-error', 'empty', 'sources', 'editing', 'details'].includes(scenario) ? "state = { ...initial, revision: 3, port: 49153, profiles: [profile] };" : ''}
        ${scenario === 'sources' ? "state.profiles.push({ ...profile, profileId: 'profile-second', displayName: '另一份资料' });" : ''}
        receive?.(state);
        return state;
      }
      export async function startBridge(port) {
        starts += 1;
        ${scenario === 'port-conflict' ? "if (starts === 1) throw 'CONFLICT';" : ''}
        state = { ...state, revision: state.revision + 1, port };
        return state;
      }
      export async function beginPairing() { if (window.__t14PairingFailure) throw 'STORAGE_ERROR'; throw new Error('mock-offer-unavailable'); }
      export async function confirmPairing() { throw new Error('mock-confirm-unavailable'); }
      export async function cancelPairing() { return state; }
      export async function reconnectProfile() {
        state = { ...state, revision: state.revision + 1, profiles: [{ ...profile, connection: 'reconciling' }] };
        receive?.(state);
        return initial;
      }
      export async function revokePairing() {
        state = { ...state, revision: state.revision + 1, profiles: [{ ...profile, connection: 'unpaired' }] };
        return state;
      }
      export async function enumerateChromeUserData() { return { profiles: [] }; }
      export async function attachFileMirror() { return state; }
      export async function rescanFileMirrors() { return state; }
      export async function detachFileMirror() { return state; }
      export async function associateFileMirror() { return state; }
      export async function getMirrorTree() { return { mirrorSourceId: 'mirror-a', displayName: 'Personal', fileStatus: 'current', association: 'independent', revision: 1, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: [] }; }
      export async function readCacheTree(profileId) { ${scenario === 'loading' ? 'return new Promise(() => {});' : scenario === 'cache-error' ? 'throw new Error("synthetic");' : ''} return { nodes: ${['library', 'readonly', 'sources', 'editing', 'details'].includes(scenario) ? '[root, ...nodesFor(profileId)]' : '[]'} }; }
      export async function readCacheQuery(profileId, request) { const all = (await readCacheTree(profileId)).nodes.filter((row) => request.folderScope === 'all' || row.parentId === request.folderId).filter((row) => !request.query || row.title.includes(request.query) || row.url?.includes(request.query)); const items = all.slice(request.offset, request.offset + request.limit); return { items, total: all.length, offset: request.offset, nextOffset: request.offset + items.length < all.length ? request.offset + items.length : null, sourceEpoch: 1, revision: currentProfile().revision }; }
      export async function readCacheList(profileId) { return { items: ${['library', 'readonly', 'sources', 'editing', 'details'].includes(scenario) ? 'nodesFor(profileId)' : '[]'}, total: ${['library', 'readonly', 'sources', 'editing', 'details'].includes(scenario) ? 'rows.length' : '0'} }; }
      export async function readCacheSearch(_profileId, query) { return { items: rows.filter((row) => row.title.includes(query) || row.url.includes(query)) }; }
      export async function readCacheNode(profileId, chromeId) { return { node: [root, ...nodesFor(profileId)].find((row) => row.chromeId === chromeId) || root, ancestors: chromeId === '1' ? [] : ['书签栏'] }; }
      export async function readCacheCount() { return { folders: 0, bookmarks: rows.length }; }
      export async function openHttpUrl() { window.__r01calls.push('open_url'); }
      export async function aiSettings() { window.__r01calls.push('ai_settings'); return window.__r07settings || { enabled: false, provider: null, endpointLabel: null, model: null, credentialConfigured: false, schemaSupported: null }; }
      export async function saveAiConfig() { return aiSettings(); }
      export async function setAiCredential() { if (window.__t14CredentialFailure) throw new Error('fixture-private-credential-detail'); return aiSettings(); }
      export async function clearAiCredential() { return aiSettings(); }
      export async function testAiConnection() { window.__r01calls.push('test_ai'); return { ok: false, failureMessage: null, settings: await aiSettings() }; }
      export async function listOperations() { return { operations: window.__r06history || [] }; }
      export async function refreshOperations() { return { operations: [] }; }
      export async function reviewOperation() { return { operations: [] }; }
      let batchPreview;
      let batchResult;
      export async function previewBatchEdit(profileId, expectedRevision, chromeIds, action) { window.__r01calls.push('preview_batch'); batchPreview = { planId: 'plan', planHash: 'hash', profileId, sourceEpoch: 1, expectedRevision, selectedCount: chromeIds.length, affected: chromeIds.length, requiresSecondConfirm: chromeIds.length > 20 && action.kind === 'delete', writable: true, destinationPath: action.kind === 'move' ? '书签栏 / 阅读归档' : null, items: chromeIds.map((id) => { const node = rows.find((row) => row.chromeId === id); return { chromeId: id, title: node.title, path: '书签栏 / ' + node.title, affected: 1, changes: [{ field: 'parent', before: '书签栏', after: action.kind === 'move' ? '书签栏 / 阅读归档' : null }] }; }) }; return batchPreview; }
      export async function applyBatchEdit() { window.__r01calls.push('apply_batch'); batchResult = { operationId: 'op-batch', profileId: profile.profileId, state: 'applied', stopped: false, errorCode: null, items: batchPreview.items.map((item) => ({ chromeId: item.chromeId, title: item.title, state: 'applied', errorCode: null })) }; return batchResult; }
      export async function getBatchEdit() { return batchResult; }
      export async function cancelBatchEdit() { throw new Error('mock'); }
      export async function saveExport(source, format) { window.__r01calls.push('save_export'); window.__r08export = { source, format }; const status = window.__r06saveStatus || 'saved'; return { status, metadata: { source, displayName: profile.displayName, format, sourceEpoch: source.kind === 'profile' ? 1 : null, revision: 8, cachedAt: 1791800000000, exportedAt: 1791800000100, nodeCount: 27 }, errorCode: status === 'failed' ? 'STORAGE_ERROR' : null }; }
      export async function operationDetail(profileId, operationId) { const summary = (await listOperations()).operations.find((row) => row.operationId === operationId); return { profileId, sourceEpoch: 1, summary, undoOf: null, steps: [{ requestId: 'history-step', mutation: { kind: 'update', title: '保存后的标题' }, before: rows[0], receipt: { operationId, requestId: 'history-step', state: 'applied', before: rows[0], after: { ...rows[0], title: '保存后的标题' } } }], restored: [] }; }
      export async function previewUndo(profileId, operationId, expectedRevision) { window.__r01calls.push('preview_undo'); return { profileId, operationId, expectedRevision, sourceEpoch: 1, writable: true, affected: 61, errorCode: null, conflicts: [], steps: Array.from({ length: 61 }, (_, index) => ({ requestId: 'undo-' + index, target: rows[0].chromeId, expectedBefore: { ...rows[0], title: '恢复项目 ' + index + '中文'.repeat(40) }, payload: { kind: 'update', title: '之前的标题 ' + index } })) }; }
      export async function previewEdit(profileId, expectedRevision, action) { window.__r01calls.push('preview_edit'); return { profileId, expectedRevision, affected: 1, writable: true, requiresSecondConfirm: false, errorCode: null, changes: [{ field: 'title', before: action.kind === 'create' ? null : '原值', after: action.title || '修改' }] }; }
      export async function applyEdit() { window.__r01calls.push('apply'); return { operationId: 'op-edit', state: 'applied', errorCode: null, conflicts: [] }; }
      export async function exportHtml() { throw new Error('mock'); }
      export async function exportSidecar() { throw new Error('mock'); }
      export async function saveDiagnostics() { window.__r01calls.push('save_diagnostics'); const status = window.__t13DiagnosticStatus || 'saved'; if (status === 'rejected') throw new Error('C:/private sk-secret'); return { status, errorCode: status === 'failed' ? 'STORAGE_ERROR' : null }; }
      const localNotes = new Map(); const localTags = new Map();
      const metadataKey = (profileId, chromeId) => profileId + ':' + chromeId;
      export async function readTagState(profileId, chromeIds = []) {
        if (['details', 'sources'].includes('${scenario}')) return { affected: 0, encodingEnabled: false, entries: chromeIds.map((chromeId) => ({ bookmarkId: profileId + '-bm-' + chromeId, chromeId, note: localNotes.get(metadataKey(profileId, chromeId)) || '', tagIds: localTags.get(metadataKey(profileId, chromeId)) ? ['tag-reading'] : [], rawTitle: null, lastEncodedTitle: null, conflict: false })), filterTagId: null, journalId: null, matches: [], mergeRequired: false, profileId, sourceTagId: null, tags: [{ tagId: 'tag-reading', name: '阅读清单', count: [...localTags.keys()].filter((key) => key.startsWith(profileId + ':')).length }], targetTagId: null };  return { affected: 0, encodingEnabled: false, entries: [], filterTagId: null, journalId: null, matches: [], mergeRequired: false, profileId: 'profile-test', sourceTagId: null, tags: [], targetTagId: null }; }
      export async function tagCommand(profileId, command) { if (!['details', 'sources'].includes('${scenario}')) throw new Error('mock'); window.__r01calls.push('tag_' + command.kind); window.__r08tagWrites ||= []; window.__r08tagWrites.push({ profileId, command }); for (const id of command.chromeIds || []) { const key = metadataKey(profileId, id); if (command.kind === 'set_note') localNotes.set(key, command.note); if (command.kind === 'add') localTags.set(key, command.name); if (command.kind === 'remove') localTags.delete(key); } return { ...(await readTagState(profileId, command.chromeIds)), affected: command.chromeIds?.length || 0 }; }
      export async function previewTitleEncoding() { throw new Error('mock'); }
      export async function applyTitleEncoding() { throw new Error('mock'); }
      export async function applyAi(draft) { window.__r01calls.push('apply_ai'); return { jobId: draft.jobId, browser: null, tagsApplied: draft.applyTags, summaryApplied: draft.applySummary, failure: null, failureMessage: null }; }
      export async function cancelAi() { window.__r01calls.push('cancel_ai'); }
      export async function suggestAi(profileId, chromeId, jobId) { window.__r01calls.push('suggest_ai'); return { jobId, profileId, chromeId, bookmarkId: 'bm-' + chromeId, inputFingerprint: 'f'.repeat(64), endpointLabel: window.__r07settings.endpointLabel, model: 'fixture', scope: { includesTitle: true, includesUrl: true, includesCachedText: false, excerptChars: 0 }, state: 'ready', title: '可编辑的简洁标题', tags: ['阅读', '设计'], summary: '先审查内容，再选择保存的字段。'.repeat(10), suggestedFolder: '设计资料', evidence: null, sourceTime: null, failure: null, failureMessage: null }; }
      export async function inspectLibrary(profileId, ids) { window.__r01calls.push('inspect'); return maintenanceReport(ids); }
      export async function checkLinks(profileId, ids) { window.__r01calls.push('check_links'); const result = { ...maintenanceReport(ids), duplicates: [], links: ids.slice(0, 3).map((id, index) => ({ bookmarkId: 'bm-' + id, chromeId: id, url: 'https://example.com/long-path/' + 'reference-'.repeat(20), httpStatus: [403, 429, null][index], verdict: 'unknown', checks: 1 })) }; if (window.__r07holdLinks) return new Promise((resolve) => { window.__r07finishLinks = () => resolve(result); }); return result; }
      export async function cancelLinkCheck() { window.__r01calls.push('cancel_links'); }
      export async function previewCleanup(profileId, revision, ids, keeperId) { window.__r01calls.push('preview_cleanup'); const report = maintenanceReport(ids); const members = report.duplicates[0].members; return { ...report, cleanup: { keeper: members.find((row) => row.chromeId === keeperId), removals: members.filter((row) => row.chromeId !== keeperId), metadata: { tagUnion: ['阅读', '设计'], keeperNote: '保留的本地备注', noteConflicts: [{ chromeId: '11', bookmarkId: 'bm-11', note: '另一份备注，清理前请核对。' }], handling: '保留项备注保持不变。标签取并集。摘要不合并。' }, operationId: null, operationState: null } }; }
      export async function confirmCleanup(profileId, revision, ids, keeperId) { window.__r01calls.push('confirm_cleanup'); const result = await previewCleanup(profileId, revision, ids, keeperId); return { ...result, cleanup: { ...result.cleanup, operationId: 'cleanup-op', operationState: 'applied' } }; }
      export async function searchLibraryText() { return { hits: [] }; }
      export async function proposeOrganization(profileId, ids, jobId) { window.__r01calls.push('organize'); orgPlan = { jobId, profileId, sourceEpoch: 1, sourceRevision: currentProfile().revision, inputFingerprint: 'fingerprint', planHash: 'hash', phase: 'folders', sampled: ids.length, scopeCount: ids.length, anchorId: '1', folders: [{ folderId: 'reading', name: '设计与开发', parentFolderId: null, reviewed: false }], scope: ids.map((chromeId) => ({ chromeId, bookmarkId: 'bm-' + chromeId, sourceParentId: '1', sourceLabel: rows.find((row) => row.chromeId === chromeId)?.title || chromeId })), assignments: [], impact: ids.length + 1, failure: null, failureMessage: null, operationId: null, backupVerified: false, applied: [], pending: [], uncertain: [], failed: [] }; return orgPlan; }
      export async function reviewOrganization(jobId, folders) { orgPlan = { ...orgPlan, folders, phase: 'reviewed' }; return orgPlan; }
      export async function assignOrganization() { window.__r01calls.push('assign'); orgPlan = { ...orgPlan, phase: 'ready', assignments: orgPlan.scope.map((row) => ({ ...row, targetFolderId: 'reading', citedInputId: row.chromeId, citedFolderId: 'reading', rejected: false })) }; return orgPlan; }
      export async function editOrganization() { throw new Error('mock'); }
      export async function applyOrganization() { throw new Error('mock'); }
      export async function pauseOrganization() { throw new Error('mock'); }
      export async function cancelOrganization() { window.__r01calls.push('cancel_organization'); orgPlan = { ...orgPlan, phase: 'cancelled' }; return orgPlan; }
      export async function cleanupOrganization() { throw new Error('mock'); }
      export async function organizationPlan() { throw new Error('mock'); }
      export async function readContentPreview(profileId, chromeId, requestId) { window.__r01calls.push('content_preview'); if (['details', 'sources'].includes('${scenario}')) return { requestId, profileId, chromeId, bookmarkId: 'bm-' + chromeId, status: 'cached', title: '缓存的阅读内容', summary: '<script>不执行页面脚本</script>' + '中文长正文与阅读记录。'.repeat(200), summarySource: 'excerpt', image: null, imageFailure: null, imageFailureMessage: null, fetchedAt: 1791800000000, cacheLabel: '网络不可达，显示本地缓存', failure: null, failureMessage: null }; return { requestId, profileId, chromeId, status: 'cancelled', summary: null, title: null, image: null, failureMessage: null }; }
      export async function cancelContentPreview() {}
      export async function webPreviewState() { return { requestId: null, profileId: null, chromeId: null, url: null, currentUrl: null, phase: 'closed', canGoBack: false, canGoForward: false, notice: null, noticeMessage: null }; }
      export async function openWebPreview() { throw new Error('mock'); }
      export async function webPreviewAction() { throw new Error('mock'); }
      export async function clearWebPreviewSession() { throw new Error('mock'); }
      export async function subscribeWebPreview() { return () => {}; }
      window.__semanticCalls = [];
      let semanticConfig = { enabled: false, endpointLabel: null, model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 };
      const semanticIndexes = new Map();
      const semanticReviews = new Map();
      const semanticCopy = value => JSON.parse(JSON.stringify(value));
      const semanticKey = (profileId, epoch) => profileId + ':' + epoch;
      const semanticCall = command => window.__semanticCalls.push(command);
      export async function semanticSettings() { semanticCall('settings'); return semanticCopy(semanticConfig); }
      export async function saveSemanticConfig(config) { semanticCall('save_config'); semanticConfig = { ...semanticConfig, enabled: config.enabled, endpointLabel: config.endpoint, model: config.model }; for (const index of semanticIndexes.values()) { index.generation += 1; if (!config.enabled && index.phase === 'running') index.phase = 'paused'; } return semanticCopy(semanticConfig); }
      export async function checkSemanticModel() { semanticCall('check_model'); return window.__semanticMissing ? { available: false, model: null, digest: null, dimension: null, failure: 'MISSING_MODEL', failureMessage: 'fixture-private-model-error' } : { available: true, model: semanticConfig.model, digest: 'a'.repeat(64), dimension: 768, failure: null, failureMessage: null }; }
      export async function semanticStatus(profileId, sourceEpoch) { semanticCall('status'); const index = semanticIndexes.get(semanticKey(profileId, sourceEpoch)); if (index?.phase === 'running' && !window.__semanticHoldBuild) { index.ready = Math.min(index.total, index.ready + 4); index.pending = index.total - index.ready; index.storedBytes = index.ready * 768 * 4; if (!index.pending) index.phase = 'ready'; } return semanticCopy({ settings: semanticConfig, index: index || null }); }
      export async function reviewSemanticScope(scope) { semanticCall('review'); const count = scope.folderId ? rows.filter(row => row.kind === 'bookmark').length : scope.selectedChromeIds.length; const value = { reviewId: 'review-' + (semanticReviews.size + 1), profileId: scope.profileId, sourceEpoch: scope.sourceEpoch, expectedRevision: scope.expectedRevision, count, clippedCount: Math.min(count, 1), upperBytes: count * 4096 * 4, model: semanticConfig.model, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 }; semanticReviews.set(value.reviewId, value); return semanticCopy(value); }
      export async function startSemanticIndex(reviewId) { semanticCall('start'); const review = semanticReviews.get(reviewId); const key = semanticKey(review.profileId, review.sourceEpoch); semanticIndexes.set(key, { indexId: 'index-' + semanticReviews.size, profileId: review.profileId, sourceEpoch: review.sourceEpoch, generation: 1, phase: window.__semanticMissing ? 'failed' : 'running', model: review.model, digest: 'a'.repeat(64), dimension: 768, total: review.count, ready: 0, pending: review.count, storedBytes: 0, failure: window.__semanticMissing ? 'MISSING_MODEL' : null, failureMessage: window.__semanticMissing ? 'fixture-private-model-error' : null }); return semanticCopy({ settings: semanticConfig, index: semanticIndexes.get(key) }); }
      export async function pauseSemanticIndex(profileId, sourceEpoch) { semanticCall('pause'); const index = semanticIndexes.get(semanticKey(profileId, sourceEpoch)); index.generation += 1; index.phase = 'paused'; return semanticCopy({ settings: semanticConfig, index }); }
      export async function resumeSemanticIndex(profileId, sourceEpoch) { semanticCall('resume'); const index = semanticIndexes.get(semanticKey(profileId, sourceEpoch)); index.generation += 1; index.phase = 'running'; return semanticCopy({ settings: semanticConfig, index }); }
      export async function deleteSemanticIndex(profileId, sourceEpoch) { semanticCall('delete'); semanticIndexes.delete(semanticKey(profileId, sourceEpoch)); return semanticCopy({ settings: semanticConfig, index: null }); }
      export async function querySemantic(query) { semanticCall('query'); if (window.__semanticQueryMode === 'error') throw new Error('fixture-private-query-body'); const value = { requestId: query.requestId, profileId: query.profileId, sourceEpoch: query.sourceEpoch, indexId: query.indexId, generation: query.generation, hits: window.__semanticQueryMode === 'empty' ? [] : [{ bookmarkId: 'bm-10', chromeId: '10', title: nodesFor(query.profileId).find(row => row.chromeId === '10').title, score: 0.913 }], failure: null, failureMessage: null }; if (window.__semanticQueryMode === 'hold') return new Promise(resolve => { window.__semanticResolveQuery = () => resolve(semanticCopy(value)); }); return semanticCopy(value); }
      export async function cancelSemanticQuery() { semanticCall('cancel_query'); }
    `,
  }));
}
