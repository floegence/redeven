import { describe, expect, it } from 'vitest';

import {
  buildDesktopConfirmationPageHTML,
  desktopConfirmationActionFromURL,
  isDesktopConfirmationActionURL,
  type DesktopConfirmationDialogModel,
} from './desktopConfirmation';

const baseModel: DesktopConfirmationDialogModel = {
  title: 'Quit Redeven Desktop?',
  eyebrow: 'Redeven Desktop',
  heading: 'Quit Redeven Desktop?',
  message: 'Quitting now will stop 2 Desktop-managed runtimes and close 1 environment window.',
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
      value: '1',
      label: 'Window to close',
      detail: 'Every open environment window closes immediately.',
      tone: 'warning',
    },
  ],
  runtime_section_title: 'Affected environments',
  runtime_section_body: 'Stopping these runtimes may make the environments unavailable from this machine until Redeven Desktop starts them again.',
  runtime_preview: [
    { label: 'Alpha', badge: 'Managed Environment' },
    { label: 'SSH Lab', badge: 'SSH Host' },
  ],
  runtime_overflow_count: 1,
  callout: {
    eyebrow: 'Access impact',
    body: 'This machine may stop serving the affected environments until Redeven Desktop starts those runtimes again.',
    tone: 'warning',
  },
  footnote: 'Press Esc to cancel, or Cmd/Ctrl+Enter to quit Desktop.',
};

describe('desktopConfirmation', () => {
  it('parses confirmation action URLs', () => {
    expect(isDesktopConfirmationActionURL('https://redeven-desktop.invalid/confirmation/confirm')).toBe(true);
    expect(isDesktopConfirmationActionURL('https://example.com/confirmation/confirm')).toBe(false);
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/confirm')).toBe('confirm');
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/cancel')).toBe('cancel');
    expect(desktopConfirmationActionFromURL('https://redeven-desktop.invalid/confirmation/unknown')).toBeNull();
  });

  it('renders a wide structured confirmation page with runtime context and keyboard guidance', () => {
    const html = buildDesktopConfirmationPageHTML(baseModel, 'light', 'darwin');

    expect(html).toContain('width: min(760px, 100%);');
    expect(html).toContain('Runtime impact');
    expect(html).toContain('Affected environments');
    expect(html).toContain('1 more environment');
    expect(html).toContain('button-confirm-danger');
    expect(html).toContain('Press Esc to cancel, or Cmd/Ctrl+Enter to quit Desktop.');
    expect(html).toContain('window.location.href = confirmButton.href;');
  });

  it('switches the page chrome to dark mode when the resolved theme is dark', () => {
    const html = buildDesktopConfirmationPageHTML(baseModel, 'dark', 'linux');

    expect(html).toContain('color-scheme: dark;');
    expect(html).toContain('background:\n          radial-gradient');
    expect(html).toContain('body data-tone="danger"');
  });
});
