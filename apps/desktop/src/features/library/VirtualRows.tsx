import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const ROW_HEIGHT = 40;

type VirtualRowsProps<T> = {
  rows: T[];
  rowKey: (row: T) => string;
  label: string;
  role: 'listbox' | 'tree';
  itemRole: 'option' | 'treeitem';
  activeKey: string | null;
  onActive: (key: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  rowProps?: (row: T) => { 'aria-expanded'?: boolean };
  dragId?: (row: T) => string;
  onDropRow?: (row: T, sourceId: string) => void;
  render: (row: T, active: boolean) => ReactNode;
};

export function VirtualRows<T>({ rows, rowKey, label, role, itemRole, activeKey, onActive, onKeyDown, rowProps, dragId, onDropRow, render }: VirtualRowsProps<T>) {
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
    if (!element || activeIndex < 0) return;
    const top = activeIndex * ROW_HEIGHT;
    const view = element.clientHeight || height;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + view) element.scrollTop = top + ROW_HEIGHT - view;
  }, [activeIndex, height]);
  useEffect(() => {
    if (!activeKey) return;
    const element = document.getElementById(`library-row-${activeKey}`);
    const host = scroller.current;
    if (!element || !host || !host.contains(document.activeElement) || document.activeElement === element) return;
    element.focus();
  }, [activeKey, scrollTop, rows]);
  const view = height || 320;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const end = Math.min(rows.length, start + Math.ceil(view / ROW_HEIGHT) + 6);
  const slice = [];
  for (let index = start; index < end; index += 1) slice.push(index);
  if (activeIndex >= 0 && (activeIndex < start || activeIndex >= end)) slice.push(activeIndex);
  return (
    <div
      ref={scroller}
      className="virtual-rows"
      role={role}
      aria-label={label}
      aria-activedescendant={activeKey ? `library-row-${activeKey}` : undefined}
      tabIndex={rows.length === 0 ? 0 : -1}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className="virtual-space" style={{ height: rows.length * ROW_HEIGHT }}>
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
              aria-selected={active}
              aria-expanded={extra?.['aria-expanded']}
              tabIndex={active ? 0 : -1}
              className={active ? 'library-row is-active' : 'library-row'}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
              draggable={dragId != null}
              onDragStart={(event) => { if (dragId) event.dataTransfer.setData('text/plain', dragId(row)); }}
              onDragOver={(event) => { if (onDropRow) event.preventDefault(); }}
              onDrop={(event) => {
                if (!onDropRow) return;
                event.preventDefault();
                const sourceId = event.dataTransfer.getData('text/plain');
                if (sourceId) onDropRow(row, sourceId);
              }}
              onClick={() => onActive(key)}
              onFocus={() => { if (!active) onActive(key); }}
            >
              {render(row, active)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
