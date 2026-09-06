import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';

import { ForwardMetadataDialog, ManagedReleaseCandidates, ManagedServiceRow as ManagedServiceRowComponent, ManagedTemplateNotices, PortForwardRow } from './EnvPortForwardsPage';
import type { ManagedOperation } from './managedServiceOperationController';

function ManagedServiceRow(props: Omit<Parameters<typeof ManagedServiceRowComponent>[0], 'operationExpanded' | 'onOperationExpandedChange'>) {
  const [expanded, setExpanded] = createSignal(false);
  return <ManagedServiceRowComponent {...props} operationExpanded={expanded()} onOperationExpandedChange={(_operationID, value) => setExpanded(value)} />;
}

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
    schema_version: 2 as const,
    current_release: { schema_version: 1 as const, kind, source: 'example/source', ...(kind === 'npm' ? { version } : { tag: version, digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }) },
    check_status: 'pending' as const,
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

  it('keeps the editable service URL and save action usable at narrow width', async () => {
    await page.viewport(390, 760);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const submissions: unknown[][] = [];
    dispose = render(() => (
      <ForwardMetadataDialog
        open
        mode="edit"
        editorKey="pf-editable-url"
        targetURL="http://localhost:3000"
        initialName="Local dashboard"
        initialDescription="Development status"
        initialAccessMode="unified_proxy"
        loading={false}
        onOpenChange={() => undefined}
        onSubmit={(...args) => submissions.push(args)}
      />
    ), host);
    await settle();

    const form = document.querySelector<HTMLElement>('[data-testid="web-service-metadata-dialog"]')!;
    const dialog = form.closest<HTMLElement>('[role="dialog"]') ?? form.parentElement!;
    const target = document.querySelector<HTMLInputElement>('#web-service-metadata-target')!;
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Save changes')!;
    expect(target.value).toBe('http://localhost:3000');
    expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);

    await userEvent.fill(target, 'https://example.com');
    await settle();
    expect(form.textContent).toContain('Available only inside this Environment');
    expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(760);

    await userEvent.fill(target, '4173');
    await userEvent.click(save);
    expect(submissions).toEqual([['4173', 'Local dashboard', 'Development status', 'unified_proxy']]);
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
          { schema_version: 2, candidate_id: 'preview', source_kind: 'npm', source: '@example/service-cli', registry: 'https://registry.npmjs.org/', version: '0.1.2-alpha.3', channel: 'preview', trust: 'upstream_registry', selectable: true, platform: 'darwin-arm64', integrity: 'sha512-preview', published_at_unix_ms: Date.UTC(2022, 9, 23), relation: 'newer', is_latest_preview: true, verification_status: 'verified' },
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
    expect(surface.textContent).toContain('Published');
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

  it('keeps an unavailable recommendation historical without presenting it as deployable', async () => {
    await page.viewport(640, 760);
    const host = document.createElement('div');
    host.style.width = '620px';
    document.body.appendChild(host);
    const [selected, setSelected] = createSignal('');
    const unavailable = {
      schema_version: 2 as const,
      candidate_id: 'stale-recommendation',
      source_kind: 'oci' as const,
      source: 'lscr.io/linuxserver/webtop',
      tag: '654ea8e3-ls177',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      channel: 'special' as const,
      trust: 'catalog_reviewed_source',
      selectable: false,
      relation: 'unknown' as const,
      recommendation_status: 'unavailable' as const,
      verification_status: 'unavailable' as const,
      reason_code: 'RELEASE_NOT_FOUND',
      reason: 'This version is no longer available from the registry.',
    };
    const verified = {
      ...unavailable,
      candidate_id: 'verified-release',
      tag: 'latest-verified',
      digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      selectable: true,
      recommendation_status: undefined,
      verification_status: 'verified' as const,
      reason_code: undefined,
      reason: undefined,
    };
    dispose = render(() => <ManagedReleaseCandidates
      result={{
        schema_version: 2,
        recommended_release: { schema_version: 1, kind: 'oci', source: unavailable.source, tag: unavailable.tag, digest: unavailable.digest },
        check_status: 'fresh',
        catalog_status: 'complete',
        has_more: false,
        loaded_count: 2,
        checked_at_unix_ms: Date.now(),
        candidates: [unavailable, verified],
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

    const stale = host.querySelector<HTMLButtonElement>('[data-release-id="stale-recommendation"]')!;
    expect(stale.disabled).toBe(true);
    expect(stale.textContent).toContain('Recommended unavailable');
    expect(stale.textContent).not.toContain('Redeven recommended');
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-release-id="verified-release"]')!);
    expect(selected()).toBe('verified-release');
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
    expect(host.querySelector('[data-testid="managed-release-loading-spinner"]')).toBeNull();

    scrollViewport.scrollTop = scrollViewport.scrollHeight;
    scrollViewport.dispatchEvent(new Event('scroll'));
    await settle();
    expect(visibleBatches.flat()).toContain('pending-20');
    expect(loadMoreCalls).toBe(1);
  });

  for (const width of [390, 1440]) it(`keeps request feedback visible outside the release list at ${width}px`, async () => {
    await page.viewport(width, 900);
    document.documentElement.classList.add('dark');
    const host = document.createElement('div');
    Object.assign(host.style, { width: `${Math.min(width, 992)}px`, height: '720px' });
    document.body.appendChild(host);
    const [loading, setLoading] = createSignal(true);
    const [hasMore, setHasMore] = createSignal(true);
    const [error, setError] = createSignal('');
    const candidates = Array.from({ length: 101 }, (_, index) => ({
      schema_version: 2 as const, candidate_id: `feedback-${index}`, source_kind: 'oci' as const,
      source: 'lscr.io/linuxserver/webtop', tag: `debian-xfce-${index}-ls91`, channel: 'special' as const,
      trust: 'catalog_reviewed_source', selectable: true, relation: 'unknown' as const,
      verification_status: 'verified' as const,
    }));
    dispose = render(() => <ManagedReleaseCandidates
      result={{ schema_version: 2, check_status: 'fresh', catalog_status: 'loading', has_more: hasMore(), loaded_count: 101, checked_at_unix_ms: Date.now(), candidates }}
      loading={loading()} error={error()} query="" filter="all" selectedID="" onQueryChange={() => undefined} onFilterChange={() => undefined} onSelect={() => undefined}
    />, host);
    await settle();
    const viewport = host.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    const status = host.querySelector<HTMLElement>('[data-testid="managed-release-more-sentinel"]')!;
    const initialStatusBounds = status.getBoundingClientRect();
    expect(viewport.scrollTop).toBe(0);
    expect(initialStatusBounds.height).toBe(56);
    expect(initialStatusBounds.top).toBeGreaterThan(viewport.getBoundingClientRect().bottom);
    expect(status.textContent).toContain('Loading available versions');
    expect(status.scrollWidth).toBeLessThanOrEqual(status.clientWidth);
    const spinner = status.querySelector<HTMLElement>('[data-testid="managed-release-loading-spinner"]')!;
    expect(spinner).toBeTruthy();
    expect(spinner.getBoundingClientRect().width).toBeGreaterThanOrEqual(20);
    const animation = spinner.getAnimations()[0];
    expect(animation?.playState).toBe('running');
    const before = getComputedStyle(spinner).transform;
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(getComputedStyle(spinner).transform).not.toBe(before);
    await (commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'reduce' });
    expect(getComputedStyle(spinner).animationName).toBe('none');
    await (commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'no-preference' });
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    await settle();
    expect(status.getBoundingClientRect().top).toBeCloseTo(initialStatusBounds.top, 0);
    setHasMore(false);
    await settle();
    expect(host.querySelector('[data-testid="managed-release-loading-spinner"]')).toBeTruthy();
    setLoading(false);
    await settle();
    expect(host.querySelector('[data-testid="managed-release-more-sentinel"]')).toBe(status);
    expect(status.getBoundingClientRect().height).toBe(initialStatusBounds.height);
    expect(status.textContent).toContain('101 versions loaded');
    setHasMore(true);
    await settle();
    expect(host.querySelector('[data-testid="managed-release-loading-spinner"]')).toBeNull();
    expect(status.getBoundingClientRect().height).toBe(initialStatusBounds.height);
    setError('Could not read the registry.');
    await settle();
    expect(status.textContent).toContain('Could not read the registry.');
    expect(status.getBoundingClientRect().height).toBe(initialStatusBounds.height);
  });

  it('distinguishes queued and active visible-version checks without moving the footer', async () => {
    await page.viewport(1024, 768);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '820px', height: '620px' });
    document.body.appendChild(host);
    const [phase, setPhase] = createSignal<'initial' | 'refresh' | 'load_more' | 'verification_queued' | 'verification' | 'idle'>('verification_queued');
    const [queuedCount, setQueuedCount] = createSignal(7);
    const [activeCount, setActiveCount] = createSignal(0);
    const [filter, setFilter] = createSignal<'all' | 'stable' | 'preview'>('all');
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      schema_version: 2 as const, candidate_id: `phase-${index}`, source_kind: 'oci' as const,
      source: 'registry.example/managed/example-service', tag: `build-${index}`, channel: 'stable' as const,
      trust: 'registry_verified', selectable: false, relation: 'unknown' as const, verification_status: 'pending' as const,
    }));
    dispose = render(() => <ManagedReleaseCandidates
      result={{ schema_version: 2, check_status: 'fresh', catalog_status: 'loading', has_more: true, cursor_id: 'cursor-next', loaded_count: candidates.length, checked_at_unix_ms: Date.now(), candidates }}
      loading={false} requestPhase={phase()} queuedVerificationCount={queuedCount()} verificationCount={activeCount()} error="" query="" filter={filter()} selectedID=""
      onQueryChange={() => undefined} onFilterChange={setFilter} onSelect={() => undefined}
    />, host);
    await settle();

    const viewport = host.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    const status = host.querySelector<HTMLElement>('[data-testid="managed-release-more-sentinel"]')!;
    const statusHeight = status.getBoundingClientRect().height;
    expect(viewport.scrollTop).toBe(0);
    expect(status.textContent).toContain('Preparing checks for 7 visible versions');
    expect(status.getBoundingClientRect().top).toBeGreaterThan(viewport.getBoundingClientRect().bottom);

    setPhase('verification');
    setQueuedCount(0);
    setActiveCount(12);
    await settle();
    expect(status.textContent).toContain('Checking 12 visible versions');
    expect(status.getBoundingClientRect().height).toBe(statusHeight);

    setPhase('load_more');
    await settle();
    expect(status.textContent).toContain('Loading more versions');
    expect(status.getBoundingClientRect().height).toBe(statusHeight);

    await userEvent.click(Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Stable')!);
    await settle();
    expect(status.getBoundingClientRect().height).toBe(statusHeight);
  });

  it('preserves scroll access through large release catalogs', async () => {
    await page.viewport(1024, 768);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '820px', height: '620px' });
    document.body.appendChild(host);
    const candidates = Array.from({ length: 1000 }, (_, index) => ({
      schema_version: 2 as const,
      candidate_id: `large-${index}`,
      source_kind: 'oci' as const,
      source: 'registry.example/managed/example-service',
      tag: `build-${index}`,
      channel: 'stable' as const,
      trust: 'registry_verified',
      selectable: true,
      relation: 'newer' as const,
      verification_status: 'verified' as const,
    }));
    dispose = render(() => <ManagedReleaseCandidates
      result={{ schema_version: 2, check_status: 'fresh', catalog_status: 'complete', has_more: false, loaded_count: candidates.length, checked_at_unix_ms: Date.now(), candidates }}
      loading={false} error="" query="" filter="all" selectedID="" onQueryChange={() => undefined} onFilterChange={() => undefined} onSelect={() => undefined}
    />, host);
    await settle();
    const viewport = document.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    expect(viewport.querySelectorAll('[data-release-id]').length).toBe(1000);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    await settle();
    expect(viewport.querySelector('[data-release-id="large-999"]')).toBeTruthy();
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

  it('keeps the managed service information band height stable while an operation changes state', async () => {
    await page.viewport(1200, 800);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    type ManagedServiceRowService = Parameters<typeof ManagedServiceRowComponent>[0]['service'];
    const initialService: ManagedServiceRowService = {
      service_id: 'mws-stable-band',
      template_id: 'example-desktop-a',
      name: 'Example Desktop A',
      description: 'Run an Ubuntu-based KDE Plasma desktop in an isolated Docker container.',
      template_source: 'builtin',
      deployment: 'container',
      workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-desktop-a',
      workspace_ownership: 'redeven_created',
      release_status: {
        ...releaseStatus('oci', '654ea8e3-ls177'),
        latest_preview_release: { schema_version: 1, kind: 'oci', source: 'example/source', tag: '0.1.2-rc.1', digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        latest_preview_relation: 'newer',
      },
      desired_state: 'running',
      observed_state: 'running',
      forward_id: 'pf-stable-band',
      runtime_port: 54945,
      actions: { start: { available: false }, stop: { available: true }, restart: { available: true }, retry: { available: false } },
    };
    const [service, setService] = createSignal(initialService);
    const [operation, setOperation] = createSignal<ManagedOperation | null>(null);
    dispose = render(() => (
      <ManagedServiceRowComponent
        service={service()}
        operation={operation()}
        operationExpanded={false}
        busy={false}
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onOperationExpandedChange={() => undefined}
        onLogs={() => undefined}
        onUninstall={() => undefined}
      />
    ), host);
    await settle();

    const row = document.querySelector<HTMLElement>('[data-testid="managed-service-row"]')!;
    const band = row.firstElementChild as HTMLElement;
    const heights: number[] = [band.getBoundingClientRect().height];
    const update = (next: ManagedOperation, nextObservedState: string, targetHeights = heights) => {
      setService((current) => ({
        ...current,
        observed_state: nextObservedState,
        actions: { start: { available: false }, stop: { available: false }, restart: { available: false }, retry: { available: false } },
      }));
      setOperation(next);
      return settle().then(() => targetHeights.push(band.getBoundingClientRect().height));
    };

    await update({ operation_id: 'mop-stable-band', service_id: 'mws-stable-band', action: 'start', state: 'submitting', stage: 'starting', progress_current: 0, progress_total: 3 }, 'starting');
    await update({ operation_id: 'mop-stable-band', service_id: 'mws-stable-band', action: 'start', state: 'running', stage: 'starting', progress_current: 1, progress_total: 3 }, 'starting');
    await update({ operation_id: 'mop-stable-band', service_id: 'mws-stable-band', action: 'start', state: 'succeeded', stage: 'completed', progress_current: 3, progress_total: 3 }, 'running');
    await update({ operation_id: 'mop-stable-band-stop', service_id: 'mws-stable-band', action: 'stop', state: 'submitting', stage: 'stopping', progress_current: 0, progress_total: 2 }, 'stopping');
    await update({ operation_id: 'mop-stable-band-stop', service_id: 'mws-stable-band', action: 'stop', state: 'running', stage: 'stopping', progress_current: 1, progress_total: 2 }, 'stopping');
    await update({ operation_id: 'mop-stable-band-stop', service_id: 'mws-stable-band', action: 'stop', state: 'succeeded', stage: 'completed', progress_current: 2, progress_total: 2 }, 'stopped');

    expect(heights).toEqual([72, 72, 72, 72, 72, 72, 72]);

    await page.viewport(720, 800);
    host.style.width = '680px';
    setService((current) => ({ ...current, observed_state: 'running', actions: { start: { available: false }, stop: { available: true }, restart: { available: true }, retry: { available: false } } }));
    setOperation(null);
    await settle();
    const narrowHeights: number[] = [band.getBoundingClientRect().height];
    await update({ operation_id: 'mop-stable-band-narrow', service_id: 'mws-stable-band', action: 'start', state: 'submitting', stage: 'starting', progress_current: 0, progress_total: 3 }, 'starting', narrowHeights);
    await update({ operation_id: 'mop-stable-band-narrow', service_id: 'mws-stable-band', action: 'start', state: 'running', stage: 'starting', progress_current: 1, progress_total: 3 }, 'starting', narrowHeights);
    await update({ operation_id: 'mop-stable-band-narrow', service_id: 'mws-stable-band', action: 'start', state: 'succeeded', stage: 'completed', progress_current: 3, progress_total: 3 }, 'running', narrowHeights);

    expect(new Set(narrowHeights).size).toBe(1);
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
    const [operation, setOperation] = createSignal<ManagedOperation>({
      operation_id: 'mop-retry',
      service_id: 'mws-failed',
      action: 'retry_install',
      state: 'running',
      stage: 'pulling',
      progress_current: 2,
      progress_total: 7,
      progress_detail: {
        schema_version: 2,
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
    });
    const [operationPhase, setOperationPhase] = createSignal<'visible' | 'exiting'>('visible');
    dispose = render(() => (
      <ManagedServiceRow
        service={{
          service_id: 'mws-failed',
          template_id: 'example-container',
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
        operation={operation()}
        operationPhase={operationPhase()}
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
    const operationHeader = row.querySelector<HTMLElement>('[data-testid="managed-operation-header"]')!;
    expect(progress.textContent).toContain('Pulling image');
    expect(progress.textContent).toContain('2.00 KB / 5.00 KB');
    const operationHeaderHeight = operationHeader.getBoundingClientRect().height;
    expect(operationHeaderHeight).toBe(56);
    expect(row.textContent).not.toContain('Error');
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(130);
    expect(row.querySelector('[data-testid="managed-operation-progress"]')).toBeNull();

    await userEvent.click(progress);
    await settle();

    const details = document.querySelector<HTMLElement>('[data-testid="managed-service-operation-details"]')!;
    const stageDetail = details.querySelector<HTMLElement>('[data-testid="managed-operation-stage-detail"]')!;
    expect(details).toBeTruthy();
    expect(details.textContent).toContain('ghcr.io/runzhliu/example-service@sha256:reviewed');
    expect(stageDetail.dataset.stage).toBe('pulling');
    expect(stageDetail.querySelector('[role="progressbar"]')).toBeTruthy();
    expect(stageDetail.querySelector('[data-testid="managed-operation-command-output"]')).toBeNull();
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

    setOperation((current) => ({ ...current, state: 'succeeded', stage: 'completed', progress_current: 7, progress_detail: undefined }));
    await settle();
    expect(progress.textContent).toContain('Completed');
    expect(operationHeader.getBoundingClientRect().height).toBe(operationHeaderHeight);
    expect(progress.querySelector('[data-testid="managed-operation-terminal-icon"]')).toBeTruthy();
    expect(progress.querySelector('.managed-operation-shimmer-text')).toBeNull();
    expect(Array.from(row.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Cancel operation')).toBe(false);

    const disclosure = row.querySelector<HTMLElement>('[data-testid="managed-operation-disclosure"]')!;
    expect(getComputedStyle(disclosure).transitionProperty).toContain('grid-template-rows');
    setOperationPhase('exiting');
    await settle();
    expect(disclosure.dataset.presentationState).toBe('exiting');
    expect(disclosure.getAttribute('aria-hidden')).toBe('true');
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    expect(disclosure.getBoundingClientRect().height).toBeLessThanOrEqual(1);
  });

  it('renders bounded command output and follows only while the user stays at the bottom', async () => {
    await page.viewport(1200, 900);
    const host = document.createElement('div');
    host.style.width = '1024px';
    document.body.appendChild(host);
    const initialOutput = Array.from({ length: 36 }, (_, index) => ({
      sequence: index + 1,
      command_id: 'npm-install',
      stream: (index === 35 ? 'stderr' : 'stdout') as 'stdout' | 'stderr',
      text: `package output line ${index + 1}`,
    }));
    const [operation, setOperation] = createSignal<ManagedOperation>({
      operation_id: 'mop-output', service_id: 'mws-output', action: 'install', state: 'running', stage: 'installing',
      progress_current: 3, progress_total: 7,
      progress_detail: {
        schema_version: 2,
        commands: [{ command_id: 'npm-install', display: '<managed-node> <managed-npm-cli> install package@1.0.0', state: 'running' }],
        output: initialOutput,
        output_truncated: true,
      },
    });
    const [expanded, setExpanded] = createSignal(false);
    dispose = render(() => (
      <ManagedServiceRowComponent
        service={{
          service_id: 'mws-output', template_id: 'example-host', name: 'Example Service',
          template_source: 'custom', deployment: 'host', workspace_path: '/workspace', workspace_ownership: 'user_selected',
          release_status: releaseStatus('npm', '1.0.0'), desired_state: 'running', observed_state: 'installing',
          forward_id: 'pf-output', runtime_port: 3000,
        }}
        operation={operation()}
        operationExpanded={expanded()}
        busy
        canOpen
        canManage
        onOpen={() => undefined}
        onOpenResource={() => undefined}
        onAction={() => undefined}
        onOperationExpandedChange={(_operationID, value) => setExpanded(value)}
        onLogs={() => undefined}
        onUninstall={() => undefined}
        onCancelOperation={() => undefined}
      />
    ), host);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-testid="managed-service-operation-trigger"]')!);
    await settle();

    const output = host.querySelector<HTMLElement>('[data-testid="managed-operation-output"]')!;
    const stageDetail = host.querySelector<HTMLElement>('[data-testid="managed-operation-stage-detail"]')!;
    const commandOutput = host.querySelector<HTMLElement>('[data-testid="managed-operation-command-output"]')!;
    expect(stageDetail.dataset.stage).toBe('installing');
    expect(commandOutput.parentElement).toBe(stageDetail);
    expect(commandOutput.getBoundingClientRect().left).toBeGreaterThanOrEqual(stageDetail.getBoundingClientRect().left);
    expect(commandOutput.getBoundingClientRect().right).toBeLessThanOrEqual(stageDetail.getBoundingClientRect().right);
    expect(output.scrollHeight).toBeGreaterThan(output.clientHeight);
    expect(output.scrollHeight - output.scrollTop - output.clientHeight).toBeLessThanOrEqual(2);
    expect(host.querySelector('[data-testid="managed-operation-command-output"]')?.textContent).toContain('<managed-node> <managed-npm-cli> install package@1.0.0');
    expect(host.querySelector('[data-testid="managed-operation-command-output"]')?.textContent).toContain('Older output was removed.');
    expect(output.querySelector('[data-sequence="36"]')?.textContent).toContain('Error output: package output line 36');

    output.scrollTop = 0;
    output.dispatchEvent(new Event('scroll'));
    setOperation((current) => ({
      ...current,
      progress_detail: { ...current.progress_detail!, output: [...current.progress_detail!.output!, { sequence: 37, command_id: 'npm-install', stream: 'stdout', text: 'user is reading older output' }] },
    }));
    await settle();
    expect(host.querySelector('[data-testid="managed-operation-output"]')).toBe(output);
    expect(output.scrollTop).toBe(0);

    output.scrollTop = output.scrollHeight;
    output.dispatchEvent(new Event('scroll'));
    setOperation((current) => ({
      ...current,
      progress_detail: { ...current.progress_detail!, output: [...current.progress_detail!.output!, { sequence: 38, command_id: 'npm-install', stream: 'stdout', text: 'follow newest output' }] },
    }));
    await settle();
    expect(output.scrollHeight - output.scrollTop - output.clientHeight).toBeLessThanOrEqual(2);
    expect(output.textContent).toContain('follow newest output');
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
            schema_version: 2,
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
            schema_version: 2,
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
