import { describe, expect, it } from 'vitest';

import {
  blockedActionFromURL,
  buildBlockedPageHTML,
  isBlockedActionURL,
} from './blockedPage';

describe('blockedPage', () => {
  it('renders the non-local-ui blocked explanation', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven agent is already using this state directory.',
      lock_owner: {
        mode: 'remote',
        local_ui_enabled: false,
      },
      diagnostics: {
        state_dir: '/Users/tester/.redeven',
      },
    }, 'linux');

    expect(html).toContain('Redeven is already running');
    expect(html).toContain('without an attachable Local UI');
    expect(html).toContain('Default state directory: /Users/tester/.redeven');
    expect(html).toContain('Settings');
    expect(html).not.toContain('gradient');
    expect(html).toContain('env(titlebar-area-height, 0px)');
  });

  it('renders the local-ui-enabled blocked explanation', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven agent is already using this state directory.',
      lock_owner: {
        mode: 'hybrid',
        local_ui_enabled: true,
      },
    }, 'darwin');

    expect(html).toContain('Redeven is already starting elsewhere');
    expect(html).toContain('appears to provide Local UI');
    expect(html).toContain('calc(24px + 0px)');
    expect(html).not.toContain('env(titlebar-area-height, 0px)');
  });

  it('recognizes blocked page action urls', () => {
    expect(isBlockedActionURL('https://redeven-desktop.invalid/retry')).toBe(true);
    expect(blockedActionFromURL('https://redeven-desktop.invalid/copy-diagnostics')).toBe('copy-diagnostics');
    expect(blockedActionFromURL('https://redeven-desktop.invalid/settings')).toBe('settings');
    expect(blockedActionFromURL('https://example.com/quit')).toBeNull();
  });
});
