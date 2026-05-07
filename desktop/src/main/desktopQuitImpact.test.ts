import { describe, expect, it } from 'vitest';

import {
  buildDesktopLastWindowCloseConfirmationModel,
  buildDesktopQuitConfirmationModel,
  buildDesktopQuitImpact,
  shouldConfirmDesktopLastWindowClose,
  shouldConfirmDesktopQuit,
} from './desktopQuitImpact';

describe('desktopQuitImpact', () => {
  it('keeps only Desktop-owned runtimes in the destructive impact list', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 2,
      local_environment_runtime: { id: 'managed-b', label: 'Bravo', lifecycle_owner: 'desktop' },
      ssh_runtimes: [
        { id: 'ssh-a', label: 'SSH Lab', lifecycle_owner: 'external' },
      ],
    });

    expect(impact).toEqual({
      environment_window_count: 2,
      pending_operation_count: 0,
      desktop_owned_runtimes: [
        { id: 'managed-b', label: 'Bravo', kind: 'local_environment' },
      ],
      external_runtime_count: 1,
    });
  });

  it('requires confirmation for any quit path when Desktop-owned runtimes are active', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      local_environment_runtime: { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(true);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
  });

  it('keeps explicit and system quit confirmations for open environment windows without local runtime shutdown', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 2,
      local_environment_runtime: null,
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
  });

  it('avoids a confirmation when quitting has no active runtime or window impact', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      local_environment_runtime: null,
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(false);
  });

  it('treats pending background operations as quit and last-window-close impact', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      pending_operation_count: 2,
      local_environment_runtime: null,
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(true);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
    expect(buildDesktopQuitConfirmationModel(impact).message).toBe('This will cancel 2 background tasks.');
    expect(buildDesktopLastWindowCloseConfirmationModel(impact).message).toBe(
      'The last window will close, but 2 background tasks will keep running.',
    );
  });

  it('builds a structured quit confirmation model for runtime shutdown and open windows', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 2,
      local_environment_runtime: { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ssh_runtimes: [
        { id: 'ssh-a', label: 'SSH Lab', lifecycle_owner: 'external' },
        { id: 'ssh-b', label: 'Shared Bastion', lifecycle_owner: 'external' },
      ],
    }));

    expect(model).toEqual({
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 1 Desktop-managed runtime and close 2 environment windows.',
      detail: '2 externally managed runtimes will keep running.',
      confirm_label: 'Quit',
      cancel_label: 'Cancel',
      confirm_tone: 'danger',
    });
  });

  it('keeps long runtime-only quit models concise', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 0,
      local_environment_runtime: { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ssh_runtimes: [
        { id: 'ssh-b', label: 'Bravo', lifecycle_owner: 'desktop' },
        { id: 'ssh-c', label: 'Charlie', lifecycle_owner: 'desktop' },
        { id: 'ssh-d', label: 'Delta', lifecycle_owner: 'desktop' },
        { id: 'ssh-e', label: 'Echo', lifecycle_owner: 'desktop' },
      ],
    }));

    expect(model).toEqual({
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 5 Desktop-managed runtimes.',
      detail: '',
      confirm_label: 'Quit',
      cancel_label: 'Cancel',
      confirm_tone: 'danger',
    });
  });

  it('builds a macOS last-window-close confirmation model that preserves close semantics', () => {
    const model = buildDesktopLastWindowCloseConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      local_environment_runtime: { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ssh_runtimes: [],
    }));

    expect(model).toEqual({
      title: 'Close the Last Window?',
      message: 'The last window will close, but 1 Desktop-managed runtime will keep running in the background.',
      detail: 'Reopen the launcher from the Dock or app menu.',
      confirm_label: 'Close Window',
      cancel_label: 'Cancel',
      confirm_tone: 'warning',
    });
  });

  it('keeps the macOS last-window-close model concise when only the window disappears', () => {
    const model = buildDesktopLastWindowCloseConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      local_environment_runtime: null,
      ssh_runtimes: [],
    }));

    expect(model).toEqual({
      title: 'Close the Last Window?',
      message: 'The last window will close, but Redeven Desktop will keep running in the background.',
      detail: 'Reopen the launcher from the Dock or app menu.',
      confirm_label: 'Close Window',
      cancel_label: 'Cancel',
      confirm_tone: 'warning',
    });
  });
});
