import { describe, expect, it } from 'vitest';

import {
  fromWireFsExtractResponse,
  fromWireFsListResponse,
  fromWireFsPathContextResponse,
  toWireFsExtractRequest,
  toWireFsListRequest,
  toWireFsReadFileRequest,
  toWireFsWriteFileRequest,
  toWireFsMkdirRequest,
  toWireFsDeleteRequest,
  toWireFsCopyRequest,
} from './fs';

describe('fs codec', () => {
  it('encodes a new empty file as JSON without losing explicit false', () => {
    expect(toWireFsWriteFileRequest({ path: '/workspace/test', content: '', createDirs: false }))
      .toStrictEqual({ path: '/workspace/test', content: '', create_dirs: false });
  });

  it.each([false, true])('preserves explicit boolean options: %s', (value) => {
    expect(toWireFsListRequest({ path: '/workspace', showHidden: value }))
      .toStrictEqual({ path: '/workspace', show_hidden: value });
    expect(toWireFsWriteFileRequest({ path: '/workspace/test', content: '', createDirs: value }))
      .toStrictEqual({ path: '/workspace/test', content: '', create_dirs: value });
    expect(toWireFsMkdirRequest({ path: '/workspace/folder', createParents: value }))
      .toStrictEqual({ path: '/workspace/folder', create_parents: value });
    expect(toWireFsDeleteRequest({ path: '/workspace/test', recursive: value }))
      .toStrictEqual({ path: '/workspace/test', recursive: value });
    expect(toWireFsCopyRequest({ sourcePath: '/workspace/test', destPath: '/workspace/copy', overwrite: value }))
      .toStrictEqual({ source_path: '/workspace/test', dest_path: '/workspace/copy', overwrite: value });
  });

  it.each(['utf8', 'base64'] as const)('preserves explicit %s encoding and empty content', (encoding) => {
    expect(toWireFsReadFileRequest({ path: '/workspace/test', encoding }))
      .toStrictEqual({ path: '/workspace/test', encoding });
    expect(toWireFsWriteFileRequest({ path: '/workspace/test', content: '', encoding }))
      .toStrictEqual({ path: '/workspace/test', content: '', encoding });
  });

  it.each([
    {
      name: 'list',
      encode: () => toWireFsListRequest({ path: '/workspace' }),
      explicit: () => toWireFsListRequest({ path: '/workspace', showHidden: undefined }),
      expected: { path: '/workspace' },
    },
    {
      name: 'read',
      encode: () => toWireFsReadFileRequest({ path: '/workspace/test' }),
      explicit: () => toWireFsReadFileRequest({ path: '/workspace/test', encoding: undefined }),
      expected: { path: '/workspace/test' },
    },
    {
      name: 'write',
      encode: () => toWireFsWriteFileRequest({ path: '/workspace/test', content: '' }),
      explicit: () => toWireFsWriteFileRequest({ path: '/workspace/test', content: '', encoding: undefined, createDirs: undefined }),
      expected: { path: '/workspace/test', content: '' },
    },
    {
      name: 'mkdir',
      encode: () => toWireFsMkdirRequest({ path: '/workspace/folder' }),
      explicit: () => toWireFsMkdirRequest({ path: '/workspace/folder', createParents: undefined }),
      expected: { path: '/workspace/folder' },
    },
    {
      name: 'delete',
      encode: () => toWireFsDeleteRequest({ path: '/workspace/test' }),
      explicit: () => toWireFsDeleteRequest({ path: '/workspace/test', recursive: undefined }),
      expected: { path: '/workspace/test' },
    },
    {
      name: 'copy',
      encode: () => toWireFsCopyRequest({ sourcePath: '/workspace/test', destPath: '/workspace/copy' }),
      explicit: () => toWireFsCopyRequest({ sourcePath: '/workspace/test', destPath: '/workspace/copy', overwrite: undefined }),
      expected: { source_path: '/workspace/test', dest_path: '/workspace/copy' },
    },
  ])('omits absent and undefined options for $name', ({ encode, explicit, expected }) => {
    // Strict equality inspects the object before JSON serialization can hide undefined fields.
    expect(encode()).toStrictEqual(expected);
    expect(explicit()).toStrictEqual(expected);
  });

  it('maps archive extraction without retaining an empty password', () => {
    expect(toWireFsExtractRequest({
      sourcePath: '/workspace/bundle.zip',
      destinationParentPath: '/workspace',
      destinationName: 'bundle',
      password: '',
    })).toEqual({
      source_path: '/workspace/bundle.zip',
      destination_parent_path: '/workspace',
      destination_name: 'bundle',
    });
    expect(toWireFsExtractRequest({
      sourcePath: '/workspace/bundle.zip',
      destinationParentPath: '/workspace',
      destinationName: 'bundle',
      password: 'secret',
    })).toEqual({
      source_path: '/workspace/bundle.zip',
      destination_parent_path: '/workspace',
      destination_name: 'bundle',
      password: 'secret',
    });
    expect(fromWireFsExtractResponse({
      destination_path: '/workspace/bundle (2)',
      result_kind: 'directory',
      archive_format: 'zip',
    })).toEqual({
      destinationPath: '/workspace/bundle (2)',
      resultKind: 'directory',
      archiveFormat: 'zip',
    });
  });

  it('decodes symlink metadata from list responses without flattening it into is_directory alone', () => {
    const resp = fromWireFsListResponse({
      entries: [
        {
          name: 'certs',
          path: '/workspace/certs',
          is_directory: true,
          entry_type: 'symlink',
          resolved_type: 'folder',
          size: 0,
          modified_at: 10,
          created_at: 10,
        },
        {
          name: 'broken',
          path: '/workspace/broken',
          is_directory: false,
          entry_type: 'symlink',
          resolved_type: 'broken',
          size: 0,
          modified_at: 11,
          created_at: 11,
        },
      ],
    });

    expect(resp.entries[0]).toMatchObject({
      entryType: 'symlink',
      resolvedType: 'folder',
      isDirectory: true,
    });
    expect(resp.entries[1]).toMatchObject({
      entryType: 'symlink',
      resolvedType: 'broken',
      isDirectory: false,
    });
  });

  it('decodes filesystem roots while preserving the legacy home field', () => {
    const resp = fromWireFsPathContextResponse({
      agent_home_path_abs: '/Users/alice',
      home_path_abs: '/Users/alice',
      default_root_id: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          path: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
          system: true,
        },
        {
          id: 'computer',
          label: 'Computer',
          path: '/',
          kind: 'computer',
          permissions: { read: true, write: false },
          system: true,
        },
      ],
    });

    expect(resp.agentHomePathAbs).toBe('/Users/alice');
    expect(resp.homePathAbs).toBe('/Users/alice');
    expect(resp.defaultRootId).toBe('home');
    expect(resp.roots).toEqual([
      expect.objectContaining({ id: 'home', pathAbs: '/Users/alice', permissions: { read: true, write: true } }),
      expect.objectContaining({ id: 'computer', pathAbs: '/', permissions: { read: true, write: false } }),
    ]);
  });
});
