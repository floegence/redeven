import { filesystemPickerEnUS } from '../i18n/filesystemPickerMessages';
import { describe, expect, it, vi } from 'vitest';
import { createFilesystemPickerDirectory, formatFilesystemPickerError, classifyFilesystemPathError, mapFilesystemPickerContext, mapFilesystemPickerEntries } from './filesystemPicker';

describe('runtime filesystem picker adapter', () => {
  it('creates one child path and rejects traversal before reaching the filesystem', async () => {
    const create = vi.fn(async (_path: string) => {});
    await createFilesystemPickerDirectory('/', 'new project', create);
    await createFilesystemPickerDirectory('/home/alice', '.private', create);
    expect(create.mock.calls).toEqual([['/new project'], ['/home/alice/.private']]);
    for (const name of ['', '.', '..', '../escape', '/absolute', 'a/b', String.fromCharCode(0)]) {
      await expect(createFilesystemPickerDirectory('/home/alice', name, create)).rejects.toThrow();
    }
    expect(create).toHaveBeenCalledTimes(2);
  });
  it.each([[409, 'folderExists'], [403, 'createDenied'], [400, 'folderNameInvalid'], [500, 'createFailed'], [undefined, 'createFailed']])('localizes creation status %s without retrying', async (code, key) => {
    const create = vi.fn(async () => { throw { status: code }; });
    let failure: unknown;
    try { await createFilesystemPickerDirectory('/home/alice', 'project', create); } catch (error) { failure = error; }
    const copy = { ...filesystemPickerEnUS, selectedCount: (count: number) => String(count) };
    expect(formatFilesystemPickerError(failure, copy)).toBe(copy[key as keyof typeof copy]);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('keeps system location labels current without changing the loaded context', () => {
    let copy = { home: 'Home', root: 'Root' };
    const context = mapFilesystemPickerContext({ homePathAbs: '/Users/alice', defaultRootId: 'home', roots: [
      { id: 'home', pathAbs: '/Users/alice', label: 'Server home', kind: 'home' },
      { id: 'computer', pathAbs: '/', label: 'Server root', kind: 'computer' },
      { id: 'project', pathAbs: '/srv/project', label: 'Project', kind: 'custom' },
    ] }, () => copy);
    copy = { home: '主目录', root: '根目录' };
    expect(context.roots.map(root => root.label)).toEqual(['主目录', '根目录', 'Project']);
    copy = { home: 'Home', root: 'Root' };
    expect(context.roots.map(root => root.label)).toEqual(['Home', 'Root', 'Project']);
  });
  it('preserves declared roots and permissions without inferring Home or Root', () => {
    const context = mapFilesystemPickerContext({ homePathAbs: '/Users/alice', defaultRootId: 'project', roots: [
      { id: 'project', pathAbs: '/srv/project', label: 'Project', kind: 'custom', permissions: { read: true, write: false } },
    ] }, () => ({ home: 'Home', root: 'Root' }));
    expect(context.roots).toEqual([{ id: 'project', pathAbs: '/srv/project', label: 'Project', kind: 'custom', permissions: { read: true, write: false } }]);
    expect(context.defaultRootId).toBe('project');
  });
  it('localizes only system location labels and preserves absolute entry identities', () => {
    const context = mapFilesystemPickerContext({ homePathAbs: '/Users/alice', defaultRootId: 'home', roots: [
      { id: 'computer', pathAbs: '/', label: 'Computer', kind: 'computer', permissions: { read: true, write: false } },
      { id: 'home', pathAbs: '/Users/alice', label: 'Home', kind: 'home', permissions: { read: true, write: true } },
    ] }, () => ({ home: '主目录', root: '根目录' }));
    expect(context.roots.map((root) => [root.label, root.pathAbs])).toEqual([['主目录', '/Users/alice'], ['根目录', '/']]);
    const items = mapFilesystemPickerEntries([{ name: 'project', path: '/Volumes/team/project', isDirectory: true, entryType: 'symlink', resolvedType: 'folder' }]);
    expect(items[0]).toMatchObject({ id: '/Volumes/team/project', path: '/Volumes/team/project', type: 'folder' });
  });
  it.each([
    [{ code: 403, message: 'path outside filesystem scope' }, 'outside_scope'],
    [{ status: 403, message: 'host filesystem permission denied' }, 'host_permission_denied'],
    [{ code: 403, message: 'read permission denied' }, 'permission_denied'],
    [{ status: 404, message: 'not found' }, 'not_found'],
    [{ code: 400, message: 'path is not a directory' }, 'not_directory'],
    [{ status: 400, message: 'invalid path' }, 'invalid_path'],
    [new Error('network disconnected'), 'transport_error'],
  ])('preserves the runtime failure category for %j', (error, kind) => {
    expect(classifyFilesystemPathError(error)).toBe(kind);
  });
});
