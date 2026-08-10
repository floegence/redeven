import { describe, expect, it, vi } from 'vitest';

import {
  createFlowerComposerReferenceIndex,
  rankFlowerComposerReferenceCandidates,
  type FlowerComposerReferenceCandidate,
  type FlowerComposerReferenceDirectoryEntry,
} from './flowerComposerReferenceIndex';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function entry(
  path: string,
  isDirectory = false,
): FlowerComposerReferenceDirectoryEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    isDirectory,
  };
}

describe('createFlowerComposerReferenceIndex', () => {
  it('treats a slash query as a direct-child browsing scope', async () => {
    const index = createFlowerComposerReferenceIndex({
      listDirectory: vi.fn(async (path: string) => {
        if (path === '/workspace') {
          return [
            entry('/workspace/src', true),
            entry('/workspace/scripts', true),
            entry('/workspace/root.ts'),
          ];
        }
        if (path === '/workspace/src') {
          return [
            entry('/workspace/src/components', true),
            entry('/workspace/src/config.ts'),
            entry('/workspace/src/main.ts'),
          ];
        }
        if (path === '/workspace/src/components') {
          return [entry('/workspace/src/components/Composer.tsx')];
        }
        return [];
      }),
    });

    const children = await index.search({
      cacheKey: 'target-a',
      rootPath: '/workspace',
      query: 'src/',
    });
    const filtered = await index.search({
      cacheKey: 'target-a',
      rootPath: '/workspace',
      query: 'src/co',
    });
    const nested = await index.search({
      cacheKey: 'target-a',
      rootPath: '/workspace',
      query: 'src/components/',
    });

    expect(children?.status === 'ready' ? children.candidates.map((candidate) => candidate.path) : [])
      .toEqual([
        '/workspace/src/components',
        '/workspace/src/config.ts',
        '/workspace/src/main.ts',
      ]);
    expect(filtered?.status === 'ready' ? filtered.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['/workspace/src/config.ts', '/workspace/src/components']);
    expect(nested?.status === 'ready' ? nested.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['/workspace/src/components/Composer.tsx']);
  });

  it('keeps path browsing inside Unix and Windows working-directory roots', async () => {
    const unix = createFlowerComposerReferenceIndex({
      listDirectory: vi.fn(async (path: string) => path === '/'
        ? [entry('/safe', true), entry('/root.txt')]
        : path === '/safe' ? [entry('/safe/child.txt')] : []),
    });
    const windows = createFlowerComposerReferenceIndex({
      listDirectory: vi.fn(async (path: string) => path === 'C:/workspace'
        ? [entry('C:/workspace/资料', true), entry('D:/escape.txt')]
        : path === 'C:/workspace/资料' ? [entry('C:/workspace/资料/说明.md')] : []),
    });

    const escaped = await unix.search({ cacheKey: 'unix', rootPath: '/', query: '../' });
    const unixChildren = await unix.search({ cacheKey: 'unix', rootPath: '/', query: 'safe/' });
    const windowsChildren = await windows.search({
      cacheKey: 'windows',
      rootPath: 'C:\\workspace',
      query: '资料/',
    });

    expect(escaped?.status).toBe('empty');
    expect(unixChildren?.status === 'ready' ? unixChildren.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['/safe/child.txt']);
    expect(windowsChildren?.status === 'ready' ? windowsChildren.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['C:/workspace/资料/说明.md']);
  });

  it('scans files and directories breadth-first while skipping ignored and unreadable children', async () => {
    const calls: string[] = [];
    const listDirectory = vi.fn(async (path: string): Promise<readonly FlowerComposerReferenceDirectoryEntry[]> => {
      calls.push(path);
      if (path === '/workspace') {
        return [
          entry('/workspace/src', true),
          entry('/workspace/node_modules', true),
          entry('/workspace/README.md'),
        ];
      }
      if (path === '/workspace/src') {
        return [
          entry('/workspace/src/components', true),
          entry('/workspace/src/main.ts'),
          entry('/workspace', true),
          entry('/outside/escape.ts'),
        ];
      }
      if (path === '/workspace/src/components') throw new Error('permission denied');
      return [];
    });
    const index = createFlowerComposerReferenceIndex({ listDirectory });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });

    expect(result).toMatchObject({ status: 'ready' });
    expect(result?.status === 'ready' ? result.candidates : []).toEqual([
      { kind: 'file', label: 'README.md', path: '/workspace/README.md', relativeParent: '' },
      { kind: 'directory', label: 'src', path: '/workspace/src', relativeParent: '' },
      {
        kind: 'directory',
        label: 'components',
        path: '/workspace/src/components',
        relativeParent: 'src',
      },
      { kind: 'file', label: 'main.ts', path: '/workspace/src/main.ts', relativeParent: 'src' },
    ]);
    expect(calls).toEqual(['/workspace', '/workspace/src', '/workspace/src/components']);
  });

  it('enforces candidate and path bounds', async () => {
    const listDirectory = vi.fn(async (path: string): Promise<readonly FlowerComposerReferenceDirectoryEntry[]> => {
      if (path === '/workspace') {
        return [
          entry('/workspace/this-path-is-longer-than-the-configured-limit.ts'),
          entry('/workspace/a', true),
          entry('/workspace/b', true),
          entry('/workspace/c.txt'),
        ];
      }
      return [entry(`${path}/nested`, true), entry(`${path}/value.ts`)];
    });
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      limits: {
        maxDepth: 1,
        maxDirectories: 2,
        maxCandidates: 3,
        maxEntriesPerDirectory: 4,
        maxPathLength: 30,
        maxResults: 20,
      },
    });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });

    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(result?.status === 'ready' ? result.candidates : []).toHaveLength(3);
  });

  it('processes no more than the configured entries per directory', async () => {
    const listDirectory = vi.fn(async () => [
      entry('/workspace/a.ts'),
      entry('/workspace/b.ts'),
      entry('/workspace/c.ts'),
    ]);
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      limits: { maxDepth: 0, maxEntriesPerDirectory: 2, maxResults: 20 },
    });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });

    expect(result?.status === 'ready' ? result.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['/workspace/a.ts', '/workspace/b.ts']);
  });

  it('does not descend beyond the configured depth', async () => {
    const listDirectory = vi.fn(async (path: string) => [entry(`${path}/child`, true)]);
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      limits: { maxDepth: 0 },
    });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });

    expect(result).toMatchObject({ status: 'ready' });
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it('bounds directory reads independently from candidate collection', async () => {
    const listDirectory = vi.fn(async (path: string) => {
      if (path === '/workspace') {
        return [entry('/workspace/a', true), entry('/workspace/b', true)];
      }
      return [entry(`${path}/value.ts`)];
    });
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      limits: { maxDirectories: 2, maxCandidates: 20, maxResults: 20 },
    });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });

    expect(result?.status === 'ready' ? result.candidates.map((candidate) => candidate.path) : [])
      .toEqual(['/workspace/a', '/workspace/b', '/workspace/a/value.ts']);
    expect(listDirectory.mock.calls.map(([path]) => path)).toEqual(['/workspace', '/workspace/a']);
  });

  it('rejects an empty root without listing the host filesystem root', async () => {
    const listDirectory = vi.fn(async () => []);
    const index = createFlowerComposerReferenceIndex({ listDirectory });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '', query: '' });

    expect(result).toMatchObject({ status: 'error' });
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it('surfaces a root failure instead of treating it as an empty result', async () => {
    const failure = new Error('root unavailable');
    const index = createFlowerComposerReferenceIndex({
      listDirectory: vi.fn(async () => { throw failure; }),
    });

    const result = await index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: 'src' });

    expect(result).toEqual({
      status: 'error',
      generation: 1,
      input: { cacheKey: 'target-a', rootPath: '/workspace', query: 'src' },
      candidates: [],
      error: failure,
    });
  });

  it('shares one scan across query generations and only publishes the latest result', async () => {
    const root = deferred<readonly FlowerComposerReferenceDirectoryEntry[]>();
    const listDirectory = vi.fn(async (_path: string) => root.promise);
    const states: string[] = [];
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      onStateChange: (state) => states.push(`${state.generation}:${state.status}`),
    });

    const first = index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: 'read' });
    const second = index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: 'src' });
    root.resolve([entry('/workspace/README.md'), entry('/workspace/src', true)]);

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toMatchObject({
      status: 'ready',
      generation: 2,
      candidates: [{ kind: 'directory', path: '/workspace/src' }],
    });
    expect(listDirectory.mock.calls.filter(([path]) => path === '/workspace')).toHaveLength(1);
    expect(states).toEqual(['1:loading', '2:loading', '2:ready']);
  });

  it('soft-aborts recursive work and rejects the late root response', async () => {
    const root = deferred<readonly FlowerComposerReferenceDirectoryEntry[]>();
    const listDirectory = vi.fn(async () => root.promise);
    const index = createFlowerComposerReferenceIndex({ listDirectory });

    const pending = index.search({ cacheKey: 'target-a', rootPath: '/workspace', query: '' });
    index.softAbort();
    root.resolve([entry('/workspace/src', true)]);

    await expect(pending).resolves.toBeUndefined();
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(index.current()).toEqual({ status: 'idle', generation: 2 });
  });

  it('expires cached scans by TTL and supports explicit invalidation', async () => {
    let now = 1_000;
    const listDirectory = vi.fn(async () => [entry('/workspace/main.ts')]);
    const index = createFlowerComposerReferenceIndex({
      listDirectory,
      ttlMs: 100,
      now: () => now,
    });
    const input = { cacheKey: 'target-a', rootPath: '/workspace', query: '' };

    await index.search(input);
    await index.search(input);
    expect(listDirectory).toHaveBeenCalledTimes(1);

    now += 101;
    await index.search(input);
    expect(listDirectory).toHaveBeenCalledTimes(2);

    index.invalidate('target-a');
    await index.search(input);
    expect(listDirectory).toHaveBeenCalledTimes(3);
  });

  it('soft-aborts an old working directory without publishing it into the new scope', async () => {
    const oldRoot = deferred<readonly FlowerComposerReferenceDirectoryEntry[]>();
    const listDirectory = vi.fn(async (path: string) => {
      if (path === '/old') return oldRoot.promise;
      return [entry('/new/current.ts')];
    });
    const index = createFlowerComposerReferenceIndex({ listDirectory });

    const oldSearch = index.search({ cacheKey: 'target-a', rootPath: '/old', query: '' });
    const newSearch = index.search({ cacheKey: 'target-a', rootPath: '/new', query: '' });
    oldRoot.resolve([entry('/old/stale.ts')]);

    await expect(oldSearch).resolves.toBeUndefined();
    await expect(newSearch).resolves.toMatchObject({
      status: 'ready',
      candidates: [{ path: '/new/current.ts' }],
    });
  });
});

describe('rankFlowerComposerReferenceCandidates', () => {
  it('ranks basename matches before path fuzzy matches with stable depth and lexical ties', () => {
    const candidates: FlowerComposerReferenceCandidate[] = [
      { kind: 'file', label: 'domain.ts', path: '/workspace/src/domain.ts', relativeParent: 'src' },
      { kind: 'file', label: 'app-domain.ts', path: '/workspace/deep/app-domain.ts', relativeParent: 'deep' },
      { kind: 'file', label: 'do-main.ts', path: '/workspace/do-main.ts', relativeParent: '' },
      { kind: 'directory', label: 'domain', path: '/workspace/domain', relativeParent: '' },
    ];

    expect(rankFlowerComposerReferenceCandidates(candidates, 'domain', '/workspace', 10).map((item) => item.path))
      .toEqual([
        '/workspace/domain',
        '/workspace/src/domain.ts',
        '/workspace/deep/app-domain.ts',
        '/workspace/do-main.ts',
      ]);
  });
});
