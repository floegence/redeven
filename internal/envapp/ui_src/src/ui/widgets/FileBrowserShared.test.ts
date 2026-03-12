import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { describe, expect, it } from 'vitest';

import { insertItemToTree, withChildrenAtRoot } from './FileBrowserShared';

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
});
