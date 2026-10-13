import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { BookmarkNode } from '@markbridge/protocol';
import { FolderPicker } from './FolderPicker';

const nodes: BookmarkNode[] = [
  { chromeId: '0', parentId: null, position: 0, kind: 'folder', title: '书签' },
  { chromeId: 'bar', parentId: '0', position: 0, kind: 'folder', title: '书签栏', folderType: 'bookmarks-bar' },
  { chromeId: 'folder', parentId: 'bar', position: 0, kind: 'folder', title: '阅读归档' },
];
function Picker() { const [value, setValue] = useState<string | null>(null); return <FolderPicker nodes={nodes} value={value} onChange={setValue} />; }
afterEach(cleanup);

it('closes after pointer selection and keeps the full selected path visible', () => {
  render(<Picker />);
  const summary = screen.getByText('目标文件夹：请选择'); fireEvent.click(summary);
  fireEvent.click(screen.getByRole('option', { name: '书签 / 书签栏 / 阅读归档' }));
  expect(summary.parentElement).not.toHaveAttribute('open');
  expect(summary).toHaveTextContent('目标文件夹：书签 / 书签栏 / 阅读归档');
  expect(summary).toHaveFocus();
});

it('keeps arrow navigation open and closes on Enter while restoring summary focus', () => {
  render(<Picker />);
  const summary = screen.getByText('目标文件夹：请选择'); fireEvent.click(summary);
  const list = screen.getByRole('listbox', { name: '目标文件夹' });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(summary.parentElement).toHaveAttribute('open');
  expect(summary).toHaveTextContent('书签 / 书签栏');
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(summary.parentElement).toHaveAttribute('open');
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(summary.parentElement).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
});
