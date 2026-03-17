import { describe, expect, it } from 'vitest';

import { resolveDesktopManagedAgentState } from './desktopManagedAgent';

describe('desktopManagedAgent', () => {
  it('returns the desktop-managed message from the local runtime when present', () => {
    expect(resolveDesktopManagedAgentState({
      latest_version: 'v1.2.3',
      desktop_managed: true,
      message: 'Managed by Redeven Desktop.',
    })).toEqual({
      desktopManaged: true,
      message: 'Managed by Redeven Desktop.',
    });
  });

  it('falls back to the default desktop-managed message', () => {
    expect(resolveDesktopManagedAgentState({
      latest_version: 'v1.2.3',
      desktop_managed: true,
    })).toEqual({
      desktopManaged: true,
      message: 'Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade.',
    });
  });

  it('keeps standard local runtimes updateable', () => {
    expect(resolveDesktopManagedAgentState({
      latest_version: 'v1.2.3',
    })).toEqual({
      desktopManaged: false,
      message: '',
    });
  });
});
