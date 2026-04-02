import { describe, expect, it } from 'vitest';

import { fromWireFsListResponse } from './fs';

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
});
