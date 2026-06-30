import { describe, expect, it } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import {
  hasPickerFolderPath,
  listPickerTreePathChain,
  normalizePickerTreeInput,
  replacePickerChildren,
  toPickerFolderItem,
  toPickerTreeAbsolutePath,
  toPickerTreePath,
} from './directoryPickerTree';
import { basenameFromAbsolutePath } from './path';

describe('directoryPickerTree', () => {
  it('maps picker root to the configured home directory', () => {
    expect(toPickerTreeAbsolutePath('/', '/Users/alice')).toBe('/Users/alice');
    expect(toPickerTreeAbsolutePath('/project', '/Users/alice')).toBe('/Users/alice/project');
    expect(toPickerTreeAbsolutePath('/Users/alice/project', '/Users/alice')).toBe('/Users/alice/project');
  });

  it('maps absolute directories into picker-relative tree paths', () => {
    expect(toPickerTreePath('/Users/alice/project', '/Users/alice')).toBe('/project');
    expect(toPickerTreePath('/Users/alice', '/Users/alice')).toBe('/');
    expect(toPickerTreePath('/Volumes/team/project', '/Users/alice')).toBe('/Volumes/team/project');

    const item = toPickerFolderItem(
      {
        name: 'project',
        path: '/Users/alice/project',
        isDirectory: true,
        modifiedAt: 1_710_000_000_000,
      },
      '/Users/alice',
    );

    expect(item).toMatchObject({
      id: '/project',
      name: 'project',
      path: '/project',
      type: 'folder',
    });
    expect(item?.modifiedAt).toBeInstanceOf(Date);
  });

  it('normalizes absolute input under the configured root into picker tree paths', () => {
    expect(normalizePickerTreeInput('/Users/alice/project/src', '/Users/alice')).toBe('/project/src');
    expect(normalizePickerTreeInput('/project/src', '/Users/alice')).toBe('/project/src');
  });

  it('lists the full picker path chain from root to target', () => {
    expect(listPickerTreePathChain('/')).toEqual(['/']);
    expect(listPickerTreePathChain('/project/src')).toEqual([
      '/',
      '/project',
      '/project/src',
    ]);
  });

  it('replaces both root and nested folder children using picker paths', () => {
    const rootChildren: FileItem[] = [
      { id: '/project', name: 'project', path: '/project', type: 'folder' },
    ];
    const nestedChildren: FileItem[] = [
      { id: '/project/src', name: 'src', path: '/project/src', type: 'folder' },
    ];

    expect(replacePickerChildren([], '/', rootChildren)).toEqual(rootChildren);

    const next = replacePickerChildren(rootChildren, '/project', nestedChildren);
    expect(next[0]?.children).toEqual(nestedChildren);
    expect(hasPickerFolderPath(next, '/project')).toBe(true);
    expect(hasPickerFolderPath(next, '/project/src')).toBe(true);
    expect(hasPickerFolderPath(next, '/missing')).toBe(false);
  });

  it('formats basename labels for working directory chips', () => {
    expect(basenameFromAbsolutePath('/Users/alice/redeven', 'Working dir')).toBe('redeven');
    expect(basenameFromAbsolutePath('/', 'Working dir')).toBe('/');
    expect(basenameFromAbsolutePath('', 'Working dir')).toBe('Working dir');
  });
});
