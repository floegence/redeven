import { describe, expect, it, vi } from 'vitest';

import type { ManagedRuntime } from './runtimeProcess';
import { desktopSessionRuntimeHandleFromManagedRuntime } from './sessionRuntime';

function managedRuntime(attached: boolean, stop: () => Promise<void>): ManagedRuntime {
  return {
    child: null,
    startup: {
      local_ui_url: 'http://localhost:23998/',
      local_ui_urls: ['http://localhost:23998/'],
    },
    reportDir: null,
    reportFile: null,
    attached,
    stop,
  };
}

describe('sessionRuntime', () => {
  it('records spawned runtimes without projecting lifecycle ownership', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handle = desktopSessionRuntimeHandleFromManagedRuntime(managedRuntime(false, stop));

    expect(handle).toMatchObject({
      runtime_kind: 'local_environment',
      launch_mode: 'spawned',
    });
    expect(handle).not.toHaveProperty('lifecycle_owner');
    await handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit stop control for attached runtimes', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handle = desktopSessionRuntimeHandleFromManagedRuntime(managedRuntime(true, stop));

    expect(handle).toMatchObject({
      runtime_kind: 'local_environment',
      launch_mode: 'attached',
    });
    expect(handle).not.toHaveProperty('lifecycle_owner');
    await handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
