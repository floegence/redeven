import { describe, expect, it, vi } from 'vitest';

import type { ManagedRuntime } from './runtimeProcess';
import {
  desktopSessionRuntimeHandleFromManagedRuntime,
  resolveManagedRuntimeLifecycleOwner,
} from './sessionRuntime';

describe('sessionRuntime', () => {
  it('classifies non-attached managed runtimes as desktop-owned', () => {
    expect(resolveManagedRuntimeLifecycleOwner({
      local_ui_url: 'http://localhost:23998/',
      local_ui_urls: ['http://localhost:23998/'],
      desktop_managed: false,
    }, {
      attached: false,
      persistedOwner: 'agent',
    })).toBe('desktop');
  });

  it('treats attached non-desktop-managed runtimes as external even if the catalog says desktop', () => {
    expect(resolveManagedRuntimeLifecycleOwner({
      local_ui_url: 'http://localhost:23998/',
      local_ui_urls: ['http://localhost:23998/'],
      desktop_managed: false,
    }, {
      attached: true,
      persistedOwner: 'desktop',
    })).toBe('external');
  });

  it('falls back to the persisted local owner when attached startup reports predate desktop_managed', () => {
    expect(resolveManagedRuntimeLifecycleOwner({
      local_ui_url: 'http://localhost:23998/',
      local_ui_urls: ['http://localhost:23998/'],
    }, {
      attached: true,
      persistedOwner: 'desktop',
    })).toBe('desktop');
    expect(resolveManagedRuntimeLifecycleOwner({
      local_ui_url: 'http://localhost:23998/',
      local_ui_urls: ['http://localhost:23998/'],
    }, {
      attached: true,
      persistedOwner: 'unknown',
    })).toBe('external');
  });

  it('detaches from external attached runtimes without stopping their host process', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const runtime: ManagedRuntime = {
      child: null,
      startup: {
        local_ui_url: 'http://localhost:23998/',
        local_ui_urls: ['http://localhost:23998/'],
        desktop_managed: false,
      },
      reportDir: null,
      reportFile: null,
      attached: true,
      stop,
    };

    const handle = desktopSessionRuntimeHandleFromManagedRuntime(runtime, {
      persistedOwner: 'agent',
    });

    expect(handle.runtime_kind).toBe('local_environment');
    expect(handle.lifecycle_owner).toBe('external');
    expect(handle.launch_mode).toBe('attached');

    await handle.stop();
    expect(stop).not.toHaveBeenCalled();
  });

  it('preserves stop control for attached runtimes leased to this Desktop', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const runtime: ManagedRuntime = {
      child: null,
      startup: {
        local_ui_url: 'http://localhost:23998/',
        local_ui_urls: ['http://localhost:23998/'],
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner-1',
      },
      reportDir: null,
      reportFile: null,
      attached: true,
      stop,
    };

    const handle = desktopSessionRuntimeHandleFromManagedRuntime(runtime, {
      persistedOwner: 'agent',
      desktopOwnerID: 'desktop-owner-1',
    });

    expect(handle.lifecycle_owner).toBe('desktop');

    await handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('detaches from attached Desktop-managed runtimes leased to another Desktop', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const runtime: ManagedRuntime = {
      child: null,
      startup: {
        local_ui_url: 'http://localhost:23998/',
        local_ui_urls: ['http://localhost:23998/'],
        desktop_managed: true,
        desktop_owner_id: 'other-desktop-owner',
      },
      reportDir: null,
      reportFile: null,
      attached: true,
      stop,
    };

    const handle = desktopSessionRuntimeHandleFromManagedRuntime(runtime, {
      persistedOwner: 'desktop',
      desktopOwnerID: 'desktop-owner-1',
    });

    expect(handle.lifecycle_owner).toBe('external');

    await handle.stop();
    expect(stop).not.toHaveBeenCalled();
  });
});
