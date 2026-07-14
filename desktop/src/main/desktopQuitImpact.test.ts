import { describe, expect, it } from 'vitest';

import {
  buildDesktopLastWindowCloseConfirmationModel,
  buildDesktopQuitConfirmationModel,
  buildDesktopQuitImpact,
  shouldConfirmDesktopLastWindowClose,
  shouldConfirmDesktopQuit,
} from './desktopQuitImpact';

describe('desktopQuitImpact', () => {
  it('does not treat running runtimes as destructive quit impact', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      running_runtime_count: 2,
    });

    expect(impact).toEqual({
      environment_window_count: 0,
      pending_operation_count: 0,
      running_runtime_count: 2,
    });
    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(false);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(false);
  });

  it('keeps explicit and system quit confirmations for open environment windows', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 2,
      running_runtime_count: 1,
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(false);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
  });

  it('treats pending background operations as quit and last-window-close impact', () => {
    const impact = buildDesktopQuitImpact({
      environment_window_count: 0,
      pending_operation_count: 2,
      running_runtime_count: 1,
    });

    expect(shouldConfirmDesktopQuit(impact, 'explicit')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'system')).toBe(true);
    expect(shouldConfirmDesktopQuit(impact, 'last_window_close')).toBe(true);
    expect(shouldConfirmDesktopLastWindowClose(impact)).toBe(true);
    expect(buildDesktopQuitConfirmationModel(impact).message).toBe('This will cancel 2 background tasks.');
    expect(buildDesktopQuitConfirmationModel(impact).detail).toBe('1 runtime process will keep running.');
    expect(buildDesktopLastWindowCloseConfirmationModel(impact).message).toBe(
      'The last window will close, but 2 background tasks will keep running.',
    );
  });

  it('builds a structured quit confirmation model without runtime shutdown copy', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 2,
      pending_operation_count: 1,
      running_runtime_count: 3,
    }));

    expect(model).toEqual({
      title: 'Quit Redeven Desktop?',
      message: 'This will close 2 environment windows and cancel 1 background task.',
      detail: '3 runtime processes will keep running.',
      confirm_label: 'Quit',
      cancel_label: 'Cancel',
      confirm_tone: 'danger',
      platform_action: 'quit_app',
      platform_title: 'Exit Redeven Desktop?',
      platform_confirm_label: 'Exit',
    });
  });

  it('builds a macOS last-window-close confirmation model that preserves close semantics', () => {
    const model = buildDesktopLastWindowCloseConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      running_runtime_count: 1,
    }));

    expect(model).toEqual({
      title: 'Close the Last Window?',
      message: 'The last window will close, but Redeven Desktop will keep running in the background.',
      detail: '1 runtime process will keep running. Reopen the launcher from the Dock or app menu.',
      confirm_label: 'Close Window',
      cancel_label: 'Cancel',
      confirm_tone: 'warning',
    });
  });

  it('localizes quit confirmations for the selected Desktop language', () => {
    const model = buildDesktopQuitConfirmationModel(buildDesktopQuitImpact({
      environment_window_count: 1,
      pending_operation_count: 2,
      running_runtime_count: 1,
    }), 'zh-CN');

    expect(model).toMatchObject({
      title: '退出 Redeven Desktop？',
      message: '这将关闭 1 个环境窗口和取消 2 个后台任务。',
      detail: '1 个运行时进程会继续运行。',
      confirm_label: '退出',
      cancel_label: '取消',
      platform_title: '退出 Redeven Desktop？',
      platform_confirm_label: '退出',
    });
  });
});
