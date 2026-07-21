import { describe, expect, it } from 'vitest';

import {
  blockedActionFromURL,
  buildBlockedPageHTML,
  isBlockedActionURL,
} from './blockedPage';
import { desktopSemanticPaletteForShellTheme } from './desktopTheme';

describe('blockedPage', () => {
  it('renders the non-local-ui blocked explanation', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven runtime instance is already using this state directory.',
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
    expect(html).toContain('Local Environment Settings');
    expect(html).not.toContain('gradient');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="blocked-main"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Blocked page actions"');
    expect(html).toContain('env(titlebar-area-height, 40px)');
    expect(html).toContain('data-floe-shell-theme="classic-light"');
    expect(html).toContain('--bg: hsl(34 24% 94%)');
  });

  it('renders the selected preset semantic palette instead of fixed page colors', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'startup_failed',
      message: 'The Local Environment did not start.',
    }, 'linux', 'en-US', {
      resolvedTheme: 'dark',
      activeShellTheme: 'dracula',
      semantic: desktopSemanticPaletteForShellTheme('dracula'),
    });

    expect(html).toContain('data-floe-shell-theme="dracula"');
    expect(html).toContain('data-theme-palette-version="1"');
    expect(html).toContain('color-scheme: dark');
    expect(html).toContain('--bg: #282A36');
    expect(html).toContain('--panel: #303341');
    expect(html).toContain('--accent: #BD93F9');
    expect(html).not.toContain('#201917');
    expect(html).not.toContain('#f9efe8');
    expect(html).not.toContain('rgba(24, 19, 17');
  });

  it('renders the local-ui-enabled blocked explanation', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven runtime instance is already using this state directory.',
      lock_owner: {
        mode: 'hybrid',
        local_ui_enabled: true,
      },
    }, 'darwin');

    expect(html).toContain('Redeven is already starting elsewhere');
    expect(html).toContain('appears to provide Local UI');
    expect(html).toContain('calc(24px + 40px)');
    expect(html).not.toContain('env(titlebar-area-height, 40px)');
    expect(html).toContain("queueMicrotask(() => blockedSummary.focus())");
  });

  it('renders blocked page chrome in the selected Desktop language', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven runtime instance is already using this state directory.',
      lock_owner: {
        mode: 'hybrid',
        local_ui_enabled: true,
      },
    }, 'linux', 'zh-CN');

    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain('Redeven 已在其他位置启动中');
    expect(html).toContain('跳到主要内容');
    expect(html).toContain('复制诊断信息');
    expect(html).toContain('技术详情');
    expect(html).toContain('aria-label="页面操作"');
  });

  it('recognizes blocked page action urls', () => {
    expect(isBlockedActionURL('https://redeven-desktop.invalid/retry')).toBe(true);
    expect(blockedActionFromURL('https://redeven-desktop.invalid/copy-diagnostics')).toBe('copy-diagnostics');
    expect(blockedActionFromURL('https://redeven-desktop.invalid/advanced-settings')).toBe('advanced-settings');
    expect(blockedActionFromURL('https://redeven-desktop.invalid/desktop-settings')).toBe('advanced-settings');
    expect(blockedActionFromURL('https://redeven-desktop.invalid/connection-center')).toBe('connection-center');
    expect(blockedActionFromURL('https://redeven-desktop.invalid/connect')).toBe('connection-center');
    expect(blockedActionFromURL('https://example.com/quit')).toBeNull();
  });

  it('renders an external target connectivity failure', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'external_target_unreachable',
      message: 'Desktop could not reach the configured Redeven URL.',
      diagnostics: {
        target_url: 'http://192.168.1.11:24000/',
      },
    }, 'linux');

    expect(html).toContain('Redeven target is unavailable');
    expect(html).toContain('Target URL: http://192.168.1.11:24000/');
    expect(html).toContain('Open Environment');
    expect(html).toContain('aria-describedby="blocked-meta"');
  });

  it('renders a concrete startup validation failure', () => {
    const html = buildBlockedPageHTML({
      status: 'blocked',
      code: 'startup_invalid',
      message: 'incomplete bootstrap flags for `redeven run`: missing flag one bootstrap ticket (--bootstrap-ticket-stdin, --bootstrap-ticket-file, or REDEVEN_BOOTSTRAP_TICKET)',
      diagnostics: {
        state_dir: '/Users/tester/.redeven/local-environment',
        config_path: '/Users/tester/.redeven/local-environment/config.json',
        command: 'redeven run',
      },
    }, 'linux');

    expect(html).toContain('Local Environment startup needs a setting');
    expect(html).toContain('missing flag one bootstrap ticket');
    expect(html).toContain('Config path: /Users/tester/.redeven/local-environment/config.json');
    expect(html).toContain('Local Environment Settings');
  });
});
