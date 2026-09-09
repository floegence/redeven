import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ManagedServiceRow, PortForwardRow } from './EnvPortForwardsPage';

const service = {
  service_id: 'mws-layout', template_id: 'example-service', name: 'Example service',
  template_source: 'builtin' as const, deployment: 'container' as const,
  workspace_path: '/Users/demo/Services/example-service', workspace_ownership: 'redeven_created' as const,
  desired_state: 'stopped', observed_state: 'missing', management_state: 'active',
  status: 'uninstall_pending', primary_action: 'inspect', problem_code: 'RESOURCE_IN_USE',
  forward_id: 'pf-layout', runtime_port: 3000,
  release_status: { schema_version: 2 as const, current_release: { schema_version: 1 as const, kind: 'oci' as const, source: 'example/service', tag: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, check_status: 'pending' as const },
  actions: { open: { available: false }, inspect: { available: true }, start: { available: false }, stop: { available: true }, restart: { available: false }, retry: { available: false } },
};
const forward = {
  forward_id: 'pf-other', name: 'Local dashboard', target_url: 'http://localhost:3001', description: '',
  health_path: '/', insecure_skip_verify: false, created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1,
  health: { status: 'healthy' as const, last_checked_at_unix_ms: 1, latency_ms: 10, last_error: '' },
};
const settle = async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };

function assertContained(element: HTMLElement, parent: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const bounds = parent.getBoundingClientRect();
  expect(rect.left, element.textContent ?? '').toBeGreaterThanOrEqual(bounds.left - 1);
  expect(rect.right, element.textContent ?? '').toBeLessThanOrEqual(bounds.right + 1);
  expect(rect.bottom, element.textContent ?? '').toBeLessThanOrEqual(bounds.bottom + 1);
}

describe('Web Service collection geometry', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); document.body.replaceChildren(); });

  for (const width of [360, 480, 680, 1024]) it(`contains actionable cleanup details in a ${width}px surface inside a wide window`, async () => {
    await page.viewport(1440, 1000);
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    host.className = 'web-services';
    document.body.append(host);
    const inspect = vi.fn();
    dispose = render(() => <div class="web-service-list">
      <ManagedServiceRow service={service} busy={false} canOpen canManage operationExpanded={false}
        onOpen={() => undefined} onOpenResource={() => undefined} onAction={() => undefined}
        onOperationExpandedChange={() => undefined} onLogs={() => undefined} onUninstall={() => undefined} onInspect={inspect} />
      <PortForwardRow forward={forward} busy={false} onOpen={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />
    </div>, host);
    await settle();
    const row = host.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
    const next = host.querySelector<HTMLElement>('[data-testid="port-forward-row"]')!;
    const status = row.querySelector<HTMLElement>('[data-testid="managed-service-status"]')!;
    const action = row.querySelector<HTMLButtonElement>('[data-testid="managed-service-primary"]')!;
    assertContained(status, row);
    for (const button of row.querySelectorAll<HTMLElement>('button')) {
      assertContained(button, row);
      expect(button.scrollWidth, button.textContent ?? '').toBeLessThanOrEqual(button.clientWidth + 1);
    }
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(next.getBoundingClientRect().top + 1);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
    await userEvent.click(action);
    expect(inspect).toHaveBeenCalledOnce();
  });
});
