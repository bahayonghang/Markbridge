/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type EditDocumentKind = 'html' | 'sidecar';

export interface EditDocument {
  body: string;
  kind: EditDocumentKind;
}
