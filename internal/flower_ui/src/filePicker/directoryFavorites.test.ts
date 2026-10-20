import { describe, expect, it, vi } from 'vitest';
import { createDirectoryFavoritesClient, directoryFavoriteAction, type DirectoryFavoritesSnapshot } from './directoryFavorites';

describe('directory favorite client', () => {
  it('shares successful item mutations and rejects older read snapshots', async () => {
    let resolveRead!: (snapshot: DirectoryFavoritesSnapshot) => void;
    const request = vi.fn(async (method: string) => method === 'GET'
      ? new Promise<DirectoryFavoritesSnapshot>(resolve => { resolveRead = resolve; })
      : { paths: ['/project'], revision: 2 });
    const client = createDirectoryFavoritesClient(request);
    const one = client.view(() => 'Failed'); const two = client.view(() => 'Failed');
    const read = client.refresh();
    await one.onSetFavorite!('/project', true);
    expect(two.paths).toEqual(['/project']);
    resolveRead({ paths: [], revision: 1 }); await read;
    expect(one.paths).toEqual(['/project']); client.dispose();
  });
  it('preserves snapshots on refresh failure and clears every consumer on scope disposal', async () => {
    const request = vi.fn().mockResolvedValueOnce({ paths: ['/retained'], revision: 1 }).mockRejectedValueOnce(new Error('offline'));
    const client = createDirectoryFavoritesClient(request); const view = client.view(() => 'Retry favorites');
    await client.refresh(); await client.refresh();
    expect(view.paths).toEqual(['/retained']); expect(view.error).toBe('Retry favorites');
    client.dispose(); expect(view.paths).toEqual([]); expect(view.editable).toBe(false);
    await expect(view.onSetFavorite!('/blocked', true)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('fences stale responses and captures menu path and client before selection changes', async () => {
    let resolve!: (snapshot: DirectoryFavoritesSnapshot) => void;
    const request = vi.fn(() => new Promise<DirectoryFavoritesSnapshot>(done => { resolve = done; }));
    const client = createDirectoryFavoritesClient(request); const view = client.view(() => 'Failed');
    const read = client.refresh(); client.dispose(); resolve({ paths: ['/old-user'], revision: 10 }); await read;
    expect(view.paths).toEqual([]);
    const set = vi.fn(async () => {});
    const action = directoryFavoriteAction('/captured', { paths: [], editable: true, onSetFavorite: set }, { favoriteDirectory: 'Add', unfavoriteDirectory: 'Remove' }, vi.fn());
    action!.run(); expect(set).toHaveBeenCalledWith('/captured', true);
  });
  it('blocks repeated item submissions while keeping failed mutations unchanged', async () => {
    let reject!: (error: Error) => void;
    const request = vi.fn(() => new Promise<DirectoryFavoritesSnapshot>((_, fail) => { reject = fail; }));
    const client = createDirectoryFavoritesClient(request); const view = client.view(() => 'Failed');
    const first = client.setFavorite('/a', true); await client.setFavorite('/a', true);
    expect(request).toHaveBeenCalledTimes(1); expect(view.pendingPaths).toEqual(['/a']);
    reject(new Error('Denied')); await expect(first).rejects.toThrow('Denied');
    expect(view.paths).toEqual([]); expect(view.pendingPaths).toEqual([]); client.dispose();
  });
  it('retires in-flight mutations without surfacing an old environment error', async () => {
    let reject!: (error: Error) => void;
    const client = createDirectoryFavoritesClient(() => new Promise((_, fail) => {reject=fail;}));
    const view = client.view(() => 'Failure');
    const pending = view.onSetFavorite!('/old',true);
    client.dispose(); reject(new DOMException('Retired','AbortError'));
    await pending;
    expect(view.paths).toEqual([]);expect(view.pendingPaths).toEqual([]);
    await expect(view.onSetFavorite!('/late',true)).rejects.toMatchObject({name:'AbortError'});
  });

});
