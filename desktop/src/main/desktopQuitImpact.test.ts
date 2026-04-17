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
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
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
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
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
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(false);
  });

  it('builds a structured quit confirmation model for runtime shutdown and open windows', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 2,
      managed_environment_runtimes: [
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ],
      ssh_runtimes: [
        { id: 'ssh-a', label: 'SSH Lab', lifecycle_owner: 'desktop' },
        { id: 'ssh-b', label: 'Shared Bastion', lifecycle_owner: 'external' },
      ],
    }));

    expect(model).toEqual({
      title: 'Quit Redeven Desktop?',
      eyebrow: 'Redeven Desktop',
      heading: 'Quit Redeven Desktop?',
      message: 'Quitting now will stop 2 Desktop-managed runtimes and close 2 environment windows.',
      impact_label: 'Runtime impact',
      confirm_label: 'Quit Desktop',
      cancel_label: 'Keep Running',
      confirm_tone: 'danger',
      summary_items: [
        {
          value: '2',
          label: 'Runtimes to stop',
          detail: 'Desktop-owned runtimes shut down with the app.',
          tone: 'danger',
        },
        {
          value: '2',
          label: 'Windows to close',
          detail: 'Every open environment window closes immediately.',
          tone: 'warning',
        },
        {
          value: '1',
          label: 'Runtime unchanged',
          detail: 'Externally managed runtimes keep their current state.',
          tone: 'success',
        },
      ],
      runtime_section_title: 'Affected environments',
      runtime_section_body: 'Stopping these Desktop-managed runtimes may make the following environments unavailable from this machine until Redeven Desktop starts them again.',
      runtime_preview: [
        { label: 'Alpha', badge: 'Managed Environment' },
        { label: 'SSH Lab', badge: 'SSH Host' },
      ],
      runtime_overflow_count: 0,
      callout: {
        eyebrow: 'Access impact',
        body: 'This machine may stop serving the affected environments until Redeven Desktop starts those runtimes again.',
        tone: 'warning',
      },
      footnote: 'Press Esc to cancel, or Cmd/Ctrl+Enter to quit Desktop.',
    });
  });

  it('summarizes long environment lists without dropping the runtime risk context', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
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

    expect(model.message).toBe('Quitting now will stop 5 Desktop-managed runtimes.');
    expect(model.runtime_preview).toEqual([
      { label: 'Alpha', badge: 'Managed Environment' },
      { label: 'Bravo', badge: 'Managed Environment' },
      { label: 'Charlie', badge: 'Managed Environment' },
      { label: 'Delta', badge: 'Managed Environment' },
    ]);
    expect(model.runtime_overflow_count).toBe(1);
    expect(model.callout?.body).toContain('This machine may stop serving the affected environments');
  });

  it('builds a macOS last-window-close confirmation model that preserves close semantics', () => {
    const model = buildDesktopLastWindowCloseConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      managed_environment_runtimes: [
        { id: 'managed-a', label: 'Alpha', lifecycle_owner: 'desktop' },
      ],
      ssh_runtimes: [],
    }));

    expect(model).toEqual({
      title: 'Close the Last Window?',
      eyebrow: 'Redeven Desktop',
      heading: 'Close the Last Window?',
      message: 'Closing the last window will close 1 environment window and keep 1 Desktop-managed runtime running in the background. Redeven Desktop will stay open.',
      impact_label: 'Background activity',
      confirm_label: 'Close Window',
      cancel_label: 'Keep Window Open',
      confirm_tone: 'warning',
      summary_items: [
        {
          value: '1',
          label: 'Window to close',
          detail: 'The final visible Desktop surface will disappear.',
          tone: 'warning',
        },
        {
          value: '1',
          label: 'Runtime left running',
          detail: 'Desktop-managed runtimes continue in the background.',
          tone: 'success',
        },
      ],
      runtime_section_title: 'Still running after the window closes',
      runtime_section_body: 'This environment will keep running until you quit Redeven Desktop.',
      runtime_preview: [
        { label: 'Alpha', badge: 'Managed Environment' },
      ],
      runtime_overflow_count: 0,
      callout: {
        eyebrow: 'Reopen later',
        body: 'Redeven Desktop stays active after the final macOS window closes. Reopen the launcher from the Dock or the Redeven Desktop app menu.',
        tone: 'info',
      },
      footnote: 'Press Esc to keep the window open, or Cmd/Ctrl+Enter to close it.',
    });
  });

  it('keeps the macOS last-window-close model concise when only the environment window disappears', () => {
    const model = buildDesktopLastWindowCloseConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      managed_environment_runtimes: [],
      ssh_runtimes: [],
    }));

    expect(model.message).toBe('Closing the last window will close 1 environment window. Redeven Desktop will stay open.');
    expect(model.runtime_section_title).toBeUndefined();
    expect(model.runtime_preview).toEqual([]);
    expect(model.summary_items).toEqual([
      {
        value: '1',
        label: 'Window to close',
        detail: 'The final visible Desktop surface will disappear.',
        tone: 'warning',
      },
      {
        value: '0',
        label: 'Runtimes left running',
        detail: 'No Desktop-managed runtime continues in the background.',
        tone: 'neutral',
      },
    ]);
  });
});
