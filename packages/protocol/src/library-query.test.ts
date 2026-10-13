import { expect, it } from 'vitest';
import { parseLibraryQuery, parseLibraryQueryPage } from './bridge';

const query = { folderId: '1', folderScope: 'children', query: '', tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null };
it('validates bounded local query pages and requires a revision and epoch on continuation', () => {
  expect(parseLibraryQuery(query)).toEqual(query);
  for (const extra of [{ limit: 0 }, { limit: 201 }, { offset: 100001 }, { offset: 200 }, { folderId: null }, { tagIds: ['same', 'same'] }, { browserCommand: 'write' }]) {
    expect(() => parseLibraryQuery({ ...query, ...extra })).toThrow('INVALID_LIBRARY_QUERY');
  }
  expect(parseLibraryQuery({ ...query, offset: 200, expectedRevision: 3, expectedSourceEpoch: 1 }).offset).toBe(200);
});

it('rejects malformed cursors and duplicate results before UI consumption', () => {
  const item = { chromeId: '1', parentId: null, position: 0, kind: 'folder', title: '测试', url: null };
  const page = { items: [item], total: 2, offset: 0, nextOffset: 1, sourceEpoch: 1, revision: 3 };
  expect(parseLibraryQueryPage(page)).toEqual(page);
  for (const extra of [{ nextOffset: 0 }, { nextOffset: null }, { nextOffset: 2 }, { items: [item, item], nextOffset: null }, { sourceEpoch: 0 }, { revision: -1 }]) {
    expect(() => parseLibraryQueryPage({ ...page, ...extra })).toThrow('INVALID_LIBRARY_QUERY_PAGE');
  }
});
