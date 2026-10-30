import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useEnvFilesystemPicker } from './filesystemPicker';
import { filesystemPickerEnUS } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';

const { mkdir, identity, session, invalidations } = vi.hoisted(() => {
  const identity = {};
  return { mkdir: vi.fn(), identity, session: vi.fn((): object | undefined => identity), invalidations: vi.fn() };
});
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { mkdir } }) }));
vi.mock('./directoryFavorites', () => ({ useEnvDirectoryFavorites: () => ({ copy: { ...filesystemPickerEnUS, selectedCount: (count: number) => String(count) } }) }));
vi.mock('./gitWorkspaceRuntime', () => ({ executeWorkspaceEffect: async ({ clientIdentity, effect }: { clientIdentity: object; effect: () => Promise<unknown> }) => {
  invalidations(clientIdentity); return effect();
} }));

describe('shared Env App picker creation', () => {
  it('uses one nonrecursive write under the current workspace identity', async () => {
    await createRoot(async dispose => {
      const picker = useEnvFilesystemPicker();
      mkdir.mockResolvedValueOnce({ success: true });
      await picker.onCreateFolder!('/srv/project', 'new folder');
      expect(mkdir).toHaveBeenCalledExactlyOnceWith({ path: '/srv/project/new folder', createParents: false });
      expect(invalidations).toHaveBeenCalledExactlyOnceWith(identity);
      mkdir.mockRejectedValueOnce({ code: 409 });
      let failure: unknown;
      try { await picker.onCreateFolder!('/srv/project', 'new folder'); } catch (error) { failure = error; }
      expect(picker.formatError!(failure)).toBe(filesystemPickerEnUS.folderExists);
      expect(mkdir).toHaveBeenCalledTimes(2);
      session.mockReturnValueOnce(undefined);
      await expect(picker.onCreateFolder!('/srv/project', 'offline')).rejects.toThrow();
      expect(mkdir).toHaveBeenCalledTimes(2);
      dispose();
    });
  });
});
