import { describe, expect, it } from 'vitest';

import { loadDesktopConfirmationPageState } from './pageState';

describe('confirmation pageState', () => {
  it('parses a valid confirmation model from the query string', () => {
    const state = loadDesktopConfirmationPageState(`?theme=dark&model=${encodeURIComponent(JSON.stringify({
      title: 'Quit Redeven Desktop?',
      message: 'This will stop 2 Desktop-managed runtimes.',
      detail: '1 externally managed runtime will keep running.',
      confirm_label: 'Quit',
      cancel_label: 'Cancel',
      confirm_tone: 'danger',
    }))}`);

    expect(state).toEqual({
      model: {
        title: 'Quit Redeven Desktop?',
        message: 'This will stop 2 Desktop-managed runtimes.',
        detail: '1 externally managed runtime will keep running.',
        confirm_label: 'Quit',
        cancel_label: 'Cancel',
        confirm_tone: 'danger',
      },
      resolvedTheme: 'dark',
    });
  });

  it('falls back to a light theme and null model when the query is invalid', () => {
    expect(loadDesktopConfirmationPageState('?theme=unknown&model={oops')).toEqual({
      model: null,
      resolvedTheme: 'light',
    });
  });
});
