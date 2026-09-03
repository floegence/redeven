import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';

import { ManagedReleaseCandidates, ManagedServiceRow, ManagedTemplateNotices, PortForwardRow } from './EnvPortForwardsPage';

const browserCommands = commands as unknown as Readonly<{
  wheelScrollRegion: (request: Readonly<{
    regionSelector: string;
    targetSelector?: string;
    deltaY: number;
  }>) => Promise<Readonly<{ before: number; after: number }>>;
}>;

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function releaseStatus(kind: 'npm' | 'oci', version: string) {
  return {
    schema_version: 1 as const,
    current_release: { schema_version: 1 as const, kind, source: 'example/source', ...(kind === 'npm' ? { version } : { tag: version, digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }) },
    check_status: 'pending' as const,
    current_template_revision: 1,
  };
}

describe('EnvPortForwardsPage browser presentation', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    document.documentElement.classList.remove('dark');
  });

  it('shows exact direct releases, current identity, filters, and disabled reasons at narrow width', async () => {
    await page.viewport(390, 760);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '390px', height: '640px' });
    document.body.appendChild(host);
    const [filter, setFilter] = createSignal<'all' | 'stable' | 'preview'>('all');
    const [selected, setSelected] = createSignal('');
    dispose = render(() => <ManagedReleaseCandidates
      result={{
        schema_version: 2,
        current_release: { schema_version: 1, kind: 'npm', source: '@example/service-cli', registry: 'https://registry.npmjs.org/', version: '0.1.1-rc.2', integrity: 'sha512-current', trust: 'registry_verified' },
        check_status: 'fresh',
		catalog_status: 'complete', has_more: false, loaded_count: 3,
        checked_at_unix_ms: Date.now(),
        candidates: [
          { schema_version: 2, candidate_id: 'preview', source_kind: 'npm', source: '@example/service-cli', registry: 'https://registry.npmjs.org/', version: '0.1.2-alpha.3', channel: 'preview', trust: 'upstream_registry', selectable: true, platform: 'darwin-arm64', integrity: 'sha512-preview', relation: 'newer', is_latest_preview: true, verification_status: 'verified' },
          { schema_version: 2, candidate_id: 'stable', source_kind: 'npm', source: '@example/service-cli', registry: 'https://registry.npmjs.org/', version: '0.1.1-rc.2', channel: 'stable', trust: 'upstream_registry', selectable: true, platform: 'darwin-arm64', integrity: 'sha512-stable', relation: 'same', is_current: true, is_recommended: true, is_latest_stable: true, verification_status: 'verified' },
          { schema_version: 2, candidate_id: 'deprecated', source_kind: 'npm', source: '@example/service-cli', registry: 'https://registry.npmjs.org/', version: '0.1.0', channel: 'stable', trust: 'upstream_registry', selectable: true, deprecated: true, relation: 'older', verification_status: 'verified' },
        ],
      }}
      loading={false}
      error=""
      query=""
      filter={filter()}
      selectedID={selected()}
      onQueryChange={() => undefined}
      onFilterChange={setFilter}
      onSelect={setSelected}
      showRiskHints
    />, host);
    await settle();

    const surface = document.querySelector<HTMLElement>('[data-testid="managed-release-candidates"]')!;
    const scrollViewport = document.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    expect(surface.textContent).toContain('Current installed release');
    expect(surface.textContent).toContain('sha512-current');
    expect(surface.textContent).toContain('0.1.2-alpha.3');
    expect(surface.textContent).toContain('Deprecated');
    expect(document.querySelector<HTMLButtonElement>('[data-release-id="deprecated"]')?.disabled).toBe(false);
    expect(scrollViewport.getAttribute('data-floe-canvas-wheel-interactive')).toBe('true');
    expect(scrollViewport.getAttribute('data-redeven-workbench-wheel-role')).toBe('local-scroll-viewport');
    expect(scrollViewport.tabIndex).toBe(0);
    expect(getComputedStyle(scrollViewport).overflowY).toBe('auto');
    expect(scrollViewport.scrollWidth).toBeLessThanOrEqual(scrollViewport.clientWidth);
    expect(scrollViewport.querySelector<HTMLElement>('[data-release-id="preview"]')!.getBoundingClientRect().height).toBeLessThanOrEqual(88);
    await userEvent.click(Array.from(surface.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Preview')!);
    await settle();
    expect(surface.textContent).toContain('0.1.2-alpha.3');
    expect(surface.textContent).not.toContain('0.1.0');
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-release-id="preview"]')!);
    expect(selected()).toBe('preview');
    expect(surface.querySelector('[data-testid="managed-release-risk-hints"]')?.textContent).toContain('preview release');
    expect(surface.querySelector('[data-testid="managed-release-risk-hints"] input[type="checkbox"]')).toBeNull();
    expect(surface.getBoundingClientRect().width).toBeLessThanOrEqual(390);
  });

  it('fills the available drawer body with compact releases and scrolls from row content', async () => {
    await page.viewport(1440, 960);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '992px', height: '720px' });
    document.body.appendChild(host);
    const [selected, setSelected] = createSignal('release-1');
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      schema_version: 2 as const,
      candidate_id: `release-${index + 1}`,
      source_kind: 'oci' as const,
      source: 'registry.example/managed/example-service',
      registry: 'https://registry.example/',
      tag: `1.0.${12 - index}`,
      digest: `sha256:${String(index + 1).repeat(64)}`,
      channel: 'stable' as const,
      trust: 'registry_verified',
      selectable: true,
      platform: 'linux/arm64',
      relation: 'newer' as const,
	  verification_status: 'verified' as const,
      is_latest_stable: index === 0,
    }));
    dispose = render(() => <ManagedReleaseCandidates
      result={{
        schema_version: 2,
        recommended_release: { schema_version: 1, kind: 'oci', source: candidates[0]!.source, tag: '1.0.12', digest: candidates[0]!.digest },
        latest_stable_release: candidates[0],
        check_status: 'fresh',
		catalog_status: 'complete', has_more: false, loaded_count: candidates.length,
        checked_at_unix_ms: Date.now(),
        candidates,
      }}
      loading={false}
      error=""
      query=""
      filter="all"
      selectedID={selected()}
      onQueryChange={() => undefined}
      onFilterChange={() => undefined}
      onSelect={setSelected}
    />, host);
    await settle();

    const surface = document.querySelector<HTMLElement>('[data-testid="managed-release-candidates"]')!;
    const scrollViewport = document.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    const firstRow = scrollViewport.querySelector<HTMLElement>('[data-release-id="release-1"]')!;
    expect(surface.getBoundingClientRect().height).toBeCloseTo(720, 0);
    expect(scrollViewport.clientHeight).toBeGreaterThanOrEqual(500);
    expect(firstRow.getBoundingClientRect().height).toBeLessThanOrEqual(76);
    expect(scrollViewport.scrollHeight).toBeGreaterThan(scrollViewport.clientHeight);

    scrollViewport.scrollTop = 0;
    const down = await browserCommands.wheelScrollRegion({
      regionSelector: '[data-testid="managed-release-candidate-scroll"]',
      targetSelector: '[data-release-id="release-1"] [data-testid="managed-release-version-label"]',
      deltaY: 260,
    });
    expect(down.before).toBe(0);
    expect(down.after).toBeGreaterThan(0);

    scrollViewport.scrollTop = 0;
    const downFromViewport = await browserCommands.wheelScrollRegion({
      regionSelector: '[data-testid="managed-release-candidate-scroll"]',
      deltaY: 260,
    });
    expect(downFromViewport.before).toBe(0);
    expect(downFromViewport.after).toBeGreaterThan(0);

    scrollViewport.scrollTop = scrollViewport.scrollHeight;
    const up = await browserCommands.wheelScrollRegion({
      regionSelector: '[data-testid="managed-release-candidate-scroll"]',
      targetSelector: '[data-release-id="release-12"]',
      deltaY: -260,
    });
    expect(up.after).toBeLessThan(up.before);
  });

  it('verifies visible candidates and loads another page only near the list end', async () => {
    await page.viewport(1024, 768);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '820px', height: '620px' });
    document.body.appendChild(host);
    const visibleBatches: string[][] = [];
    let loadMoreCalls = 0;
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      schema_version: 2 as const,
      candidate_id: `pending-${index + 1}`,
      source_kind: 'oci' as const,
      source: 'registry.example/managed/example-service',
      tag: `build-${index + 1}`,
      channel: 'special' as const,
      trust: 'registry_verified',
      selectable: false,
      platform: 'linux/arm64',
      relation: 'unknown' as const,
      verification_status: 'pending' as const,
    }));
    dispose = render(() => <ManagedReleaseCandidates
      result={{
        schema_version: 2,
        check_status: 'fresh',
        catalog_status: 'loading',
        has_more: true,
        cursor_id: 'cursor-next',
        loaded_count: candidates.length,
        checked_at_unix_ms: Date.now(),
        candidates,
      }}
      loading={false}
      error=""
      query=""
      filter="all"
      selectedID=""
      onQueryChange={() => undefined}
      onFilterChange={() => undefined}
      onSelect={() => undefined}
      onVisible={(candidateIDs) => visibleBatches.push(candidateIDs)}
      onLoadMore={() => { loadMoreCalls += 1; }}
    />, host);
    await settle();

    const scrollViewport = document.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    expect(visibleBatches.flat()).toContain('pending-1');
    expect(visibleBatches.flat()).not.toContain('pending-20');
    expect(loadMoreCalls).toBe(0);

    scrollViewport.scrollTop = scrollViewport.scrollHeight;
    scrollViewport.dispatchEvent(new Event('scroll'));
    await settle();
    expect(visibleBatches.flat()).toContain('pending-20');
    expect(loadMoreCalls).toBe(1);
  });

  it('keeps notice geometry and scroll position fixed when acknowledgement changes', async () => {
    await page.viewport(1024, 768);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [accepted, setAccepted] = createSignal(false);
    const notice = {
      id: 'interactive-desktop-root-and-network',
      revision: 1,
      severity: 'warning' as const,
      title: 'Container root access and outbound network',
      description: 'Only share this service with trusted users.',
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
            service_id: 'mws-desktop',
            template_id: 'example-desktop-a',
            service_family_id: 'example-desktop-a',
            name: 'Example Desktop A',
            description: 'Run an Ubuntu-based KDE Plasma desktop in an isolated Docker container.',
            template_source: 'builtin',
            deployment: 'container',
            workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-desktop-a/very-long-project-directory',
            workspace_ownership: 'redeven_created',
            release_status: releaseStatus('oci', '654ea8e3-ls177'),
            desired_state: 'running',
            observed_state: 'running',
            forward_id: 'pf-managed',
            runtime_port: 54945,
            actions: { start: { available: false }, stop: { available: true }, restart: { available: true }, retry: { available: false } },
          }}
          busy={false}
          canOpen
          canManage
          onOpen={() => undefined}
          onOpenResource={() => undefined}
          onAction={() => undefined}
          onVersions={() => undefined}
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
    expect(identity.textContent).not.toContain('Run an Ubuntu-based KDE Plasma desktop');
    expect(status.textContent).toContain('Running');
    expect(row.className).not.toContain('bg-[var(--redeven-status-success-soft)]');
    expect(actionButtons).toHaveLength(3);
    expect(new Set(actionButtons.map((button) => button.getBoundingClientRect().top)).size).toBe(1);
    expect(new Set(actionButtons.map((button) => button.getBoundingClientRect().height)).size).toBe(1);
  });

  it('keeps a failed managed service dense and its retry action on one line', async () => {
    await page.viewport(1200, 800);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-failed',
          template_id: 'example-container',
          service_family_id: 'example-service',
          name: 'Example Service',
          description: 'Run Example Service in an isolated container.',
          template_source: 'builtin',
          deployment: 'container',
          workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-service',
          workspace_ownership: 'redeven_created',
          release_status: releaseStatus('oci', '0.1.1-rc.2'),
          desired_state: 'running',
          observed_state: 'error',
          forward_id: 'pf-failed',
          runtime_port: 3000,
          last_failure: { action: 'start', stage: 'failed', error_code: 'CONTAINER_NAME_MISMATCH', message: 'raw backend identity detail' },
          actions: { start: { available: false }, stop: { available: false }, restart: { available: true }, retry: { available: true } },
        }}
        busy={false}
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onVersions={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
      />
    ), host);
    await settle();

    const row = document.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
    const retryButton = Array.from(row.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Retry')!;

    expect(retryButton).toBeTruthy();
    expect(retryButton.querySelector('svg')).toBeNull();
    expect(row.textContent).not.toContain('Failed');
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(72);
    expect(getComputedStyle(retryButton).whiteSpace).toBe('nowrap');
    expect(retryButton.scrollHeight).toBeLessThanOrEqual(retryButton.clientHeight);
    const failureButton = row.querySelector<HTMLButtonElement>('button[aria-label="Show failure details"]')!;
    failureButton.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('The container name no longer matches this managed service.');
    expect(document.querySelector('[role="tooltip"]')?.textContent).not.toContain('raw backend identity detail');
  });

  it('replaces a stale service error with contextual operation progress and details', async () => {
    await page.viewport(1200, 800);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-failed',
          template_id: 'example-container',
          service_family_id: 'example-service',
          name: 'Example Service',
          description: 'Run Example Service in an isolated container.',
          template_source: 'builtin',
          deployment: 'container',
          workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-service',
          workspace_ownership: 'redeven_created',
          release_status: releaseStatus('oci', '0.1.1-rc.2'),
          desired_state: 'running',
          observed_state: 'error',
          forward_id: 'pf-failed',
          runtime_port: 3000,
          last_failure: { action: 'install', stage: 'pulling', error_code: 'IMAGE_PULL_FAILED', message: 'The image could not be pulled.' },
          actions: { start: { available: false, reason_code: 'OPERATION_ACTIVE' }, stop: { available: false, reason_code: 'OPERATION_ACTIVE' }, restart: { available: false, reason_code: 'OPERATION_ACTIVE' }, retry: { available: false, reason_code: 'OPERATION_ACTIVE' } },
        }}
        operation={{
          operation_id: 'mop-retry',
          service_id: 'mws-failed',
          action: 'retry_install',
          state: 'running',
          stage: 'pulling',
          progress_current: 2,
          progress_total: 7,
          progress_detail: {
            schema_version: 1,
            stage_started_at_unix_ms: Date.now() - 2_000,
            updated_at_unix_ms: Date.now(),
            transfer: {
              phase: 'pulling',
              artifact_reference: 'ghcr.io/runzhliu/example-service@sha256:reviewed',
              artifact_index: 1,
              artifact_total: 1,
              downloaded_bytes: 2_000,
              total_bytes: 5_000,
              bytes_per_second: 1_000,
              completed_layers: 2,
              total_layers: 5,
            },
          },
        }}
        busy
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onVersions={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
        onCancelOperation={() => undefined}
      />
    ), host);
    await settle();

    const row = document.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
    const progress = row.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
    expect(progress.textContent).toContain('Pulling image');
    expect(progress.textContent).toContain('2.00 KB / 5.00 KB');
    expect(row.textContent).not.toContain('Error');
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(120);
    expect(row.querySelector('[data-testid="managed-operation-progress"]')).toBeNull();

    await userEvent.click(progress);
    await settle();

    const details = document.querySelector<HTMLElement>('[data-testid="managed-service-operation-details"]')!;
    expect(details).toBeTruthy();
    expect(details.textContent).toContain('ghcr.io/runzhliu/example-service@sha256:reviewed');
    expect(details.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2000');
    expect(details.querySelectorAll('[data-managed-operation-step]')).toHaveLength(7);
    expect(details.closest('[role="dialog"]')).toBeNull();
    const detailsRect = details.getBoundingClientRect();
    expect(detailsRect.left).toBeGreaterThanOrEqual(0);
    expect(detailsRect.right).toBeLessThanOrEqual(1200);

    document.documentElement.classList.add('dark');
    await page.viewport(640, 800);
    host.style.width = '600px';
    await settle();
    expect(details.getBoundingClientRect().right).toBeLessThanOrEqual(640);
    expect(getComputedStyle(progress.querySelector('.managed-operation-shimmer-text')!).animationName).toContain('managed-operation-text-shimmer');
  });

  it('keeps host package transfer details visible inside the service row', async () => {
    await page.viewport(720, 800);
    const host = document.createElement('div');
    host.style.width = '680px';
    document.body.appendChild(host);
    dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-native',
          template_id: 'example-host',
          service_family_id: 'example-host',
          name: 'Example Service',
          template_source: 'builtin',
          deployment: 'host',
          workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-host',
          workspace_ownership: 'redeven_created',
          release_status: releaseStatus('npm', '0.1.1-rc.2'),
          desired_state: 'running',
          observed_state: 'installing',
          forward_id: 'pf-native',
          runtime_port: 3000,
        }}
        operation={{
          operation_id: 'mop-native',
          service_id: 'mws-native',
          action: 'install',
          state: 'running',
          stage: 'downloading',
          progress_current: 2,
          progress_total: 7,
          progress_detail: {
            schema_version: 1,
            stage_started_at_unix_ms: Date.now() - 2_000,
            updated_at_unix_ms: Date.now(),
            transfer: {
              phase: 'downloading',
              artifact_reference: 'node-v24.19.0-darwin-arm64.tar.gz@sha256:reviewed',
              artifact_index: 1,
              artifact_total: 1,
              downloaded_bytes: 2_000,
              total_bytes: 5_000,
              bytes_per_second: 1_000,
            },
          },
        }}
        busy
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onVersions={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
        onCancelOperation={() => undefined}
      />
    ), host);
    await settle();

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
    expect(trigger.textContent).toContain('2.00 KB / 5.00 KB');
    await userEvent.click(trigger);
    await settle();

    const details = document.querySelector<HTMLElement>('[data-testid="managed-service-operation-details"]')!;
    expect(details.textContent).toContain('Software package');
    expect(details.textContent).toContain('1.00 KB/s');
    expect(details.textContent).not.toContain('Layers');
    expect(details.getBoundingClientRect().right).toBeLessThanOrEqual(720);
  });

  it('keeps cached image facts populated while elapsed time advances', async () => {
    await page.viewport(1200, 800);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-cached',
          template_id: 'example-desktop-b',
          service_family_id: 'example-desktop-b',
          name: 'Example Desktop B',
          template_source: 'builtin',
          deployment: 'container',
          workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-desktop-b',
          workspace_ownership: 'redeven_created',
          release_status: releaseStatus('npm', 'reviewed'),
          desired_state: 'running',
          observed_state: 'installing',
          forward_id: 'pf-cached',
          runtime_port: 3000,
        }}
        operation={{
          operation_id: 'mop-cached',
          service_id: 'mws-cached',
          action: 'install',
          state: 'running',
          stage: 'pulling',
          progress_current: 2,
          progress_total: 7,
          progress_detail: {
            schema_version: 1,
            stage_started_at_unix_ms: Date.now() - 1_000,
            updated_at_unix_ms: Date.now() - 1_000,
            transfer: {
              phase: 'cached',
              artifact_reference: 'lscr.io/example/desktop@sha256:reviewed',
              artifact_index: 1,
              artifact_total: 1,
              completed_layers: 17,
              total_layers: 17,
            },
          },
        }}
        busy
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onVersions={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
        onCancelOperation={() => undefined}
      />
    ), host);
    await settle();

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!;
    expect(trigger.textContent).toContain('17 layers');
    await userEvent.click(trigger);
    await settle();

    const details = document.querySelector<HTMLElement>('[data-testid="managed-service-operation-details"]')!;
    const elapsed = details.querySelector<HTMLElement>('[data-testid="managed-operation-elapsed"]')!;
    expect(details.textContent).toContain('0 B');
    expect(details.textContent).toContain('0 B/s');
    expect(details.textContent).toContain('17 / 17');
    const before = Number.parseInt(elapsed.textContent ?? '', 10);
    await new Promise((resolve) => window.setTimeout(resolve, 1_100));
    expect(Number.parseInt(elapsed.textContent ?? '', 10)).toBeGreaterThan(before);
  });
});
