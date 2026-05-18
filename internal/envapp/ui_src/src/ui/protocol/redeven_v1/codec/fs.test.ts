import { describe, expect, it } from 'vitest';

import { fromWireFsListResponse, fromWireFsPathContextResponse } from './fs';

describe('fs codec', () => {
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
