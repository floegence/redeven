// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  desktopLocalEnvironmentStorageScopeID,
  notifyDesktopSessionAppReady,
  readDesktopSessionContextSnapshot,
  resolveEnvironmentStorageScopeID,
} from './desktopSessionContext';

const originalParent = window.parent;
const originalTop = window.top;

function setWindowHierarchy(parent: Window, top: Window = parent): void {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: top,
  });
}

afterEach(() => {
  delete window.redevenDesktopSessionContext;
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
});

describe('desktopSessionContext', () => {
  it('reads desktop session context from a same-origin parent window', () => {
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
          environment_storage_scope_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
        }),
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(readDesktopSessionContextSnapshot()).toEqual({
      local_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      environment_storage_scope_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    });
    expect(desktopLocalEnvironmentStorageScopeID()).toBe('cp:https%3A%2F%2Fcp.example.invalid:env:env_demo');
  });

  it('falls back to the provided scope id when no desktop session context exists', () => {
    expect(readDesktopSessionContextSnapshot()).toBeNull();
    expect(desktopLocalEnvironmentStorageScopeID()).toBe('');
    expect(resolveEnvironmentStorageScopeID('env_demo')).toBe('env_demo');
  });

  it('notifies Desktop when the environment app becomes interactive', () => {
    const readyStates: string[] = [];
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'env_demo',
          environment_storage_scope_id: 'env_demo',
        }),
        notifyAppReady: (payload: { state: string }) => {
          readyStates.push(payload.state);
        },
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(notifyDesktopSessionAppReady('access_gate_interactive')).toBe(true);
    expect(notifyDesktopSessionAppReady('runtime_connected')).toBe(true);
    expect(readyStates).toEqual(['access_gate_interactive', 'runtime_connected']);
  });
});
