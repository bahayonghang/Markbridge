import { useId, useMemo, useRef, useState } from 'react';
import type { BookmarkNode } from '@markbridge/protocol';
import { folderPath, indexFlat } from './model';
import { VirtualRows } from './VirtualRows';

export function writableFolder(nodes: BookmarkNode[], id: string | null): boolean {
  const index = indexFlat(nodes);
  const node = id ? index.nodes.get(id) : undefined;
  return !!node && node.kind === 'folder' && node.parentId != null
    && !folderPath(index, id).some((item) => item.unmodifiable === 'managed' || item.folderType === 'managed');
}

export function FolderPicker({ nodes, value, excluded = [], onChange }: {
  nodes: BookmarkNode[]; value: string | null; excluded?: string[]; onChange: (id: string) => void;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const index = useMemo(() => indexFlat(nodes), [nodes]);
  const paths = useMemo(() => [...index.nodes.values()].filter((node) => node.kind === 'folder').map((node) => {
    const ancestors = folderPath(index, node.chromeId);
    const reason = ancestors.some((item) => excluded.includes(item.chromeId)) ? '自身或后代'
      : node.parentId == null || ancestors.some((item) => item.unmodifiable === 'managed' || item.folderType === 'managed') ? '只读目录' : '';
    return { id: node.chromeId, path: ancestors.map((item) => item.title || '书签').join(' / '), reason };
  }), [index, excluded]);
  const rows = paths.filter((row) => row.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function close() { if (details.current) details.current.open = false; summary.current?.focus(); }
  return <details className="folder-picker" ref={details}>
    <summary ref={summary}>目标文件夹：{paths.find((row) => row.id === value)?.path ?? '请选择'}</summary>
    <label htmlFor={id}>搜索文件夹路径<input id={id} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="folder-picker-list"><VirtualRows rows={rows} rowHeight={52} rowKey={(row) => `${id}:${row.id}`} label="目标文件夹" role="listbox" itemRole="option" activeKey={value ? `${id}:${value}` : null}
      onKeyDown={(event) => {
        const available = rows.filter((row) => !row.reason);
        if (event.key === 'Enter' && available.some((row) => row.id === value)) { event.preventDefault(); close(); return; }
        const at = available.findIndex((row) => row.id === value);
        const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : event.key === 'ArrowDown' ? available[Math.min(at + 1, available.length - 1)] : event.key === 'ArrowUp' ? available[Math.max(0, at - 1)] : null;
        if (next) { event.preventDefault(); onChange(next.id); }
      }}
      onActive={(key, reason) => { const value = key.slice(id.length + 1); if (!rows.find((row) => row.id === value)?.reason) { onChange(value); if (reason === 'pointer') close(); } }}
      rowProps={(row) => ({ 'aria-disabled': !!row.reason })}
      render={(row) => <span className="folder-choice"><span>{row.path}</span>{row.reason && <small>{row.reason}</small>}</span>} /></div>
    {rows.length === 0 && <p>没有匹配的文件夹。</p>}
  </details>;
}
