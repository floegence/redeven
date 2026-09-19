import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { FlowerComputerStage, type FlowerComputerStageSessionState } from '../../../../flower_ui/src/FlowerComputerStage';

// No navigation harness: these checks use the published window, panel and icons.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const states = { awaiting_control: 'Waiting for you to take control', historical: 'Historical screenshot', stopped: 'Computer task stopped', disconnected: 'Connection lost', taking_control:'Taking control', user_control:'You are controlling', returning_control:'Returning control', paused:'Viewing paused', running: 'Computer running', awaiting_user: 'Waiting for input or approval', completed: 'Computer task completed', failed: 'Computer task failed' };
const waitFor = async (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5000, interval: 16 });

for (const [projected, portrait] of [[false, false], [true, false], [false, true], [true, true]]) {
  it(`fits the screenshot to the entire content area with a non-live notice (projected=${projected}, portrait=${portrait})`, async () => {
    await page.viewport(1200, 900);
    const host = document.createElement('div'); document.body.append(host);
    const canvas = document.createElement('canvas'); canvas.width = portrait ? 720 : 1280; canvas.height = portrait ? 1280 : 720;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f3f4f6'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff'; context.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
    context.save(); context.scale(canvas.width / 1280, canvas.width / 1280);
    context.fillStyle = '#25334a'; context.font = '500 40px sans-serif'; context.fillText('Quarterly overview', 64, 100);
    context.fillStyle = '#64748b'; context.font = '24px sans-serif'; context.fillText('A captured browser view', 64, 148);
    for (let index = 0; index < 8; index++) {
      context.fillStyle = index === 7 ? '#315b83' : '#b9cfdf';
      context.fillRect(64 + index * 145, 520 - index * 35, 100, 110 + index * 35);
    }
    context.restore();
    context.strokeStyle = '#25334a'; context.lineWidth = 8; context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const [boundary, setBoundary] = createSignal<HTMLElement>();
    const [width, setWidth] = createSignal(1000);
    const staleLabel = '最后拍摄的画面 · 非实时';
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <div ref={setBoundary} data-floe-dialog-surface-host={projected ? 'true' : undefined}
        style={{ position: 'relative', width: `${width()}px`, height: '700px', transform: projected ? 'scale(0.7)' : undefined, 'transform-origin': 'top left' }}>
        <FlowerComputerStage threadID="screenshot-layout" boundary={boundary()} open historical sessionState="completed" staleLabel={staleLabel}
          frame={{ thread_id: 'screenshot-layout', target_id: 'browser-main', resource_ref: `computer://browser-main/${'a'.repeat(64)}`, sha256: 'a'.repeat(64) }} loadFrame={async () => blob}
          snapshot={{ item: { item_id: 'frame', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false }, status: 'success', targetID: 'browser-main', target: 'Chrome', action: 'Quarterly overview' }}
          copy={{ frameRate: 'Frame rate', frameRateHint: 'Preview rate', receivedFrameRate: 'Receiving {fps} FPS', title: '历史截图', close: '关闭', maximize: '最大化', restoreSize: '还原', zoomIn: '实际大小', zoomOut: '适应窗口', restore: 'Restore viewer', move: 'Move viewer', noFrame: 'Loading', retry: 'Retry', resumeControl: 'Resume control', state: states }}
          onClose={() => {}} onRestore={() => {}} />
      </div>
    </LayoutProvider></FloeConfigProvider>, host);
    try {
      await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === canvas.width);
      const stage = document.querySelector<HTMLElement>('.flower-computer-stage')!;
      const content = stage.querySelector<HTMLElement>('[data-floe-floating-window-content]')!;
      const image = stage.querySelector<HTMLImageElement>('img')!;
      const assertFit = () => {
        const available = content.getBoundingClientRect(), actual = image.getBoundingClientRect();
        expect(Math.abs(actual.width - available.width), 'the notice must not take screenshot width').toBeLessThan(1);
        expect(Math.abs(actual.height - available.height)).toBeLessThan(1);
        expect(Math.abs(actual.left - available.left)).toBeLessThan(1);
        expect(Math.abs(actual.top - available.top)).toBeLessThan(1);
        expect(getComputedStyle(image).objectFit).toBe('contain');
        expect(content.textContent?.trim()).toBe('');
        const footer = stage.querySelector<HTMLElement>('[data-floe-floating-window-footer]')!;
        expect(footer.textContent).toContain(staleLabel);
        expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
      };
      assertFit();
      const scenario = `${projected ? 'projected' : 'ordinary'}-${portrait ? 'portrait' : 'landscape'}`;
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark);
        await page.screenshot({ element: stage, path: `__screenshots__/computer-screenshot-${scenario}-${dark ? 'dark' : 'light'}.png` });
      }
      const originalWidth = stage.getBoundingClientRect().width;
      await (commands as unknown as { resizeComputerViewer: () => Promise<void> }).resizeComputerViewer();
      expect(stage.getBoundingClientRect().width).toBeLessThan(originalWidth - 40);
      assertFit();
      stage.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="maximize"]')!.click();
      await waitFor(() => content.getBoundingClientRect().width > (projected ? 600 : 900));
      assertFit();
      stage.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="maximize"]')!.click();
      setWidth(340);
      await waitFor(() => stage.getBoundingClientRect().width < 340);
      assertFit();
      await page.screenshot({ element: stage, path: `__screenshots__/computer-screenshot-${scenario}-narrow.png` });
    } finally { dispose(); host.remove(); document.documentElement.classList.remove('dark'); }
  });
}

for (const projected of [false, true]) {
  it(`moves across the Flower surface and preserves window and launcher geometry (projected=${projected})`, async () => {
    await page.viewport(1440, 1000);
    const host = document.createElement('div'); document.body.append(host);
    const [open, setOpen] = createSignal(true);
    const [owner, setOwner] = createSignal('window-thread');
    const [state, setState] = createSignal<FlowerComputerStageSessionState>('running');
    const [boundary, setBoundary] = createSignal<HTMLElement>();
    const [launcherBoundary, setLauncherBoundary] = createSignal<HTMLElement>();
    const [dockHeight, setDockHeight] = createSignal(100);
    const input = vi.fn();
    const blob = new Blob([Uint8Array.from(atob(PNG), value => value.charCodeAt(0))], { type: 'image/png' });
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <div ref={setBoundary} class="flower-surface" data-floe-dialog-surface-host={projected ? 'true' : undefined}
        style={{ position: 'relative', width: '900px', 'max-width': '100%', height: '650px', transform: projected ? 'scale(0.7)' : undefined, 'transform-origin': 'top left' }}>
        <aside class="flower-component-thread-rail" style={{ width: '200px', height: '100%' }} />
        <div class="flower-chat-header" style={{ position: 'absolute', left: '200px', right: '0', top: '0', height: '50px' }} />
        <div ref={setLauncherBoundary} class="flower-chat-transcript" style={{ position: 'absolute', top: '50px', bottom: `${dockHeight()}px`, left: '200px', right: '0' }} />
        <div class="flower-chat-bottom-dock" style={{ position: 'absolute', bottom: '0', width: '100%', height: `${dockHeight()}px` }} />
        <FlowerComputerStage threadID={owner()} boundary={boundary()} launcherBoundary={launcherBoundary()} open={open()} sessionState={state()}
          snapshot={{ item: { item_id: 'frame', kind: 'tool', status: 'running', severity: 'quiet', needs_attention: false, requires_approval: false }, status: 'running', targetID: 'browser-main', target: 'Browser', action: 'Browse' }}
          frame={{ thread_id: "fixture", target_id: "browser-main", resource_ref: `computer://browser-main/${"a".repeat(64)}`, sha256: "a".repeat(64) }} loadFrame={async () => blob} onInput={input} onClose={() => setOpen(false)} onRestore={() => setOpen(true)}
          copy={{ frameRate: 'Frame rate', frameRateHint: 'Higher frame rates use more bandwidth.', receivedFrameRate: 'Receiving {fps} FPS', title: 'Computer', close: 'Close', maximize: 'Maximize', restoreSize: 'Restore', zoomIn: 'Actual size', zoomOut: 'Fit to window', restore: 'Restore viewer', move: 'Move viewer (arrow keys)', noFrame: 'Loading', retry: 'Retry', resumeControl: 'Resume control', state: states }} />
      </div>
    </LayoutProvider></FloeConfigProvider>, host);
    try {
      await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === 1);
      const hiddenLauncher = document.querySelector<HTMLButtonElement>('.flower-computer-stage-ball')!;
      expect(hiddenLauncher.tabIndex).toBe(-1);
      expect(getComputedStyle(hiddenLauncher).visibility).toBe('hidden');
      expect(getComputedStyle(hiddenLauncher).pointerEvents).toBe('none');
      const exercise = commands as unknown as { exerciseComputerViewer: () => Promise<{ pixelsDecoded: boolean }> };
      expect((await exercise.exerciseComputerViewer()).pixelsDecoded).toBe(true);
      await page.viewport(390, 740);
      const touch = commands as unknown as { exerciseComputerLauncherTouch: () => Promise<{ touch: boolean }> };
      expect((await touch.exerciseComputerLauncherTouch()).touch).toBe(true);
      await page.viewport(1440, 1000);
      expect(input).not.toHaveBeenCalled();
      document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
      await waitFor(() => document.querySelector('.flower-computer-stage') === null);
      const launcher = document.querySelector<HTMLButtonElement>('.flower-computer-stage-ball')!;
      expect(document.activeElement).toBe(launcher);
      const colors = new Set<string>();
      for (const next of Object.keys(states) as FlowerComputerStageSessionState[]) {
        setState(next);
        await waitFor(() => launcher.dataset.sessionState === next);
        expect(launcher.getAttribute('aria-description')).toContain(states[next]);
        colors.add([getComputedStyle(launcher).backgroundColor, getComputedStyle(launcher).borderColor, getComputedStyle(launcher).color].join('|'));
      }
      expect(colors.size).toBe(1);
      expect(getComputedStyle(launcher).width).toBe('40px');
      expect(getComputedStyle(launcher.querySelector('svg')!).width).toBe('20px');
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark);
        expect(getComputedStyle(launcher).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(launcher).boxShadow).not.toBe('none');
      }
      setDockHeight(240);
      await waitFor(() => launcher.getBoundingClientRect().bottom <= launcherBoundary()!.getBoundingClientRect().bottom - 10);
      setOwner('next-window-thread');
      await waitFor(() => document.querySelector('.flower-computer-stage-ball') !== launcher);
      await waitFor(() => {
        const next = document.querySelector('.flower-computer-stage-ball')!.getBoundingClientRect();
        const bounds = launcherBoundary()!.getBoundingClientRect();
        return Math.abs(next.right - bounds.right + 12) < 2 && Math.abs(next.bottom - bounds.bottom + 12) < 2;
      });
      expect(document.querySelector('.flower-computer-stage')).toBeNull();
      expect(input).not.toHaveBeenCalled();
    } finally {
      dispose(); host.remove(); document.documentElement.classList.remove('dark');
    }
  });
}

it('returns focus to each restore entry and offers actual-size viewing without changing takeover input', async () => {
  await page.viewport(1200, 900);
  const host = document.createElement('div'); document.body.append(host);
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600;
  canvas.getContext('2d')!.fillRect(0, 0, 960, 600);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
  const [open, setOpen] = createSignal(false);
  const [source, setSource] = createSignal<HTMLElement>();
  const [takeover, setTakeover] = createSignal(false);
  const [boundary, setBoundary] = createSignal<HTMLElement>();
  const input = vi.fn();
  const restore = (element: HTMLElement) => { setSource(element); setOpen(true); };
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <button type="button" data-testid="header-entry" onClick={event => restore(event.currentTarget)}>Computer</button>
    <button type="button" data-testid="activity-entry" onClick={event => restore(event.currentTarget)}>Activity</button>
    <div ref={setBoundary} style={{ width: '800px', height: '600px' }} />
    <FlowerComputerStage threadID="focus-thread" boundary={boundary()} launcherBoundary={boundary()} open={open()} sessionState="failed"
      restoreFocus={source()} onRestore={restore} onClose={() => setOpen(false)} frame={{ thread_id: "fixture", target_id: "browser-main", resource_ref: `computer://browser-main/${"a".repeat(64)}`, sha256: "a".repeat(64) }} loadFrame={async () => blob} onInput={takeover() ? input : undefined}
      snapshot={{ item: { item_id: 'frame', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false }, status: 'success', targetID: 'browser-main', target: 'Browser', action: 'Browse' }}
      copy={{ frameRate: 'Frame rate', frameRateHint: 'Higher frame rates use more bandwidth.', receivedFrameRate: 'Receiving {fps} FPS', title: 'Computer', close: 'Close viewer', maximize: 'Maximize viewer', restoreSize: 'Restore viewer size', zoomIn: 'Actual size', zoomOut: 'Fit to window', restore: 'Restore viewer', move: 'Move viewer', noFrame: 'Loading', retry: 'Retry', resumeControl: 'Resume control', state: states }} />
  </LayoutProvider></FloeConfigProvider>, host);
  try {
    for (const selector of ['[data-testid="header-entry"]', '[data-testid="activity-entry"]', '.flower-computer-stage-ball']) {
      const entry = document.querySelector<HTMLButtonElement>(selector)!;
      entry.click();
      await waitFor(() => document.activeElement?.getAttribute('data-floe-floating-window-control') === 'close');
      const img = document.querySelector<HTMLImageElement>('.flower-computer-stage img')!;
      await waitFor(() => img.naturalWidth === 960);
      expect(document.querySelector('.flower-computer-stage .flower-computer-state')?.textContent).toBe(states.failed);
      const [fit, zoom] = [...document.querySelectorAll<HTMLButtonElement>('.flower-computer-zoom')];
      expect(fit.getAttribute('aria-pressed')).toBe('true');
      zoom.click();
      expect(zoom.getAttribute('aria-pressed')).toBe('true');
      expect(fit.getAttribute('aria-pressed')).toBe('false');
      await waitFor(() => Math.abs(img.getBoundingClientRect().width - 960) < 0.1);
      fit.click();
      expect(img.getBoundingClientRect().width).toBeLessThan(960);
      document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
      await waitFor(() => document.activeElement === entry);
      await waitFor(() => !document.querySelector('.flower-computer-stage'));
    }
    setTakeover(true);
    document.querySelector<HTMLButtonElement>('[data-testid="activity-entry"]')!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-computer-stage img')));
    expect(document.querySelector('.flower-computer-zoom')).toBeNull();
    expect(input).not.toHaveBeenCalled();
  } finally { dispose(); host.remove(); }
});

it('does not show endless loading when a waiting conversation has no frame subscription', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <FlowerComputerStage threadID="waiting-thread" open sessionState="awaiting_user"
      snapshot={{ item: { item_id: 'observe', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false }, status: 'success', targetID: 'task-page', target: 'Flower managed browser', action: 'Read results' }}
      onClose={() => {}} onRestore={() => {}}
      copy={{ frameRate: 'Frame rate', frameRateHint: 'Preview rate', receivedFrameRate: 'Receiving {fps} FPS', title: 'Computer', close: 'Close', maximize: 'Maximize', restoreSize: 'Restore', zoomIn: 'Actual size', zoomOut: 'Fit', restore: 'Restore viewer', move: 'Move viewer', noFrame: 'No screenshot available', retry: 'Retry', resumeControl: 'Resume control', state: states }} />
  </LayoutProvider></FloeConfigProvider>, host);
  try {
    await waitFor(() => Boolean(document.querySelector('.flower-computer-stage')));
    expect(document.querySelector('.flower-computer-stage-no-frame .animate-spin')).toBeNull();
    expect(document.querySelector('.flower-computer-stage-no-frame')?.textContent).toContain('No screenshot available');
  } finally { dispose(); host.remove(); }
});
