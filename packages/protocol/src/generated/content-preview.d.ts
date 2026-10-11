/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = PreviewFailure | null;
export type PreviewFailure =
  | 'SCHEME_DENIED'
  | 'ADDRESS_DENIED'
  | 'USERINFO_DENIED'
  | 'REDIRECT_DENIED'
  | 'REBIND_DENIED'
  | 'BODY_TOO_LARGE'
  | 'TIMED_OUT'
  | 'UNREACHABLE'
  | 'NOT_HTML'
  | 'INVALID_RESPONSE'
  | 'LOGIN_REQUIRED'
  | 'NOT_FOUND'
  | 'NO_URL';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = Counter | null;
export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = PreviewImage | null;
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export type PreviewStatus = 'ready' | 'cached' | 'failed' | 'cancelled';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = SummarySource | null;
export type SummarySource = 'description' | 'excerpt';

export interface ContentPreview {
  bookmarkId: Id;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  cacheLabel: string | null;
  chromeId: Id;
  failure: RequiredNullable3;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  failureMessage: string | null;
  fetchedAt: RequiredNullable4;
  image: RequiredNullable2;
  imageFailure: RequiredNullable3;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  imageFailureMessage: string | null;
  profileId: Id;
  requestId: Id;
  status: PreviewStatus;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  summary: string | null;
  summarySource: RequiredNullable;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  title: string | null;
}
export interface PreviewImage {
  dataBase64: string;
  mediaType: ImageMediaType;
  sourceLabel: string;
}
