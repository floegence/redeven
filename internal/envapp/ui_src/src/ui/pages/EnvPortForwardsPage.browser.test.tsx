import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { ManagedServiceRow, ManagedTemplateNotices, PortForwardRow } from './EnvPortForwardsPage';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EnvPortForwardsPage browser presentation', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it('keeps notice geometry and scroll position fixed when acknowledgement changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [accepted, setAccepted] = createSignal(false);
    const notice = {
      id: 'interactive-desktop-root-and-network',
      revision: 1,
      severity: 'warning' as const,
      title_key: 'webServices.managed.notices.interactiveDesktopRoot.title',
      description_key: 'webServices.managed.notices.interactiveDesktopRoot.description',
      acknowledgement_required: true,
    };
    dispose = render(() => (
      <div data-testid="notice-scroll-viewport" style="height: 180px; overflow: auto;">
        <div style="height: 120px;" />
        <ManagedTemplateNotices
          notices={[notice]}
          accepted={{ [notice.id]: accepted() }}
          disabled={false}
          onAcceptedChange={(_noticeID, checked) => setAccepted(checked)}
        />
        <div data-testid="notice-following-content" style="height: 120px;" />
      </div>
    ), host);

    const viewport = document.querySelector<HTMLElement>('[data-testid="notice-scroll-viewport"]')!;
    const noticeCard = document.querySelector<HTMLElement>('[data-notice-id]')!;
    const followingContent = document.querySelector<HTMLElement>('[data-testid="notice-following-content"]')!;
    const checkboxLabel = document.querySelector<HTMLInputElement>('[data-testid="managed-template-notices"] input[type="checkbox"]')!.closest('label')!;
    viewport.scrollTop = 90;
    const before = {
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      noticeHeight: noticeCard.getBoundingClientRect().height,
      followingTop: followingContent.getBoundingClientRect().top,
    };

    await userEvent.click(checkboxLabel);
    await settle();

    expect(accepted()).toBe(true);
    expect(viewport.scrollTop).toBe(before.scrollTop);
    expect(viewport.scrollHeight).toBe(before.scrollHeight);
    expect(noticeCard.getBoundingClientRect().height).toBe(before.noticeHeight);
    expect(followingContent.getBoundingClientRect().top).toBe(before.followingTop);
  });

  it('keeps the managed service row dense and column-aligned', async () => {
    await page.viewport(1200, 800);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    dispose = render(() => (
      <div>
        <ManagedServiceRow
          service={{
            service_id: 'mws-webtop',
            template_id: 'linuxserver-webtop-ubuntu-kde',
            service_family_id: 'linuxserver-webtop-ubuntu-kde',
            name: 'LinuxServer Webtop · Ubuntu KDE',
            description: 'Run an Ubuntu KDE desktop in an isolated Docker container.',
            template_source: 'builtin',
            deployment: 'container',
            workspace_path: '/Users/demo/Redeven/workspaces/managed-services/linuxserver-webtop-ubuntu-kde/very-long-project-directory',
            version: '654ea8e3-ls177',
            desired_state: 'running',
            observed_state: 'running',
            forward_id: 'pf-managed',
            runtime_port: 54945,
            brand_icon: 'ubuntu',
            update_available: false,
          }}
          busy={false}
          canOpen
          canManage
          onOpen={() => undefined}
          onOpenResource={() => undefined}
          onAction={() => undefined}
          onUpdate={() => undefined}
          onLogs={() => undefined}
          onUninstall={() => undefined}
        />
        <PortForwardRow
          forward={{
            forward_id: 'pf-saved',
            target_url: 'http://127.0.0.1:3000',
            name: 'Local dashboard',
            description: 'A saved local service.',
            health_path: '/',
            insecure_skip_verify: false,
            created_at_unix_ms: 1,
            updated_at_unix_ms: 1,
            last_opened_at_unix_ms: 1,
            health: {
              status: 'healthy',
              last_checked_at_unix_ms: 1,
              latency_ms: 12,
              last_error: '',
            },
          }}
          busy={false}
          onOpen={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
      </div>
    ), host);
    await settle();

    const row = document.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
    const forwardRow = document.querySelector<HTMLElement>('[data-testid="port-forward-row"]')!;
    const identity = row.querySelector<HTMLElement>('.service-template-identity')!;
    const name = identity.querySelector<HTMLElement>('h3')!;
    const status = row.querySelector<HTMLElement>('[data-testid="managed-service-status"]')!;
    const workspaceColumn = row.querySelector<HTMLElement>('[data-testid="managed-service-secondary"]')!;
    const workspace = row.querySelector<HTMLElement>('[data-testid="managed-service-workspace"]')!;
    const actions = row.querySelector<HTMLElement>('[data-testid="managed-service-actions"]')!;
    const forwardSecondary = forwardRow.querySelector<HTMLElement>('[data-testid="port-forward-secondary"]')!;
    const forwardStatus = forwardRow.querySelector<HTMLElement>('[data-testid="port-forward-status"]')!;
    const forwardActions = forwardRow.querySelector<HTMLElement>('[data-testid="port-forward-actions"]')!;
    const managedOpen = Array.from(actions.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent?.trim() === 'Open')!;
    const forwardOpen = Array.from(forwardActions.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent?.trim() === 'Open')!;
    const actionButtons = Array.from(actions.querySelectorAll<HTMLElement>('button'));
    const rowRect = row.getBoundingClientRect();
    const forwardRowRect = forwardRow.getBoundingClientRect();
    const identityRect = identity.getBoundingClientRect();
    const workspaceRect = workspaceColumn.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    expect(rowRect.width).toBe(1024);
    expect(forwardRowRect.width).toBe(rowRect.width);
    expect(rowRect.height).toBe(forwardRowRect.height);
    expect(rowRect.height).toBeLessThanOrEqual(72);
    expect(identityRect.right).toBeLessThanOrEqual(workspaceRect.left);
    expect(workspaceRect.right).toBeLessThanOrEqual(statusRect.left);
    expect(statusRect.right).toBeLessThanOrEqual(actionsRect.left);
    expect(forwardSecondary.getBoundingClientRect().x).toBe(workspaceRect.x);
    expect(forwardStatus.getBoundingClientRect().x).toBe(statusRect.x);
    expect(forwardActions.getBoundingClientRect().x).toBe(actionsRect.x);
    expect(forwardOpen.getBoundingClientRect().x).toBe(managedOpen.getBoundingClientRect().x);
    expect(forwardOpen.getBoundingClientRect().width).toBe(managedOpen.getBoundingClientRect().width);
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    expect(workspace.scrollWidth).toBeGreaterThan(workspace.clientWidth);
    expect(workspace.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    expect(identity.textContent).not.toContain('Run an Ubuntu KDE desktop');
    expect(status.textContent).toContain('Running');
    expect(row.className).not.toContain('bg-[var(--redeven-status-success-soft)]');
    expect(actionButtons).toHaveLength(3);
    expect(new Set(actionButtons.map((button) => button.getBoundingClientRect().top)).size).toBe(1);
    expect(new Set(actionButtons.map((button) => button.getBoundingClientRect().height)).size).toBe(1);
  });
});
