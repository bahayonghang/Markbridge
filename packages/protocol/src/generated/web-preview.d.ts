/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = WebPreviewNotice | null;
export type WebPreviewNotice =
  | 'SCHEME_DENIED'
  | 'USERINFO_DENIED'
  | 'POPUP_BLOCKED'
  | 'DOWNLOAD_BLOCKED'
  | 'LOAD_FAILED'
  | 'SESSION_CLEARED'
  | 'SESSION_BUSY';
export type WebPreviewPhase = 'closed' | 'loading' | 'ready' | 'blocked' | 'failed';

/**
 * State of the single full-page preview window. `url` is the selected bookmark.
 * `current_url` is the page the preview window has navigated to.
 */
export interface WebPreviewState {
  canGoBack: boolean;
  canGoForward: boolean;
  chromeId: RequiredNullable;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  currentUrl: string | null;
  notice: RequiredNullable2;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  noticeMessage: string | null;
  phase: WebPreviewPhase;
  profileId: RequiredNullable;
  requestId: RequiredNullable;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  url: string | null;
}
