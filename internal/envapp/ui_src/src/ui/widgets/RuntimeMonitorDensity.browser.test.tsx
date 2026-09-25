import '../../index.css';
import { render } from 'solid-js/web';
import { it, expect, onTestFinished, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { RuntimeMonitorPanel } from './RuntimeMonitorPanel';

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
    monitor: { getSysMonitor: async () => ({ cpuUsage: 12.5, cpuCores: 8, loadAverage: [1, 0.5, 0.25],
      memoryTotalBytes: 17179869184, memoryUsedBytes: 8589934592, networkBytesReceived: 100, networkBytesSent: 200,
      networkSpeedReceived: 10, networkSpeedSent: 20, platform: 'darwin', timestampMs: 1000,
      processes: Array.from({ length: 25 }, (_, index) => ({ pid: 1000 + index, name: `workspace-worker-${index}`, cpuPercent: 12.5, memoryBytes: 268435456, username: 'developer' })),
    }) },
    sessions: { listActiveSessions: async () => ({ sessions: [] }) },
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
  rows[1].click();
  expect(rows[1].dataset.monitorProcessSelected).toBe('true');
  await page.screenshot({ element: host, path: `__screenshots__/monitor-density-${touch ? 'touch' : 'desktop'}.png` });
});
