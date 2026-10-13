export type IconName = 'bookmark' | 'folder' | 'organize' | 'history' | 'settings' | 'back' | 'detail' | 'close' | 'chevron';

const paths: Record<IconName, string> = {
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  folder: 'M3 6h7l2 3h9v11H3V6Z',
  organize: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  history: 'M4 4v5h5M4 9a8 8 0 1 1-1 7M12 7v5l3 2',
  settings: 'M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  back: 'm10 5-7 7 7 7M3 12h18',
  detail: 'M3 4h18v16H3V4ZM15 4v16',
  close: 'm6 6 12 12M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
};

export function WorkspaceIcon({ name }: { name: IconName }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
