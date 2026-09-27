import '../../index.css';
import { render } from 'solid-js/web';
import { it, expect, onTestFinished, vi, afterEach } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { RuntimeMonitorPanel } from './RuntimeMonitorPanel';

const failures = vi.hoisted(() => ({ monitor: '', sessions: '' }));
afterEach(() => { failures.monitor = ''; failures.sessions = ''; });

vi.mock('@floegence/floe-webapp-core', async original => ({
  ...await original<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: () => ({ id: 'density' }), status: () => 'connected' }),
}));
vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({ env: Object.assign(() => ({ permissions: { can_read: true, can_execute: true } }), { state: 'ready' }), openFlowerTurnLauncher: vi.fn() }),
}));
vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    monitor: { getSysMonitor: async () => { if (failures.monitor) throw new Error(failures.monitor); return ({ cpuUsage: 12.5, cpuCores: 8, loadAverage: [1, 0.5, 0.25],
      memoryTotalBytes: 17179869184, memoryUsedBytes: 8589934592, networkBytesReceived: 100, networkBytesSent: 200,
      networkSpeedReceived: 10, networkSpeedSent: 20, platform: 'darwin', timestampMs: 1000,
      processes: Array.from({ length: 25 }, (_, index) => ({ pid: 1000 + index, name: `workspace-worker-${index}`, cpuPercent: 12.5, memoryBytes: 268435456, username: 'developer' })),
    }); } },
    sessions: { listActiveSessions: async () => { if (failures.sessions) throw new Error(failures.sessions); return { sessions: [] }; } },
  }),
}));

it.each([false, true])('measures real monitoring rows and retains chart content with touch=%s', async touch => {
  await page.viewport(1440, 1000);
  const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await media.emulateTouchInput(touch);
  onTestFinished(() => media.emulateTouchInput(false));
  const host = document.createElement('main');
  host.style.cssText = 'height:900px;width:1400px';
  document.body.append(host);
  const dispose = render(() => <RuntimeMonitorPanel variant="workbench" />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await expect.poll(() => host.querySelectorAll('[data-monitor-process-selected]').length).toBe(25);
  await document.fonts.ready;
  const rows = [...host.querySelectorAll<HTMLElement>('[data-monitor-process-selected]')];
  expect(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top).toBe(touch ? 44 : 28);
  expect(getComputedStyle(rows[0].children[1]).fontSize).toBe(touch ? '13px' : '12px');
  expect(host.querySelector('.chart-svg')).not.toBeNull();
  const content = host.querySelector('.max-w-7xl')!;
  expect(content.querySelector('.grid')!.getBoundingClientRect().top).toBe(content.getBoundingClientRect().top);
  const tables = host.querySelectorAll('table');
  const sessionsViewport = tables[1].parentElement!;
  const heading = sessionsViewport.parentElement!.firstElementChild!;
  expect(sessionsViewport.getBoundingClientRect().top - heading.getBoundingClientRect().bottom).toBeLessThanOrEqual(8);

  rows[1].click();
  expect(rows[1].dataset.monitorProcessSelected).toBe('true');
  await page.screenshot({ element: host, path: `__screenshots__/monitor-density-${touch ? 'touch' : 'desktop'}.png` });
});


it('keeps charts and the session table stationary during independent failures and retry', async () => {
  await page.viewport(900, 900);
  const host = document.createElement('main'); host.style.height = '800px'; document.body.append(host);
  const dispose = render(() => <RuntimeMonitorPanel />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await expect.poll(() => host.querySelectorAll('table').length).toBe(2);
  const chart = host.querySelector('.chart-svg')!;
  const sessionTable = host.querySelectorAll('table')[1];
  const before = [chart, sessionTable].map(element => element.getBoundingClientRect().toJSON());
  failures.monitor = 'Readings unavailable'; failures.sessions = 'Sessions unavailable';
  const triggers = [...host.querySelectorAll<HTMLButtonElement>('[data-floe-status-indicator] button')];
  await expect.poll(() => triggers.every(button => button.getAttribute('aria-hidden') !== 'true'), { timeout: 5000 }).toBe(true);
  expect([chart, sessionTable].map(element => element.getBoundingClientRect().toJSON())).toEqual(before);
  await userEvent.click(triggers[1]);
  await expect.poll(() => document.querySelector('[data-floe-status-details]')?.textContent).toContain('Sessions unavailable');
  failures.sessions = '';
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await expect.poll(() => triggers[1].getAttribute('aria-hidden')).toBe('true');
  expect(triggers[0].getAttribute('aria-hidden')).toBeNull();
  failures.monitor = '';
  await userEvent.click(triggers[0]);
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await expect.poll(() => triggers[0].getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('.chart-svg')).toBe(chart);
  expect(host.querySelectorAll('table')[1]).toBe(sessionTable);
  expect([chart, sessionTable].map(element => element.getBoundingClientRect().toJSON())).toEqual(before);
});

it('shows initial session failure directly with recovery instead of an empty table message', async () => {
  failures.sessions = 'Sessions unavailable';
  const host = document.createElement('main'); host.style.height = '800px'; document.body.append(host);
  const dispose = render(() => <RuntimeMonitorPanel />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await expect.poll(() => host.querySelector('td [role="alert"]')?.textContent).toContain('Sessions unavailable');
  failures.sessions = '';
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await expect.poll(() => host.querySelector('td [role="alert"]')).toBeNull();
});
