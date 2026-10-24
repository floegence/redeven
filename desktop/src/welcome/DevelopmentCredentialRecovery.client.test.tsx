import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopI18n } from '../shared/i18n';
import { DevelopmentCredentialRecovery } from './DevelopmentCredentialRecovery';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

describe('development credential recovery', () => {
  it('requests migration only after a click and allows retry after denial', async () => {
    let resolve!: (value: DesktopLauncherActionResult) => void;
    const migrate = vi.fn(() => new Promise<DesktopLauncherActionResult>(done => { resolve = done; }));
    const quit = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <DevelopmentCredentialRecovery recovery={{ can_migrate: true, failed: false }}
      i18n={createDesktopI18n('en-US')} migrate={migrate} quit={quit} />, host);
    expect(migrate).not.toHaveBeenCalled();
    const buttons = [...host.querySelectorAll('button')];
    buttons[0].click();
    buttons[0].click();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(buttons.every(button => button.disabled)).toBe(true);
    resolve({ ok: false, code: 'action_invalid', scope: 'global', message: 'Denied' });
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('preserved'));
    expect(buttons.every(button => !button.disabled)).toBe(true);
    buttons[1].click();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('offers repair guidance rather than a migration loop for a damaged key', () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <DevelopmentCredentialRecovery recovery={{ can_migrate: false, failed: true }}
      i18n={createDesktopI18n('zh-TW')} migrate={vi.fn()} quit={vi.fn()} />, host);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toContain('金鑰');
    expect(host.textContent).toContain('現有資料已保留');
  });
});
