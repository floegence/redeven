import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import type { FlowerSurfaceAdapter, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const threadID = 'computer-lifecycle';
const frameRef = `computer://browser-main/${'a'.repeat(64)}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' });
function current(outcome?: FlowerRuntimeCurrentView['last_outcome']): FlowerRuntimeCurrentView {
  return { thread_id: threadID, view_version: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: outcome ? 'idle' : 'active',
    ...(outcome ? { last_outcome: outcome } : { run_progress: { phase: 'tool_execution' as const } }),
    items: [{ id: 'observed', kind: 'tool', ordinal: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: {
      item_id: 'observed', tool_id: 'observe', tool_name: 'browser.navigate', status: 'success',
      presentation: { label: 'Observed page', renderer: 'structured', payload: { operation: 'navigate', status: 'success' }, target_refs: [{ kind: 'computer_frame', label: 'Managed browser', resource_ref: frameRef }] },
    } }], interactions: [],
  };
}
function fixture(initial: FlowerRuntimeCurrentView) {
  let canonical = initial;
  const base = thread({ thread_id: threadID });
  const other = thread({ thread_id: 'other-thread', title: 'Another conversation' });
  let revision = 2;
  const snapshot = () => applyFlowerRuntimeCurrentView({ ...base, updated_at_ms: revision,
    read_status: { ...base.read_status, snapshot: { activity_revision: revision } },
  }, canonical);
  let receive: (value: FlowerLiveStreamEnvelope | undefined) => void = () => undefined;
  let connections = 0;
  const setComputerViewer = vi.fn(async (_value: { observer_id: string; revision: number; thread_id?: string; interaction_id?: string }) => undefined);
  const inputComputerControl = vi.fn(async () => undefined);
  const submitInput = vi.fn(adapter(true).submitInput);
  const loadComputerFrame = vi.fn(async (_frame: Parameters<NonNullable<FlowerSurfaceAdapter['loadComputerFrame']>>[0]) => png());
  const loadThread = vi.fn(async (id: string) => id === threadID ? ({ thread: snapshot(), current: canonical }) : ({ thread: other, current: { thread_id: other.thread_id, view_version: 1, activity: 'idle' as const } }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), submitInput, setComputerViewer, inputComputerControl, loadComputerFrame,
    listThreads: vi.fn(async () => [snapshot(), other]), loadThread,
    connectLiveStream: async function* ({ signal }) {
      connections++;
      yield { schema_version: 1, kind: 'ready', observer_id: `observer-${connections}`, summaries: [snapshot(), other] };
      while (!signal.aborted) {
        const value = await new Promise<FlowerLiveStreamEnvelope | undefined>(resolve => {
          const abort = () => resolve(undefined);
          receive = value => { signal.removeEventListener('abort', abort); resolve(value); };
          signal.addEventListener('abort', abort, { once: true });
        });
        if (!value) return;
        yield value;
      }
    },
  }, { layout: true, focusThreadRequest: { request_id: 'focus', thread_id: threadID } });
  return { surface, loadThread, snapshot, submitInput, setComputerViewer, inputComputerControl, loadComputerFrame, connections: () => connections,
    restart: (next: FlowerRuntimeCurrentView) => { canonical = next; revision++; receive(undefined); },
    disconnect: () => receive(undefined), emit: (value: FlowerLiveStreamEnvelope) => receive(value),
    update: (next: FlowerRuntimeCurrentView) => { canonical = next; revision++; receive({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: next }); },
  };
}

async function openStage(surface: HTMLElement) {
  await waitFor(() => Boolean(surface.querySelector('.flower-computer-entry')));
  surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!.click();
  await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === 1);
}

it.each(['browser.navigate', 'computer.exec'])('shows one animated task label for %s and stops it on settlement', async (toolName) => {
  const running = current();
  const initial = { ...running, items: running.items!.map(item => ({ ...item, activity: { ...item.activity!, tool_name: toolName } })) };
  const f = fixture(initial);
  await waitFor(() => Boolean(f.surface.querySelector('.flower-computer-entry')) && Boolean(document.querySelector('.flower-computer-stage-ball')));
  const entry = f.surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!;
  const ball = document.querySelector<HTMLButtonElement>('.flower-computer-stage-ball')!;
  expect(entry.textContent).toBe('Computer running');
  expect(entry.getAttribute('data-floe-progress-shimmer')).toBe('surface');
  expect(entry.querySelector('[data-floe-progress-shimmer="text"]')?.textContent).toBe('Computer running');
  expect(ball.getAttribute('data-floe-progress-shimmer')).toBe('surface');
  expect(f.setComputerViewer).not.toHaveBeenCalled();
  f.update({ ...initial, view_version: 2, interactions: [{ id: 'confirm-next', kind: 'input', turn_id: 'computer-turn', run_id: 'computer-run',
    input: { summary: 'Choose the next step', questions: [{ id: 'next-step', prompt: 'Continue?', kind: 'select', options: ['Continue'] }] },
  }] });
  await waitFor(() => entry.dataset.sessionState === 'awaiting_user');
  expect(entry.textContent).toBe('Waiting for your input or approval');
  expect(entry.hasAttribute('data-floe-progress-shimmer')).toBe(false);
  expect(ball.hasAttribute('data-floe-progress-shimmer')).toBe(false);
  f.update({ ...initial, view_version: 3 });
  await waitFor(() => entry.dataset.sessionState === 'running');
  expect(entry.getAttribute('data-floe-progress-shimmer')).toBe('surface');
  expect(ball.getAttribute('data-floe-progress-shimmer')).toBe('surface');
  f.update({ ...current('completed'), view_version: 4 });
  await waitFor(() => entry.textContent === 'View last screenshot');
  expect(entry.hasAttribute('data-floe-progress-shimmer')).toBe(false);
  expect(entry.querySelector('[data-floe-progress-shimmer]')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
});

it('keeps blue running controls readable across themes with visible motion and static accessibility modes', async () => {
  await page.viewport(1200, 850);
  const f = fixture(current());
  f.surface.style.cssText = 'width: 1100px; height: 740px; margin: 24px;';
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage-ball')));
  const entry = f.surface.querySelector<HTMLElement>('.flower-computer-entry')!;
  const ball = document.querySelector<HTMLElement>('.flower-computer-stage-ball')!;
  const root = document.documentElement;
  const originalStyle = root.getAttribute('style'), originalTheme = root.dataset.floeShellTheme, originalClass = root.className;
  const probe = document.createElement('span'); probe.hidden = true; entry.append(probe);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const color = (variable: string) => {
    probe.style.color = `var(${variable})`;
    context.fillStyle = getComputedStyle(probe).color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel / 255);
  };
  const luminance = (channels: number[]) => channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  try {
    for (const preset of builtInShellThemePresets) {
      root.removeAttribute('style');
      root.classList.toggle('dark', preset.mode === 'dark'); root.classList.toggle('light', preset.mode !== 'dark');
      root.dataset.floeShellTheme = preset.name;
      for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(name, value);
      for (const control of [entry, ball]) {
        control.append(probe);
        for (const hovered of [false, true]) {
          if (hovered) await userEvent.hover(control);
          else await userEvent.unhover(control);
          expect(control.matches(':hover')).toBe(hovered);
          const base = color('--floe-progress-text-base'), peak = color('--floe-progress-text-peak');
          expect(base[2] - base[0], preset.name).toBeGreaterThan(0.1);
          for (const ink of control === entry ? [base, peak] : [base]) for (const surface of [color('--floe-progress-surface-base'), color('--floe-progress-surface-peak')]) {
            const a = luminance(ink), b = luminance(surface);
            expect.soft((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${preset.name}, ${control.className}, hover=${hovered}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(control === entry ? 4.5 : 3);
          }
        }
      }
      if (['classic-light', 'classic-dark'].includes(preset.name)) {
        const inspect = commands as unknown as { inspectComputerProgress: (theme: string) => Promise<{ changed: number[]; reducedMotion: boolean; forcedColors: boolean }> };
        const result = await inspect.inspectComputerProgress(preset.name);
        expect.soft(result.changed.every(value => value > 5), `${preset.name}: ${result.changed}`).toBe(true);
        expect(result.reducedMotion && result.forcedColors).toBe(true);
      }
    }
  } finally {
    probe.remove(); root.className = originalClass;
    if (originalStyle === null) root.removeAttribute('style'); else root.setAttribute('style', originalStyle);
    if (originalTheme === undefined) delete root.dataset.floeShellTheme; else root.dataset.floeShellTheme = originalTheme;
  }
});

it('preserves script intent, disclosure, selection and copy through a live failure', async () => {
  await page.viewport(1100, 850);
  const code = '  const page = await ui.observe();\nlog("Search field found");\n' + '// Inspect the search field before clicking.\n'.repeat(38);
  const scriptView = (failed: boolean): FlowerRuntimeCurrentView => ({
    ...current(failed ? 'completed' : undefined), view_version: failed ? 2 : 1,
    items: [{ id: 'script', kind: 'tool', ordinal: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: {
      item_id: 'script', tool_id: 'script', tool_name: 'computer.exec', status: failed ? 'error' : 'running',
      presentation: { label: 'Locate the search field and verify the page', renderer: 'structured', target_refs: [
        { kind: 'computer_target', label: 'Managed browser', resource_ref: 'browser-main' },
        ...(failed ? [{ kind: 'computer_frame', label: 'Managed browser', resource_ref: frameRef }] : []),
      ], payload: { inputs: [{ content: code, format: 'code', language: 'javascript' }], ...(failed ? {
        rows_provided: true, rows: [{ content: 'Search field found\nClick could not complete', format: 'code', language: 'text' }], error: { message: 'Computer script stopped before completion' },
      } : {}) } },
    } }],
  });
  const f = fixture(scriptView(false));
  await waitFor(() => Boolean(f.surface.querySelector('[data-flower-activity-item-id="script"]')));
  const row = f.surface.querySelector<HTMLElement>('[data-flower-activity-item-id="script"]')!;
  const trigger = row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!;
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => Boolean(row.querySelector('[data-activity-section="inputs"] .chat-code-copy-btn')));
  const input = row.querySelector<HTMLElement>('[data-activity-section="inputs"]')!;
  await waitFor(() => Boolean(input.querySelector('.shiki')));
  const expand = input.querySelector<HTMLButtonElement>('.flower-activity-script-toggle')!;
  expect(input.getBoundingClientRect().height).toBeLessThan(65);
  expect(input.querySelector('h4')).toBeNull();
  expand.focus();
  await userEvent.keyboard('{Enter}');
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(getComputedStyle(expand).cursor).toBe('pointer');
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  input.querySelector<HTMLButtonElement>('.chat-code-copy-btn')!.click();
  await waitFor(() => write.mock.calls.length === 1);
  expect(write).toHaveBeenCalledWith(code);
  await waitFor(() => input.querySelector('[role="status"]')?.textContent === 'Copied');
  const range = document.createRange();
  range.selectNodeContents(input.querySelector('code')!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const selected = window.getSelection()!.toString();
  const codeViewport = input.querySelector<HTMLElement>('.chat-code-content')!;
  codeViewport.scrollTop = 100;
  const scrollTop = codeViewport.scrollTop;
  f.update(scriptView(true));
  await waitFor(() => row.getAttribute('data-flower-activity-status') === 'error');
  expect(row.querySelector('[data-activity-section="inputs"]')).toBe(input);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(window.getSelection()!.toString()).toBe(selected);
  expect(codeViewport.scrollTop).toBe(scrollTop);
  expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe('Locate the search field and verify the page');
  expect(row.textContent).toContain('Computer script stopped before completion');
  expect(row.textContent).toContain('Search field found');
  window.getSelection()!.removeAllRanges();
  const outputCopy = row.querySelector<HTMLButtonElement>('[data-activity-section="results"] .chat-code-copy-btn')!;
  write.mockRejectedValueOnce(new Error('Clipboard unavailable'));
  outputCopy.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => outputCopy.getAttribute('aria-label') === 'Could not copy. Try again.');
  expect(document.activeElement).toBe(outputCopy);
  expand.click();
  const screenshotButton = row.querySelector<HTMLButtonElement>('.flower-activity-computer-block button')!;
  expect(screenshotButton.getBoundingClientRect().width).toBeGreaterThan(90);
  row.querySelector<HTMLElement>('.flower-activity-inline-details-content')!.scrollTop = 0;
  await settle();
  await page.screenshot({ path: '__screenshots__/tool-activity-details.png' });
  expand.click();
  codeViewport.scrollTop = 0;
  await settle();
  await page.screenshot({ path: '__screenshots__/tool-activity-expanded.png' });
  write.mockRestore();
});

it('explains absent historical script details without reconstructing them', async () => {
  const history = current('completed');
  const f = fixture({ ...history, items: [{ id: 'old-script', kind: 'tool', ordinal: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: {
    item_id: 'old-script', tool_id: 'old-script', tool_name: 'computer.exec', status: 'success', presentation: { renderer: 'structured', label: 'Managed browser',
      target_refs: [{ kind: 'computer_target', label: 'Managed browser', resource_ref: 'browser-main' }], payload: { operation: 'execute' } },
  } }] });
  await waitFor(() => Boolean(f.surface.querySelector('[data-flower-activity-item-id="old-script"]')));
  const row = f.surface.querySelector<HTMLElement>('[data-flower-activity-item-id="old-script"]')!;
  expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe('Run script');
  row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  await waitFor(() => row.textContent?.includes('This record did not save the script.') === true);
  expect(row.textContent).toContain('This record did not save result details.');
  expect(row.querySelector('.chat-code-block')).toBeNull();
});

it.each([['completed', 'completed'], ['cancelled', 'stopped'], ['failed', 'failed']] as const)('loads %s history without opening or sampling and exposes only an explicit historical image', async (outcome, state) => {
  const f = fixture(current(outcome));
  await waitFor(() => Boolean(f.surface.querySelector('.flower-computer-entry')));
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  expect(f.setComputerViewer).not.toHaveBeenCalled();
  expect(f.loadComputerFrame).not.toHaveBeenCalled();
  expect(f.surface.querySelector('.flower-computer-entry')?.textContent).toContain('View last screenshot');
  f.surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!.click();
  await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === 1);
  expect(document.querySelector('.flower-computer-stage')?.textContent).toContain('Historical screenshot');
  expect(document.querySelector('.flower-computer-stage .flower-computer-state')?.getAttribute('data-session-state')).toBe(state);
  expect(document.querySelector('.flower-computer-frame-rate')).toBeNull();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(f.setComputerViewer).not.toHaveBeenCalled();
});

it('collapses a terminal run once and does not infer history success from a later text run', async () => {
  const f = fixture(current());
  await openStage(f.surface);
  f.update({ ...current('cancelled'), view_version: 2 });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  const requests = f.setComputerViewer.mock.calls.length;
  f.surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!.click();
  await waitFor(() => document.querySelector('.flower-computer-stage') !== null);
  f.update({ ...current('cancelled'), view_version: 3 });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(document.querySelector('.flower-computer-stage')).not.toBeNull();
  f.update({ ...current(), view_version: 4, turn_id: 'text-turn', run_id: 'text-run' });
  await waitFor(() => document.querySelector('.flower-computer-stage .flower-computer-state') === null);
  expect(document.querySelector('.flower-computer-stage')?.textContent).toContain('Historical screenshot');
  expect(f.setComputerViewer.mock.calls.length).toBe(requests);
});

it('requires explicit recovery and a newly decoded private frame after the workspace disconnects', async () => {
  const waiting = { ...current(), interactions: [{ id: 'takeover', kind: 'input' as const, turn_id: 'computer-turn', run_id: 'computer-run', tool_call_id: 'observe', input: { summary: 'Verification', questions: [{ id: 'computer_control', prompt: 'Return control', kind: 'select', options: ['Return control to Flower'] }] } }] };
  const f = fixture(waiting);
  await waitFor(() => Array.from(f.surface.querySelectorAll('button')).some(b => b.textContent === 'Open page'));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => Boolean(f.setComputerViewer.mock.calls.at(-1)?.[0].interaction_id));
  const offerFrame = () => {
    const viewer = f.setComputerViewer.mock.calls.at(-1)![0];
    f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: viewer.observer_id, viewer_revision: viewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: '1', sequence: 1, mime_type: 'image/png' } });
  };
  offerFrame();
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage textarea')));
  const before = document.querySelector<HTMLImageElement>('.flower-computer-stage img')!.src;
  const oldViewer = f.setComputerViewer.mock.calls.at(-1)![0];
  let finishOldFrame: (value: Blob) => void = () => undefined;
  f.loadComputerFrame.mockImplementationOnce(() => new Promise(resolve => { finishOldFrame = resolve; }));
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: oldViewer.observer_id, viewer_revision: oldViewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'late', sequence: 2, mime_type: 'image/png' } });
  await waitFor(() => f.loadComputerFrame.mock.calls.some(([frame]) => frame.private_frame?.frame_id === 'late'));
  let finishInput: () => void = () => undefined;
  f.inputComputerControl.mockImplementationOnce(() => new Promise(resolve => { finishInput = () => resolve(undefined); }));
  const keyboard = document.querySelector<HTMLTextAreaElement>('.flower-computer-stage textarea')!;
  keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await waitFor(() => f.inputComputerControl.mock.calls.length === 1);
  keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="return"]')!.click();
  f.disconnect();
  await waitFor(() => document.querySelector('.flower-computer-stage textarea') === null);
  await waitFor(() => f.connections() === 2);
  expect(document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.src).toBe(before);
  expect(document.querySelector('.flower-computer-stage .flower-computer-state')?.getAttribute('data-session-state')).toBe('disconnected');
  expect(f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id)).toHaveLength(1);
  finishOldFrame(png()); finishInput();
  await settle();
  expect(f.submitInput).not.toHaveBeenCalled();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.src).toBe(before);
  const loads = f.loadComputerFrame.mock.calls.length;
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: oldViewer.observer_id, viewer_revision: oldViewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'stale', sequence: 3, mime_type: 'image/png' } });
  await settle();
  expect(f.loadComputerFrame.mock.calls.length).toBe(loads);
  const take = f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!;
  expect(take.textContent).toBe('Resume control');
  take.click();
  await waitFor(() => f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id).length === 2);
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  offerFrame();
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage textarea')));
  expect(f.inputComputerControl).toHaveBeenCalledTimes(1);
});

it('opens the next task only on request after automatic terminal collapse', async () => {
  const f = fixture(current());
  await openStage(f.surface);
  f.update({ ...current('completed'), view_version: 2 });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  const text = { ...current(), view_version: 3, turn_id: 'next-turn', run_id: 'next-run' };
  f.update(text); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  const observed = current().items![0];
  const viewerRequests = f.setComputerViewer.mock.calls.length;
  f.update({ ...text, view_version: 4, items: [...text.items!, { ...observed, id: 'next-frame', ordinal: 2, turn_id: 'next-turn', run_id: 'next-run' }] });
  await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')?.getAttribute('aria-expanded')).toBe('false');
  expect(f.setComputerViewer.mock.calls.length).toBe(viewerRequests);
  await openStage(f.surface);
  document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  f.disconnect(); await waitFor(() => f.connections() === 2); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')).not.toBeNull();
});

it.each(['close', 'switch', 'expire'] as const)('discards private decoding when recovery is interrupted by %s', async action => {
  const waiting = { ...current(), interactions: [{ id: 'takeover', kind: 'input' as const, turn_id: 'computer-turn', run_id: 'computer-run', tool_call_id: 'observe', input: { summary: 'Verification', questions: [{ id: 'computer_control', prompt: 'Return control', kind: 'select', options: ['Return control to Flower'] }] } }] };
  const f = fixture(waiting);
  await waitFor(() => Boolean(f.surface.querySelector('[data-computer-control-action="take"]')));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => Boolean(f.setComputerViewer.mock.calls.at(-1)?.[0].interaction_id));
  f.disconnect(); await waitFor(() => f.connections() === 2);
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id).length === 2);
  const viewer = f.setComputerViewer.mock.calls.at(-1)![0];
  let finish: (value: Blob) => void = () => undefined;
  f.loadComputerFrame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loads = f.loadComputerFrame.mock.calls.length;
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: viewer.observer_id, viewer_revision: viewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'recovering', sequence: 1, mime_type: 'image/png' } });
  await waitFor(() => f.loadComputerFrame.mock.calls.length > loads);
  if (action === 'close') document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
  else if (action === 'expire') f.update({ ...current('cancelled'), view_version: 2 });
  else {
    const row = f.surface.querySelector<HTMLElement>('[data-thread-id="other-thread"] button');
    expect(row).not.toBeNull(); row!.click();
  }
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  finish(png()); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(f.inputComputerControl).not.toHaveBeenCalled();
});

it('accepts fresh canonical results when Runtime restart resets process-local view versions', async () => {
  const f = fixture({ ...current(), view_version: 27 });
  await openStage(f.surface);
  f.restart({ ...current('cancelled'), view_version: 1 });
  await waitFor(() => f.connections() === 2);
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(f.surface.querySelector('.flower-computer-entry')?.getAttribute('aria-label')).toContain('Computer task stopped');
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  f.update({ ...current('failed'), view_version: 2 });
  await waitFor(() => f.surface.querySelector('.flower-computer-entry')?.getAttribute('aria-label')?.includes('Computer task failed') === true);
});

it('rejects a delayed HTTP current from the previous Runtime connection', async () => {
  const f = fixture({ ...current(), view_version: 27 });
  await openStage(f.surface);
  let finish: (value: Awaited<ReturnType<typeof f.loadThread>>) => void = () => undefined;
  const calls = f.loadThread.mock.calls.length;
  f.loadThread.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.emit({ schema_version: 1, kind: 'summary.batch', summaries: [{ ...f.snapshot(), updated_at_ms: 3, read_status: { ...f.snapshot().read_status, snapshot: { activity_revision: 3 } } }] });
  await waitFor(() => f.loadThread.mock.calls.length > calls);
  f.restart({ ...current('cancelled'), view_version: 1 });
  await waitFor(() => f.connections() === 2);
  finish({ thread: applyFlowerRuntimeCurrentView(f.snapshot(), current()), current: { ...current(), view_version: 99 } });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(f.surface.querySelector('.flower-computer-entry')?.getAttribute('aria-label')).toContain('Computer task stopped');
});

it('clears public pixels on a sampled CAPTCHA and waits for canonical assistance without an endless spinner', async () => {
  const f = fixture(current());
  await openStage(f.surface);
  const viewer = f.setComputerViewer.mock.calls.at(-1)![0];
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: {
    session_id: viewer.observer_id, viewer_revision: viewer.revision, target_id: 'browser-main', sequence: 2, mime_type: 'image/png',
    error_code: 'computer_control_required', assistance_kind: 'captcha',
  } });
  await waitFor(() => document.querySelector('.flower-computer-stage img') === null);
  expect(document.querySelector('.flower-computer-stage-no-frame')?.textContent).toContain('Complete the CAPTCHA');
  expect(document.querySelector('.flower-computer-stage-no-frame .animate-spin')).toBeNull();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(f.submitInput).not.toHaveBeenCalled();
  expect(f.inputComputerControl).not.toHaveBeenCalled();
});
