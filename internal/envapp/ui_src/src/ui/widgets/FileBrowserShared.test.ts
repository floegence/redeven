import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { describe, expect, it } from 'vitest';

import {
  buildChildPath,
  canInsertIntoTree,
  getFilePreviewBlockReason,
  insertItemToTree,
  toFileItem,
  validateFileBrowserEntryName,
  withChildrenAtRoot,
} from './FileBrowserShared';

describe('FileBrowserShared scoped root helpers', () => {
  it('keeps a concrete root node when the requested path matches the scoped root', () => {
    const children: FileItem[] = [
      { id: '/Users/tester/src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
    ];

    expect(withChildrenAtRoot([], '/Users/tester', children, '/Users/tester')).toEqual([
      { id: '/Users/tester', name: 'tester', type: 'folder', path: '/Users/tester', children },
    ]);
  });

  it.each(['/', '/Users/tester'])('inserts created entries inside the loaded root node %s', (rootPath) => {
    const tree = withChildrenAtRoot([], rootPath, [], rootPath);
    const newPath = buildChildPath(rootPath, 'README.md');
    const newItem: FileItem = {
      id: newPath,
      name: 'README.md',
      type: 'file',
      path: newPath,
    };

    const updated = insertItemToTree(tree, rootPath, newItem);
    expect(updated).toStrictEqual([{ ...tree[0], children: [newItem] }]);
    expect(tree[0]?.children).toStrictEqual([]);
    expect(insertItemToTree(updated, rootPath, newItem)).toBe(updated);
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
    const children: FileItem[] = [
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

    const tree = withChildrenAtRoot([], '/Users/tester', children, '/Users/tester');
    expect(canInsertIntoTree([], '/Users/tester')).toBe(false);
    expect(canInsertIntoTree(tree, '/Users/tester')).toBe(true);
    expect(canInsertIntoTree(tree, '/Users/tester/src')).toBe(false);
    expect(canInsertIntoTree(tree, '/Users/tester/docs')).toBe(true);
    const item: FileItem = { id: '/Users/tester/src/test', path: '/Users/tester/src/test', name: 'test', type: 'file' };
    expect(insertItemToTree(tree, '/Users/tester/src', item)).toBe(tree);
    expect(insertItemToTree(tree, '/Users/tester/missing', item)).toBe(tree);
  });

  it('maps symlink entries into FileItem.link metadata while keeping folder/file interaction types intact', () => {
    const symlinkFolder = toFileItem({
      name: 'certs',
      path: '/Users/tester/certs',
      isDirectory: true,
      entryType: 'symlink',
      resolvedType: 'folder',
    });
    const symlinkFile = toFileItem({
      name: 'config',
      path: '/Users/tester/config',
      isDirectory: false,
      entryType: 'symlink',
      resolvedType: 'file',
    });
    const brokenLink = toFileItem({
      name: 'broken',
      path: '/Users/tester/broken',
      isDirectory: false,
      entryType: 'symlink',
      resolvedType: 'broken',
    });

    expect(symlinkFolder).toMatchObject({
      type: 'folder',
      link: { kind: 'symbolic', targetType: 'folder' },
    });
    expect(symlinkFile).toMatchObject({
      type: 'file',
      link: { kind: 'symbolic', targetType: 'file' },
    });
    expect(brokenLink).toMatchObject({
      type: 'file',
      link: { kind: 'symbolic', targetType: 'broken' },
    });
  });

  it('provides a preview guard reason for broken or directory-like targets before stream reads begin', () => {
    expect(getFilePreviewBlockReason({
      type: 'folder',
      link: undefined,
    })).toBe('Cannot preview a directory.');
    expect(getFilePreviewBlockReason({
      type: 'file',
      link: { kind: 'symbolic', targetType: 'folder' },
    })).toBe('Cannot preview a directory link.');
    expect(getFilePreviewBlockReason({
      type: 'file',
      link: { kind: 'symbolic', targetType: 'broken' },
    })).toBe('This symbolic link target is unavailable.');
    expect(getFilePreviewBlockReason({
      type: 'file',
      link: { kind: 'symbolic', targetType: 'file' },
    })).toBe(null);
  });
});
