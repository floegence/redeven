import { describe, expect, it } from 'vitest';

import {
  buildDesktopQuitDialogCopy,
  buildDesktopQuitImpact,
  shouldConfirmDesktopQuit,
} from './desktopQuitImpact';

describe('desktopQuitImpact', () => {
  it('keeps only Desktop-owned runtimes in the destructive impact list', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 2,
      managed_environment_runtimes: [
        { id: 'managed-b', label: 'Bravo', lifecycle_owner: 'desktop' },
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'external' },
      ],
      ssh_runtimes: [
        { id: 'ssh-a', label: 'SSH Lab', lifecycle_owner: 'desktop' },
      ],
    });

    expect(impact).toEqual({
      environment_window_count: 2,
      desktop_owned_runtimes: [
        { id: 'managed-b', label: 'Bravo', kind: 'managed_environment' },
        { id: 'ssh-a', label: 'SSH Lab', kind: 'ssh_environment' },
      ],
      external_runtime_count: 1,
    });
  });

  it('requires confirmation for any quit path when Desktop-owned runtimes are active', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      managed_environment_runtimes: [
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ],
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(true);
  });

  it('keeps explicit and system quit confirmations for open environment windows without local runtime shutdown', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 2,
      managed_environment_runtimes: [],
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
  });

  it('avoids a confirmation when quitting has no active runtime or window impact', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      managed_environment_runtimes: [],
      ssh_runtimes: [],
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
  });

  it('builds impact-aware dialog copy for runtime shutdown and open windows', () => {
    const copy = buildDesktopQuitDialogCopy(buildDesktopQuitImpact({
      environment_window_count: 2,
      managed_environment_runtimes: [
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ],
      ssh_runtimes: [
        { id: 'ssh-a', label: 'SSH Lab', lifecycle_owner: 'desktop' },
      ],
    }));

    expect(copy).toEqual({
      title: 'Quit Redeven Desktop?',
      message: 'Quit Redeven Desktop?',
      detail: [
        'Quitting now will stop 2 Desktop-managed runtimes and close 2 environment windows.',
        '',
        'These environments may become unavailable from this machine until Redeven Desktop starts them again:',
        '- Alpha',
        '- SSH Lab',
      ].join('\n'),
      buttons: ['Cancel', 'Quit'],
      default_id: 1,
      cancel_id: 0,
    });
  });

  it('summarizes long environment lists without dropping the risk statement', () => {
    const copy = buildDesktopQuitDialogCopy(buildDesktopQuitImpact({
      environment_window_count: 0,
      managed_environment_runtimes: [
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
        { id: 'managed-b', label: 'Bravo', lifecycle_owner: 'desktop' },
        { id: 'managed-c', label: 'Charlie', lifecycle_owner: 'desktop' },
        { id: 'managed-d', label: 'Delta', lifecycle_owner: 'desktop' },
        { id: 'managed-e', label: 'Echo', lifecycle_owner: 'desktop' },
      ],
      ssh_runtimes: [],
    }));

    expect(copy.detail).toContain('Quitting now will stop 5 Desktop-managed runtimes.');
    expect(copy.detail).toContain('- Alpha');
    expect(copy.detail).toContain('- Delta');
    expect(copy.detail).toContain('- 1 more environment');
  });
});
