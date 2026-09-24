import '../index.css';
import './flower-feature.css';
import './activity-flower-shell.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { BottomBarCompanion, type BottomBarCompanionPhase } from '@floegence/floe-webapp-core/layout';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerSurfaceProps } from '../../../../flower_ui/src';
import type { FlowerLiveStreamEnvelope, FlowerApprovalAction } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy, type FlowerSurfaceTranslator } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { EnvAppTranslationKey } from './i18n/locales';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS, REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS, resolveWorkbenchTextSelectionSurfaceTarget } from './workbench/surface/workbenchTextSelectionSurface';
import { resolveWorkbenchWheelRouting } from './workbench/surface/workbenchInputRouting';
import { adapter, deferred, liveBootstrap, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function mountApprovals(count: number, options: { copy?: FlowerSurfaceProps['copy']; full?: boolean; command?: string; transformAction?: (action: FlowerApprovalAction, index: number) => FlowerApprovalAction } = {}) {
  let snapshot = thread({
    thread_id: 'approval-layout', status: 'waiting_approval',
    approval_actions: Array.from({ length: count }, (_, index) => ({
      action_id: `approval-${index}`, turn_id: 'turn-fixture', origin: 'main_tool' as const, run_id: 'run-layout',
      tool_id: `tool-${index}`, tool_name: 'terminal.exec', state: 'requested' as const,
      status: 'pending' as const, requested_at_ms: 1, can_approve: true, queue_order: index,
      summary: { label: `Inspect installed development tools ${index + 1}`,
        command: options.command ?? 'for c in node npm pnpm yarn python3 pip3 pipx go cargo rustc; do command -v "$c"; done' },
    })).map((action, index) => options.transformAction?.(action, index) ?? action),
  });
  const base = adapter(true);
  const events: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  let version = 20;
  const replaceActions = (actions: readonly FlowerApprovalAction[]) => {
    snapshot = { ...snapshot, approval_actions: actions };
    const current = liveBootstrap(snapshot, ++version).current;
    events.push({ schema_version: 1, kind: 'thread.batch', thread_id: snapshot.thread_id, current });
    wake?.();
    return current;
  };
  const surfaceAdapter = { ...base, submitApproval: vi.fn(base.submitApproval), listThreads: vi.fn(async () => [snapshot]),
    loadThread: vi.fn(async () => liveBootstrap(snapshot, version)),
    connectLiveStream: vi.fn(async function* (input) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [snapshot] };
      while (!input.signal.aborted) {
        if (!events.length) await new Promise<void>(resolve => {
          const resume = () => { input.signal.removeEventListener('abort', resume); resolve(); };
          wake = resume;
          input.signal.addEventListener('abort', resume, { once: true });
        });
        const event = events.shift();
        if (!input.signal.aborted && event) yield event;
      }
    }),
  };
  const runtime = document.createElement('div');
  const anchor = document.createElement('div');
  const mount = document.createElement('div');
  Object.assign(anchor.style, { position: 'fixed', left: '50%', bottom: '3px', width: '360px', height: '22px', transform: 'translateX(-50%)' });
  document.body.append(runtime, anchor, mount);
  const [phase, setPhase] = createSignal<BottomBarCompanionPhase>('collapsed');
  const [open, setOpen] = createSignal(true);
  const product = () => (
      <FlowerSurface adapter={surfaceAdapter} notify={vi.fn()} draftCoordinator={createFlowerComposerDraftCoordinator()}
        copy={options.copy} presentation={options.full ? 'full' : 'companion'} companionOpen={open() || phase() !== 'collapsed'} engaged={open()} transcriptVisible={open()}
        approvalScrollViewportProps={REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        approvalReadingProps={REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS}
        focusThreadRequest={{ request_id: 'layout', thread_id: snapshot.thread_id }} />
  );
  if (options.full) Object.assign(mount.style, { width: '900px', height: '500px' });
  const dispose = render(() => options.full ? product() : (
    <BottomBarCompanion retained visible open={open()} anchor={anchor} mount={mount} expandedWidth={544}
      id="approval-layout-companion" label="Flower" class="flower-activity-companion" onPhaseChange={setPhase}>
      {product()}
    </BottomBarCompanion>
  ), options.full ? mount : runtime);
  onTestFinished(() => { dispose(); runtime.remove(); anchor.remove(); mount.remove(); });
  return { mount, phase, surfaceAdapter, replaceActions, actions: snapshot.approval_actions!, setOpen };
}

it('keeps every approval footer control inside the published companion shell', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(2);
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.mount.querySelector('.flower-approval-queue-footer')));
  const shell = fixture.mount.querySelector<HTMLElement>('[data-floe-bottom-bar-companion]')!;
  const footer = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-footer')!;
  const bottom = shell.getBoundingClientRect().bottom;
  for (const button of footer.querySelectorAll('button')) {
    expect(button.getBoundingClientRect().bottom, 'footer controls must remain inside the bounded shell').toBeLessThanOrEqual(bottom - 4);
  }
  expect(fixture.mount.querySelector<HTMLElement>('.flower-decision-surface')!.getBoundingClientRect().height).toBeLessThanOrEqual(300);
});

function expectFooterInside(mount: HTMLElement) {
  const shell = mount.querySelector<HTMLElement>('[data-floe-bottom-bar-companion]') ?? mount;
  const surface = mount.querySelector<HTMLElement>('.flower-decision-surface')!;
  const footer = mount.querySelector<HTMLElement>('.flower-approval-queue-footer')!;
  const bounds = shell.getBoundingClientRect();
  expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
  for (const button of footer.querySelectorAll('button')) {
    const rect = button.getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom - 3);
    expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
    expect(rect.right).toBeLessThanOrEqual(bounds.right);
  }
  for (const button of mount.querySelectorAll('.flower-approval-queue-list button')) {
    const rect = button.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
    expect(rect.right).toBeLessThanOrEqual(bounds.right);
  }
}

it.each([1, 2, 10, 50])('bounds %s approvals across narrow, short, and full companion sizes', async count => {
  const fixture = mountApprovals(count);
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.mount.querySelector('.flower-approval-queue-footer')));
  for (const [width, height] of [[1280, 800], [320, 640], [800, 320], [320, 320]]) {
    await page.viewport(width, height);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expectFooterInside(fixture.mount);
    const list = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-list')!;
    expect(list.clientHeight).toBeGreaterThan(0);
    list.scrollTop = list.scrollHeight;
    const last = list.lastElementChild!.getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom + 1);
    const lastButton = list.lastElementChild!.querySelector('.flower-approval-decision-approve')!;
    await waitFor(() => {
      const bounds = list.getBoundingClientRect();
      const button = lastButton.getBoundingClientRect();
      list.scrollTop += button.top - bounds.top;
      const reached = lastButton.getBoundingClientRect();
      return reached.top >= bounds.top - 1 && reached.bottom <= bounds.bottom + 1;
    });
    const lastDecision = lastButton.getBoundingClientRect();
    expect(lastDecision.top, `the final decision must be fully reachable at ${width}x${height}; viewport height ${list.clientHeight}`).toBeGreaterThanOrEqual(list.getBoundingClientRect().top - 1);
    expect(lastDecision.bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom + 1);
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
    if (count > 2) expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  }
});

it.each(['en-US', 'zh-CN', 'de-DE', 'ru-RU'] as const)('keeps %s controls readable in both themes, narrow containers, and enlarged text', async locale => {
  await page.viewport(1280, 800);
  const i18n = createTestI18nHelpers(locale);
  const translator: FlowerSurfaceTranslator = { locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) };
  const copy = createLocalizedFlowerSurfaceCopy(translator);
  const fixture = mountApprovals(2, { copy });
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.mount.querySelector('.flower-approval-queue-footer')));
  const original = document.documentElement.className;
  const originalSize = document.documentElement.style.fontSize;
  onTestFinished(() => { document.documentElement.className = original; document.documentElement.style.fontSize = originalSize; });
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark);
    for (const width of [1280, 320]) {
      await page.viewport(width, 800);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expectFooterInside(fixture.mount);
      await page.screenshot({ element: fixture.mount.querySelector<HTMLElement>('[data-floe-bottom-bar-companion]')!, path: `__screenshots__/approval-${locale}-${width}-${dark ? 'dark' : 'light'}.png` });
    }
  }
  document.documentElement.style.fontSize = '24px';
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expectFooterInside(fixture.mount);
});

it('preserves expanded commands, exact copying, and reading focus when two approvals become one', async () => {
  await page.viewport(1280, 800);
  const command = '\n  ' + Array.from({ length: 20 }, (_, i) => `printf 'line ${i}: inspect /workspace/a-very-long-path/${'directory/'.repeat(10)}'`).join('\n') + '\n';
  const fixture = mountApprovals(2, { command });
  await waitFor(() => Boolean(fixture.mount.querySelector('.flower-approval-command-toggle')));
  const rows = [...fixture.mount.querySelectorAll<HTMLElement>('[data-flower-composer-approval]')];
  const toggle = rows[1].querySelector<HTMLButtonElement>('.flower-approval-command-toggle')!;
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(rows[1].querySelector('pre')?.textContent).toBe(command);
  await page.viewport(800, 640);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await page.viewport(1280, 800);
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  onTestFinished(() => clipboard.mockRestore());
  await userEvent.click(rows[1].querySelector('.flower-approval-copy-btn')!);
  expect(clipboard).toHaveBeenCalledWith(command);
  fixture.setOpen(false);
  await waitFor(() => fixture.phase() === 'collapsed');
  fixture.setOpen(true);
  await waitFor(() => fixture.phase() === 'expanded');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fixture.replaceActions(fixture.actions.map(action => ({ ...action, summary: { ...action.summary } })));
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(fixture.mount.querySelectorAll('[data-flower-composer-approval]')[1]).toBe(rows[1]);
  await userEvent.click(rows[1].querySelector('.flower-approval-copy-btn')!);
  expect(clipboard).toHaveBeenLastCalledWith(command);
  const decision = rows[0].querySelector<HTMLButtonElement>('.flower-approval-decision-approve')!;
  decision.focus();
  fixture.replaceActions(fixture.actions.slice(1));
  await waitFor(() => fixture.mount.querySelectorAll('[data-flower-composer-approval]').length === 1);
  expect(fixture.mount.querySelector('[data-flower-composer-approval]')).toBe(rows[1]);
  await waitFor(() => document.activeElement === rows[1]);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await userEvent.keyboard('{Enter}');
  expect(fixture.surfaceAdapter.submitApproval).not.toHaveBeenCalled();
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expectFooterInside(fixture.mount);
});

it('keeps the published approval shell contained at 200 percent browser zoom', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(2);
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.mount.querySelector('.flower-approval-queue-footer')));
  const zoom = commands as unknown as { inspectFlowerApprovalZoom: () => Promise<{
    devicePixelRatio: number; viewportWidth: number; overflow: number; clippedControls: number; screenshotWidth: number;
  }> };
  const result = await zoom.inspectFlowerApprovalZoom();
  expect(result.devicePixelRatio).toBe(2);
  expect(result.viewportWidth).toBe(640);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.clippedControls).toBe(0);
  expect(result.screenshotWidth).toBeGreaterThan(900);
});

it('keeps a failed decision local, retryable, and separate from other approvals', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(2);
  const error = 'Connection interrupted. Try again. ' + 'The requested action is still pending. '.repeat(80);
  fixture.surfaceAdapter.submitApproval.mockRejectedValueOnce(new Error(error));
  await waitFor(() => Boolean(fixture.mount.querySelector('[data-flower-composer-approval]')));
  const rows = [...fixture.mount.querySelectorAll<HTMLElement>('[data-flower-composer-approval]')];
  await userEvent.click(rows[0].querySelector('.flower-approval-decision-approve')!);
  await waitFor(() => Boolean(rows[0].querySelector('[role="alert"]')));
  expect(rows[0].textContent).toContain('Connection interrupted. Try again.');
  expect(rows[1].querySelector('[role="alert"]')).toBeNull();
  expect(rows[1].querySelector<HTMLButtonElement>('.flower-approval-decision-approve')!.disabled).toBe(false);
  const list = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-list')!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  expectFooterInside(fixture.mount);
});

it('preserves the reading position when expanding and collapsing a command in a long queue', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(10, { command: Array.from({ length: 12 }, (_, i) => `printf 'step ${i}'`).join('\n') });
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.mount.querySelector('.flower-approval-command-toggle')));
  const list = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-list')!;
  const row = list.children[5] as HTMLElement;
  row.scrollIntoView({ block: 'start' });
  const top = row.getBoundingClientRect().top;
  const toggle = row.querySelector<HTMLButtonElement>('.flower-approval-command-toggle')!;
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(Math.abs(row.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(list.scrollTop).toBeGreaterThan(0);
  expectFooterInside(fixture.mount);
});

it('keeps actual targets, declared risks, and unavailable reasons visible while disclosing supporting context', async () => {
  await page.viewport(320, 640);
  const path = '/workspace/' + 'long-directory/'.repeat(12) + 'settings.json';
  const fixture = mountApprovals(2, { transformAction: (action, index) => ({ ...action,
    can_approve: index === 0, read_only_reason: index === 1 ? 'This action requires the task owner.' : undefined,
    tool_name: index === 0 ? 'file.edit' : 'web_fetch',
    summary: index === 0 ? {
      label: 'Update project settings', description: 'Apply the selected development configuration.',
      targets: [{ kind: 'file' as const, label: path }, { kind: 'file' as const, label: '/workspace/package.json' }, { kind: 'working_directory' as const, label: '/workspace' }],
      risk: 'Changes the project configuration.',
    } : { label: 'Read service documentation', targets: [{ kind: 'web_url' as const, label: 'https://example.test/reference' }] },
  }) });
  await waitFor(() => fixture.phase() === 'expanded' && fixture.mount.textContent?.includes('Update project settings') === true);
  const rows = [...fixture.mount.querySelectorAll<HTMLElement>('[data-flower-composer-approval]')];
  expect(rows[0].querySelector('.flower-approval-targets')?.textContent).toContain(path);
  expect(rows[0].querySelector('.flower-approval-risk')?.textContent).toBe('Changes the project configuration.');
  expect(rows[1].querySelector('.flower-approval-targets')?.textContent).toBe('https://example.test/reference');
  expect(rows[1].querySelector('.flower-approval-status')?.textContent).toBe('This action requires the task owner.');
  expect(rows[1].querySelector<HTMLButtonElement>('.flower-approval-decision-approve')!.disabled).toBe(true);
  expect(fixture.mount.querySelector('.flower-approval-eligible-count')?.textContent).toBe('Can approve · 1');
  const details = rows[0].querySelector('details')!;
  expect(details.open).toBe(false);
  await userEvent.click(details.querySelector('summary')!);
  expect(details.open).toBe(true);
  expect(details.textContent).toContain('Apply the selected development configuration.');
  expect(details.textContent).toContain('/workspace');
  const list = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-list')!;
  expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
  expectFooterInside(fixture.mount);
});

it('freezes a submitted batch while a new approval arrives', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(2);
  const response = deferred<Awaited<ReturnType<typeof fixture.surfaceAdapter.submitApproval>>>();
  fixture.surfaceAdapter.submitApproval.mockImplementation(() => response.promise);
  await waitFor(() => Boolean(fixture.mount.querySelector('.flower-approval-queue-footer')));
  await userEvent.click(fixture.mount.querySelector('.flower-approval-queue-footer .flower-approval-decision-approve')!);
  const third = { ...fixture.actions[0], action_id: 'approval-new', tool_id: 'tool-new', queue_order: 3 };
  fixture.replaceActions([...fixture.actions, third]);
  await waitFor(() => fixture.mount.querySelectorAll('[data-flower-composer-approval]').length === 3);
  expect(fixture.surfaceAdapter.submitApproval).toHaveBeenCalledExactlyOnceWith({ thread_id: 'approval-layout', interaction_ids: ['approval-0', 'approval-1'], approved: true });
  expect(fixture.mount.querySelector<HTMLButtonElement>('[data-flower-approval-action-id="approval-new"] .flower-approval-decision-approve')!.disabled).toBe(false);
  const current = fixture.replaceActions([third]);
  response.resolve({ ok: true, current });
  await waitFor(() => fixture.mount.querySelectorAll('[data-flower-composer-approval]').length === 1);
});

it('marks only the constrained approval list for selected Workbench scrolling and keeps touch targets usable', async () => {
  await page.viewport(1280, 800);
  const fixture = mountApprovals(10, { full: true });
  fixture.mount.setAttribute('data-redeven-workbench-widget-root', 'true');
  fixture.mount.setAttribute('data-redeven-workbench-widget-id', 'approval-widget');
  await waitFor(() => Boolean(fixture.mount.querySelector('.flower-approval-queue-list')));
  expectFooterInside(fixture.mount);
  const list = fixture.mount.querySelector<HTMLElement>('.flower-approval-queue-list')!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const command = list.querySelector('pre')!;
  expect(resolveWorkbenchTextSelectionSurfaceTarget({ target: command, widgetRoot: fixture.mount })).toBe(command.closest('.flower-approval-body'));
  expect(resolveWorkbenchWheelRouting({ target: list, disablePanZoom: false, selectedWidgetId: 'approval-widget' }).kind).toBe('local_surface');
  expect(resolveWorkbenchWheelRouting({ target: list, disablePanZoom: false, selectedWidgetId: null }).kind).toBe('canvas_zoom');
  const footer = fixture.mount.querySelector('.flower-approval-queue-footer')!;
  expect(resolveWorkbenchWheelRouting({ target: footer, disablePanZoom: false, selectedWidgetId: 'approval-widget' }).kind).toBe('ignore');
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await touch.emulateTouchInput(true);
  onTestFinished(() => touch.emulateTouchInput(false));
  for (const button of fixture.mount.querySelectorAll<HTMLButtonElement>('.flower-approval-surface button')) {
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
