import validateBridge from './generated/bridge-state.validator.js';
import validatePairing from './generated/pairing-offer.validator.js';
import validateMirrorTree from './generated/mirror-tree.validator.js';
import validateChromeProfiles from './generated/chrome-profiles.validator.js';
import validateLibraryNodes from './generated/library-nodes.validator.js';
import validateLibraryPage from './generated/library-page.validator.js';
import validateLibrarySearch from './generated/library-search.validator.js';
import validateLibraryDetail from './generated/library-detail.validator.js';
import validateLibraryCount from './generated/library-count.validator.js';
import validateLibraryQuery from './generated/library-query.validator.js';
import validateLibraryQueryPage from './generated/library-query-page.validator.js';
import type { LibraryQuery } from './generated/library-query';
import type { LibraryQueryPage } from './generated/library-query-page';
export type { LibraryQuery, FolderScope } from './generated/library-query';
export type { LibraryQueryPage } from './generated/library-query-page';

export function parseLibraryQuery(value: unknown): LibraryQuery {
  if (!validateLibraryQuery(value) || value.limit < 1 || value.limit > 200 || value.offset > 100000
    || new Set(value.tagIds).size !== value.tagIds.length
    || (value.folderScope !== 'all' && value.folderId == null)
    || (value.offset > 0 && (value.expectedRevision == null || value.expectedSourceEpoch == null))) throw new Error('INVALID_LIBRARY_QUERY');
  return value;
}

export function parseLibraryQueryPage(value: unknown): LibraryQueryPage {
  if (!validateLibraryQueryPage(value) || (value.items.length > 0 && value.offset + value.items.length > value.total)
    || (value.nextOffset != null && (value.items.length === 0 || value.nextOffset !== value.offset + value.items.length || value.nextOffset >= value.total))
    || (value.nextOffset == null && value.offset + value.items.length < value.total)
    || new Set(value.items.map((node) => node.chromeId)).size !== value.items.length) throw new Error('INVALID_LIBRARY_QUERY_PAGE');
  return value;
}
import validateEditPreview from './generated/edit-preview.validator.js';
import validateApplyResult from './generated/apply-result.validator.js';
import validateOperationList from './generated/operation-list.validator.js';
import validateEditDocument from './generated/edit-document.validator.js';
import validateTagCatalog from './generated/tag-catalog.validator.js';
import validateTitleEncoding from './generated/title-encoding.validator.js';
import validateContentPreview from './generated/content-preview.validator.js';
import validateWebPreview from './generated/web-preview.validator.js';
import type { BridgeState } from './generated/bridge-state';
import type { PairingOffer } from './generated/pairing-offer';
import type { MirrorTree } from './generated/mirror-tree';
import type { ChromeProfileList } from './generated/chrome-profiles';
import type { LibraryNodes } from './generated/library-nodes';
import type { LibraryPage } from './generated/library-page';
import type { LibrarySearch } from './generated/library-search';
import type { LibraryDetail } from './generated/library-detail';
import type { LibraryCount } from './generated/library-count';
import type { EditPreview } from './generated/edit-preview';
import type { ApplyResult } from './generated/apply-result';
import type { OperationList } from './generated/operation-list';
import type { EditDocument } from './generated/edit-document';
import type { TagCatalog } from './generated/tag-catalog';
import type { TitleEncodingPreview } from './generated/title-encoding';
import type { ContentPreview } from './generated/content-preview';
import type { WebPreviewState } from './generated/web-preview';

export type { BridgeState } from './generated/bridge-state';
export type { PairingOffer } from './generated/pairing-offer';
export type { MirrorTree } from './generated/mirror-tree';
export type { ChromeProfileList, ChromeProfileChoice } from './generated/chrome-profiles';
export type { LibraryNodes } from './generated/library-nodes';
export type { LibraryPage } from './generated/library-page';
export type { LibrarySearch } from './generated/library-search';
export type { LibraryDetail } from './generated/library-detail';
export type { LibraryCount } from './generated/library-count';
export type { EditPreview } from './generated/edit-preview';
export type { ApplyResult } from './generated/apply-result';
export type { OperationList } from './generated/operation-list';
export type { EditDocument } from './generated/edit-document';
export type { TagCatalog, TagEntry, TagItem } from './generated/tag-catalog';
export type { TitleEncodingPreview, EncodingConflict } from './generated/title-encoding';
export type { ContentPreview, PreviewImage, PreviewStatus, PreviewFailure, SummarySource } from './generated/content-preview';
export type { WebPreviewState, WebPreviewPhase, WebPreviewNotice } from './generated/web-preview';

export function parseBridgeState(value: unknown): BridgeState {
  if (!validateBridge(value)) throw new Error('INVALID_BRIDGE_STATE');
  return value;
}

export function parsePairingOffer(value: unknown): PairingOffer {
  if (!validatePairing(value)) throw new Error('INVALID_PAIRING_OFFER');
  return value;
}

export function parseMirrorTree(value: unknown): MirrorTree {
  if (!validateMirrorTree(value)) throw new Error('INVALID_MIRROR_TREE');
  return value;
}

export function parseChromeProfileList(value: unknown): ChromeProfileList {
  if (!validateChromeProfiles(value)) throw new Error('INVALID_CHROME_PROFILES');
  return value;
}

export function parseLibraryNodes(value: unknown): LibraryNodes {
  if (!validateLibraryNodes(value)) throw new Error('INVALID_LIBRARY_NODES');
  return value;
}

export function parseLibraryPage(value: unknown): LibraryPage {
  if (!validateLibraryPage(value)) throw new Error('INVALID_LIBRARY_PAGE');
  return value;
}

export function parseLibrarySearch(value: unknown): LibrarySearch {
  if (!validateLibrarySearch(value)) throw new Error('INVALID_LIBRARY_SEARCH');
  return value;
}

export function parseLibraryDetail(value: unknown): LibraryDetail {
  if (!validateLibraryDetail(value)) throw new Error('INVALID_LIBRARY_DETAIL');
  return value;
}

export function parseLibraryCount(value: unknown): LibraryCount {
  if (!validateLibraryCount(value)) throw new Error('INVALID_LIBRARY_COUNT');
  return value;
}

export function parseEditPreview(value: unknown): EditPreview {
  if (!validateEditPreview(value)) throw new Error('INVALID_EDIT_PREVIEW');
  return value;
}

export function parseApplyResult(value: unknown): ApplyResult {
  if (!validateApplyResult(value)) throw new Error('INVALID_APPLY_RESULT');
  return value;
}

export function parseOperationList(value: unknown): OperationList {
  if (!validateOperationList(value)) throw new Error('INVALID_OPERATION_LIST');
  return value;
}

export function parseEditDocument(value: unknown): EditDocument {
  if (!validateEditDocument(value)) throw new Error('INVALID_EDIT_DOCUMENT');
  return value;
}

export function parseTagCatalog(value: unknown): TagCatalog {
  if (!validateTagCatalog(value)) throw new Error('INVALID_TAG_CATALOG');
  return value;
}

export function parseTitleEncoding(value: unknown): TitleEncodingPreview {
  if (!validateTitleEncoding(value)) throw new Error('INVALID_TITLE_ENCODING');
  return value;
}

export function parseContentPreview(value: unknown): ContentPreview {
  if (!validateContentPreview(value)) throw new Error('INVALID_CONTENT_PREVIEW');
  return value;
}

export function parseWebPreview(value: unknown): WebPreviewState {
  if (!validateWebPreview(value)) throw new Error('INVALID_WEB_PREVIEW');
  return value;
}
