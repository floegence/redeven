import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import { createDirectoryPickerDataSource, type DirectoryPickerDataSource } from './createDirectoryPickerDataSource';

type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withDataSource(
  listDirectory: (absolutePath: string) => Promise<readonly DirectoryEntry[]>,
  callback: (dataSource: DirectoryPickerDataSource, setHomePath: (value: string) => void) => Promise<void> | void,
) {
  return createRoot(async (dispose) => {
    const [homePath, setHomePath] = createSignal('/Users/alice');
    const dataSource = createDirectoryPickerDataSource({
      homePath,
      listDirectory,
    });

    try {
      await callback(dataSource, setHomePath);
    } finally {
      dispose();
    }
  });
}

describe('createDirectoryPickerDataSource', () => {
  it('hydrates ancestor directories so an existing unloaded path becomes selectable', async () => {
    const listDirectory = vi.fn(async (absolutePath: string): Promise<readonly DirectoryEntry[]> => {
      if (absolutePath === '/Users/alice') {
        return [{
          name: 'workspace',
          path: '/Users/alice/workspace',
          isDirectory: true,
        }];
      }
      if (absolutePath === '/Users/alice/workspace') {
        return [{
          name: 'src',
          path: '/Users/alice/workspace/src',
          isDirectory: true,
        }];
      }
      return [];
    });

    await withDataSource(listDirectory, async (dataSource) => {
      const result = await dataSource.ensurePath('/workspace/src', { reason: 'path-input' });

      expect(result).toEqual({
        status: 'ready',
        resolvedPath: '/workspace/src',
      });
      expect(listDirectory).toHaveBeenNthCalledWith(1, '/Users/alice');
      expect(listDirectory).toHaveBeenNthCalledWith(2, '/Users/alice/workspace');
      expect(dataSource.files()).toEqual([
        {
          id: '/workspace',
          name: 'workspace',
          path: '/workspace',
          type: 'folder',
          children: [
            {
              id: '/workspace/src',
              name: 'src',
              path: '/workspace/src',
              type: 'folder',
            },
          ],
        },
      ]);
    });
  });

  it('deduplicates concurrent loads for the same directory', async () => {
    const rootLoad = deferred<readonly DirectoryEntry[]>();
    const listDirectory = vi.fn(async (absolutePath: string): Promise<readonly DirectoryEntry[]> => {
      expect(absolutePath).toBe('/Users/alice');
      return rootLoad.promise;
    });

    await withDataSource(listDirectory, async (dataSource) => {
      const first = dataSource.ensureRootLoaded();
      const second = dataSource.ensureRootLoaded();
      rootLoad.resolve([{
        name: 'workspace',
        path: '/Users/alice/workspace',
        isDirectory: true,
      }]);

      await Promise.all([first, second]);

      expect(listDirectory).toHaveBeenCalledTimes(1);
      expect(dataSource.files()).toEqual([
        {
          id: '/workspace',
          name: 'workspace',
          path: '/workspace',
          type: 'folder',
        },
      ]);
    });
  });

  it('drops stale responses after reset so a previous home tree cannot leak back in', async () => {
    const rootLoad = deferred<readonly DirectoryEntry[]>();
    const listDirectory = vi.fn(async () => rootLoad.promise);

    await withDataSource(listDirectory, async (dataSource, setHomePath) => {
      const pending = dataSource.ensureRootLoaded();

      setHomePath('/Users/bob');
      dataSource.reset();

      rootLoad.resolve([{
        name: 'workspace',
        path: '/Users/alice/workspace',
        isDirectory: true,
      }]);

      await pending;

      expect(dataSource.files()).toEqual([]);
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });
  });
});
