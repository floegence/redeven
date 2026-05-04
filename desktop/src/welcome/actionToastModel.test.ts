import { describe, expect, it } from 'vitest';

import {
  DESKTOP_ACTION_TOAST_LIMIT,
  queueDesktopActionToast,
} from './actionToastModel';

describe('actionToastModel', () => {
  it('ignores blank messages', () => {
    const current = [{ id: 1, tone: 'success' as const, message: 'Saved.' }];

    expect(queueDesktopActionToast({
      current,
      next: {
        id: 2,
        tone: 'info',
        message: '   ',
      },
    })).toEqual({
      toasts: current,
      active_toast: null,
      removed_toast_ids: [],
    });
  });

  it('replaces a visible duplicate so the latest toast keeps the message alive', () => {
    expect(queueDesktopActionToast({
      current: [
        {
          id: 1,
          tone: 'success',
          title: 'Updated',
          message: 'Saved.',
          action: {
            kind: 'reconnect_control_plane',
            label: 'Reconnect Provider',
            provider_origin: 'https://cp.example.invalid',
          },
          auto_dismiss: false,
        },
        { id: 2, tone: 'info', message: 'Copied.' },
      ],
      next: {
        id: 3,
        tone: 'success',
        title: 'Updated',
        message: 'Saved.',
        action: {
          kind: 'reconnect_control_plane',
          label: 'Reconnect Provider',
          provider_origin: 'https://cp.example.invalid',
        },
        auto_dismiss: false,
      },
    })).toEqual({
      toasts: [
        { id: 2, tone: 'info', message: 'Copied.' },
        {
          id: 3,
          tone: 'success',
          title: 'Updated',
          message: 'Saved.',
          action: {
            kind: 'reconnect_control_plane',
            label: 'Reconnect Provider',
            provider_origin: 'https://cp.example.invalid',
          },
          auto_dismiss: false,
        },
      ],
      active_toast: {
        id: 3,
        tone: 'success',
        title: 'Updated',
        message: 'Saved.',
        action: {
          kind: 'reconnect_control_plane',
          label: 'Reconnect Provider',
          provider_origin: 'https://cp.example.invalid',
        },
        auto_dismiss: false,
      },
      removed_toast_ids: [1],
    });
  });

  it('keeps only the most recent visible toasts within the viewport limit', () => {
    const current = Array.from({ length: DESKTOP_ACTION_TOAST_LIMIT }, (_value, index) => ({
      id: index + 1,
      tone: 'info' as const,
      message: `Toast ${index + 1}`,
    }));

    expect(queueDesktopActionToast({
      current,
      next: {
        id: DESKTOP_ACTION_TOAST_LIMIT + 1,
        tone: 'success',
        message: 'Newest',
      },
    })).toEqual({
      toasts: [
        { id: 2, tone: 'info', message: 'Toast 2' },
        { id: 3, tone: 'info', message: 'Toast 3' },
        { id: 4, tone: 'success', message: 'Newest' },
      ],
      active_toast: { id: 4, tone: 'success', message: 'Newest' },
      removed_toast_ids: [1],
    });
  });
});
