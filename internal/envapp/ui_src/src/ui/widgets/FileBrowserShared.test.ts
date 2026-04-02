import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { describe, expect, it } from 'vitest';

import {
  buildChildPath,
  canInsertIntoTree,
  insertItemToTree,
  validateFileBrowserEntryName,
  withChildrenAtRoot,
} from './FileBrowserShared';

describe('FileBrowserShared scoped root helpers', () => {
  it('replaces top-level children when the requested path matches the scoped root', () => {
    const children: FileItem[] = [
      { id: '/Users/tester/src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
    ];

    expect(withChildrenAtRoot([], '/Users/tester', children, '/Users/tester')).toEqual(children);
  });

  it('inserts new items at the scoped root instead of requiring a synthetic slash root node', () => {
    const tree: FileItem[] = [
      { id: '/Users/tester/src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
    ];
    const newItem: FileItem = {
      id: '/Users/tester/README.md',
      name: 'README.md',
      type: 'file',
      path: '/Users/tester/README.md',
    };

    expect(insertItemToTree(tree, '/Users/tester', newItem, '/Users/tester')).toEqual([
      { id: '/Users/tester/src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
      { id: '/Users/tester/README.md', name: 'README.md', type: 'file', path: '/Users/tester/README.md' },
    ]);
  });

  it('validates entry names as single path segments', () => {
    expect(validateFileBrowserEntryName('')).toBe('Name is required.');
    expect(validateFileBrowserEntryName('..')).toBe('Name cannot be "." or "..".');
    expect(validateFileBrowserEntryName('nested/path')).toBe('Name cannot contain path separators.');
    expect(validateFileBrowserEntryName('README.md')).toBeNull();
  });

  it('builds a direct child path without leaking extra separators', () => {
    expect(buildChildPath('/Users/tester', 'README.md')).toBe('/Users/tester/README.md');
    expect(buildChildPath('/', 'README.md')).toBe('/README.md');
  });

  it('only inserts into the visible tree when the destination directory is already loaded', () => {
    const tree: FileItem[] = [
      {
        id: '/Users/tester/src',
        name: 'src',
        type: 'folder',
        path: '/Users/tester/src',
      },
      {
        id: '/Users/tester/docs',
        name: 'docs',
        type: 'folder',
        path: '/Users/tester/docs',
        children: [],
      },
    ];

    expect(canInsertIntoTree(tree, '/Users/tester', '/Users/tester')).toBe(true);
    expect(canInsertIntoTree(tree, '/Users/tester/src', '/Users/tester')).toBe(false);
    expect(canInsertIntoTree(tree, '/Users/tester/docs', '/Users/tester')).toBe(true);
  });
});
