export type IconName = 'bookmark' | 'folder' | 'organize' | 'search' | 'history' | 'settings' | 'connection' | 'back' | 'detail' | 'close' | 'chevron' | 'sidebar-collapse' | 'sidebar-expand' | 'expand-all' | 'collapse-all';

const paths: Record<IconName, string> = {
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  folder: 'M3 6h7l2 3h9v11H3V6Z',
  organize: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm5.5 13 5 5',
  history: 'M4 4v5h5M4 9a8 8 0 1 1-1 7M12 7v5l3 2',
  settings: 'M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  connection: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  back: 'm10 5-7 7 7 7M3 12h18',
  detail: 'M3 4h18v16H3V4ZM15 4v16',
  close: 'm6 6 12 12M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
  'sidebar-collapse': 'M3 4h18v16H3V4ZM9 4v16m7-11-3 3 3 3',
  'sidebar-expand': 'M3 4h18v16H3V4ZM9 4v16M13 9l3 3-3 3',
  'expand-all': 'm7 9 5-5 5 5M7 15l5 5 5-5',
  'collapse-all': 'm7 4 5 5 5-5M7 20l5-5 5 5',
};

export function WorkspaceIcon({ name }: { name: IconName }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
