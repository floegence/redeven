import { afterEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: electronState.showMessageBox,
  },
}));

import {
  buildDesktopConfirmationMessageBoxOptions,
  showDesktopConfirmationDialog,
} from './desktopConfirmation';
import type { BrowserWindow } from 'electron';
import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';

const quitModel: DesktopConfirmationDialogModel = {
  title: 'Quit Redeven Desktop?',
  message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
  detail: '1 externally managed runtime will keep running.',
  confirm_label: 'Quit',
  cancel_label: 'Cancel',
  confirm_tone: 'danger',
};

describe('desktopConfirmation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds a macOS-native warning dialog that keeps quit semantics', () => {
    expect(buildDesktopConfirmationMessageBoxOptions({
      model: quitModel,
      platform: 'darwin',
    })).toEqual({
      type: 'warning',
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
      detail: '1 externally managed runtime will keep running.',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: false,
    });
  });

  it('adapts destructive quit dialogs to exit semantics on Windows', () => {
    expect(buildDesktopConfirmationMessageBoxOptions({
      model: quitModel,
      platform: 'win32',
    })).toEqual({
      type: 'warning',
      title: 'Exit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
      detail: '1 externally managed runtime will keep running.',
      buttons: ['Exit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  });

  it('keeps non-destructive close-window copy and omits empty detail lines', () => {
    expect(buildDesktopConfirmationMessageBoxOptions({
      model: {
        title: 'Close the Last Window?',
        message: 'The last window will close, but Redeven Desktop will keep running in the background.',
        detail: ' ',
        confirm_label: 'Close Window',
        cancel_label: 'Cancel',
        confirm_tone: 'warning',
      },
      platform: 'linux',
    })).toEqual({
      type: 'question',
      title: 'Close the Last Window?',
      message: 'The last window will close, but Redeven Desktop will keep running in the background.',
      detail: undefined,
      buttons: ['Close Window', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: false,
    });
  });

  it('uses a live parent window when available and resolves confirm from the primary action', async () => {
    const parentWindow = {
      isDestroyed: () => false,
    } as BrowserWindow;
    electronState.showMessageBox.mockResolvedValueOnce({
      response: 0,
      checkboxChecked: false,
    });

    await expect(showDesktopConfirmationDialog({
      model: quitModel,
      parentWindow,
      platform: 'darwin',
    })).resolves.toBe('confirm');

    expect(electronState.showMessageBox).toHaveBeenCalledWith(parentWindow, {
      type: 'warning',
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
      detail: '1 externally managed runtime will keep running.',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: false,
    });
  });

  it('falls back to an app-modal dialog when the parent window is gone and treats non-primary responses as cancel', async () => {
    const destroyedParent = {
      isDestroyed: () => true,
    } as BrowserWindow;
    electronState.showMessageBox.mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    });

    await expect(showDesktopConfirmationDialog({
      model: quitModel,
      parentWindow: destroyedParent,
      platform: 'win32',
    })).resolves.toBe('cancel');

    expect(electronState.showMessageBox).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Exit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
      detail: '1 externally managed runtime will keep running.',
      buttons: ['Exit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  });
});
