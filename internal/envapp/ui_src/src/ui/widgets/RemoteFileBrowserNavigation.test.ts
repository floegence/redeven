import { describe, expect, it } from 'vitest';

import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { DirectorySnapshotCache } from './RemoteFileBrowserNavigation';

const folder = (path: string, name = path.split('/').filter(Boolean).pop() ?? 'folder'): FileItem => ({
  id: path,
  name,
  path,
  type: 'folder',
});

describe('DirectorySnapshotCache', () => {
  it('rejects a remote response started before a local mutation', () => {
    const cache = new DirectorySnapshotCache();
    const initial = [folder('/workspace/docs')];

    cache.acceptRemote('/workspace', initial, 0);
    const requestRevision = cache.revision('/workspace');
    cache.mutate('/workspace', (items) => [...items, folder('/workspace/src')]);

    const accepted = cache.acceptRemote('/workspace', initial, requestRevision);
    expect(accepted?.items.map((item) => item.path)).toEqual(['/workspace/docs', '/workspace/src']);
    expect(cache.revision('/workspace')).toBe(1);
  });

  it('invalidates and rewrites cached directory prefixes for folder moves', () => {
    const cache = new DirectorySnapshotCache();
    cache.acceptRemote('/workspace', [folder('/workspace/repo')], 0);
    cache.acceptRemote('/workspace/repo', [folder('/workspace/repo/src')], 0);
    cache.acceptRemote('/workspace/repo/src', [folder('/workspace/repo/src/app')], 0);

    cache.rewritePrefix('/workspace/repo', '/workspace/archive');

    expect(cache.read('/workspace/repo')).toBeUndefined();
    expect(cache.read('/workspace/archive')?.items[0]?.path).toBe('/workspace/archive/src');
    expect(cache.read('/workspace/archive/src')?.items[0]?.path).toBe('/workspace/archive/src/app');
  });
});
