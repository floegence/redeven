import { describe, expect, it } from 'vitest';

import { buildDesktopConfirmationPageURL } from './desktopConfirmation';
import {
  desktopConfirmationActionFromURL,
  isDesktopConfirmationActionURL,
  normalizeDesktopConfirmationDialogModel,
  type DesktopConfirmationDialogModel,
} from '../shared/desktopConfirmationContract';

const baseModel: DesktopConfirmationDialogModel = {
  title: 'Quit Redeven Desktop?',
  message: 'This will stop 2 Desktop-managed runtimes and close 1 environment window.',
  detail: '1 externally managed runtime will keep running.',
  confirm_label: 'Quit',
  cancel_label: 'Cancel',
  confirm_tone: 'danger',
};

describe('desktopConfirmation', () => {
  it('parses confirmation action URLs', () => {
    expect(isDesktopConfirmationActionURL('https://redeven-desktop.invalid/confirmation/confirm')).toBe(true);
    expect(isDesktopConfirmationActionURL('https://example.com/confirmation/confirm')).toBe(false);
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/confirm')).toBe('confirm');
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/cancel')).toBe('cancel');
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/unknown')).toBeNull();
  });

  it('normalizes the shared confirmation dialog contract', () => {
    expect(normalizeDesktopConfirmationDialogModel({
      title: ' Quit Redeven Desktop? ',
      message: ' This will stop 2 Desktop-managed runtimes. ',
      detail: '  ',
      confirm_label: ' Quit ',
      cancel_label: ' Cancel ',
      confirm_tone: 'warning',
    })).toEqual({
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes.',
      detail: '',
      confirm_label: 'Quit',
      cancel_label: 'Cancel',
      confirm_tone: 'warning',
    });
    expect(normalizeDesktopConfirmationDialogModel({ title: '', message: '', confirm_label: '', cancel_label: '' })).toBeNull();
  });

  it('builds the confirmation renderer URL with the theme and serialized model', () => {
    const rawURL = buildDesktopConfirmationPageURL({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
      model: baseModel,
      resolvedTheme: 'dark',
    });

    const url = new URL(rawURL);
    expect(url.protocol).toBe('file:');
    expect(url.pathname).toBe('/Applications/Redeven%20Desktop.app/Contents/Resources/app.asar/dist/confirmation/index.html');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(JSON.parse(String(url.searchParams.get('model') ?? 'null'))).toEqual(baseModel);
  });
});
