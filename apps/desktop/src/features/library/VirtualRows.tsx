import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

type VirtualRowsProps<T> = {
  rows: T[];
  rowHeight?: number;
  rowKey: (row: T) => string;
  label: string;
  role: 'listbox' | 'tree';
  itemRole: 'option' | 'treeitem';
  activeKey: string | null;
  resetKey?: string;
  onActive: (key: string, reason?: 'pointer' | 'focus', event?: MouseEvent<HTMLDivElement>) => void;
  onActivate?: (row: T) => void;
  selectedKeys?: ReadonlySet<string>;
  total?: number;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  rowProps?: (row: T) => { 'aria-disabled'?: boolean; 'aria-expanded'?: boolean; 'aria-level'?: number; 'aria-posinset'?: number; 'aria-setsize'?: number };
  dragId?: (row: T) => string;
  onDropRow?: (row: T, sourceId: string) => void;
  render: (row: T, active: boolean) => ReactNode;
};

export function VirtualRows<T>({ rows, rowHeight = 40, rowKey, label, role, itemRole, activeKey, resetKey, onActive, onActivate, selectedKeys, total, onKeyDown, rowProps, dragId, onDropRow, render }: VirtualRowsProps<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeight(element.clientHeight || 320);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const activeIndex = activeKey == null ? -1 : rows.findIndex((row) => rowKey(row) === activeKey);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (activeIndex < 0) {
      element.scrollTop = 0;
      setScrollTop(0);
      return;
    }
    const top = activeIndex * rowHeight;
    const view = element.clientHeight || height;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowHeight > element.scrollTop + view) element.scrollTop = top + rowHeight - view;
    setScrollTop(element.scrollTop);
  }, [activeIndex, height, rowHeight, resetKey]);
  useEffect(() => {
    if (!activeKey) return;
    const element = document.getElementById(`library-row-${activeKey}`);
    const host = scroller.current;
    if (!element || !host || !host.contains(document.activeElement) || document.activeElement === element || document.activeElement instanceof HTMLInputElement) return;
    element.focus();
  }, [activeKey, scrollTop, rows]);
  const view = height || 320;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const end = Math.min(rows.length, start + Math.ceil(view / rowHeight) + 6);
  const slice = [];
  for (let index = start; index < end; index += 1) slice.push(index);
  if (activeIndex >= 0 && (activeIndex < start || activeIndex >= end)) slice.push(activeIndex);
  return (
    <div
      ref={scroller}
      className="virtual-rows"
      role={role}
      aria-label={label}
      aria-multiselectable={selectedKeys ? true : undefined}
      aria-activedescendant={activeIndex >= 0 ? `library-row-${activeKey}` : undefined}
      tabIndex={rows.length === 0 ? 0 : -1}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className="virtual-space" style={{ height: rows.length * rowHeight }}>
        {slice.map((index) => {
          const row = rows[index]!;
          const key = rowKey(row);
          const active = key === activeKey;
          const extra = rowProps?.(row);
          return (
            <div
              id={`library-row-${key}`}
              key={key}
              role={itemRole}
              aria-selected={selectedKeys ? selectedKeys.has(key) : active}
              aria-posinset={extra?.['aria-posinset'] ?? index + 1}
              aria-setsize={extra?.['aria-setsize'] ?? total ?? rows.length}
              aria-expanded={extra?.['aria-expanded']}
              aria-level={extra?.['aria-level']}
              aria-disabled={extra?.['aria-disabled']}
              tabIndex={active || (activeIndex < 0 && index === 0) ? 0 : -1}
              className={`library-row${(selectedKeys ? selectedKeys.has(key) : active) ? ' is-active' : ''}`}
              style={{ top: index * rowHeight, height: rowHeight }}
              draggable={dragId != null}
              onDragStart={(event) => { if (dragId) event.dataTransfer.setData('text/plain', dragId(row)); }}
              onDragOver={(event) => { if (onDropRow) event.preventDefault(); }}
              onDrop={(event) => {
                if (!onDropRow) return;
                event.preventDefault();
                const sourceId = event.dataTransfer.getData('text/plain');
                if (sourceId) onDropRow(row, sourceId);
              }}
              onClick={(event) => onActive(key, 'pointer', event)}
              onDoubleClick={() => onActivate?.(row)}
              onFocus={(event) => { if (!active && event.target === event.currentTarget) onActive(key, 'focus'); }}
            >
              {render(row, active)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
