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
const states = { running: 'Computer running', awaiting_user: 'Waiting for input or approval', completed: 'Computer task completed', failed: 'Computer task failed' };
const waitFor = async (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5000, interval: 16 });

for (const projected of [false, true]) {
  it(`preserves native window geometry and snaps its launcher inside content (projected=${projected})`, async () => {
    await page.viewport(1440, 1000);
    const host = document.createElement('div'); document.body.append(host);
    const [open, setOpen] = createSignal(true);
    const [owner, setOwner] = createSignal('window-thread');
    const [state, setState] = createSignal<FlowerComputerStageSessionState>('running');
    const [boundary, setBoundary] = createSignal<HTMLElement>();
    const [dockHeight, setDockHeight] = createSignal(100);
    const input = vi.fn();
    const blob = new Blob([Uint8Array.from(atob(PNG), value => value.charCodeAt(0))], { type: 'image/png' });
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <div data-floe-dialog-surface-host={projected ? 'true' : undefined}
        style={{ position: 'relative', width: '900px', height: '650px', transform: projected ? 'scale(0.7)' : undefined, 'transform-origin': 'top left' }}>
        <div class="flower-chat-header" style={{ height: '50px' }} />
        <div ref={setBoundary} class="flower-chat-transcript" style={{ position: 'absolute', top: '50px', bottom: `${dockHeight()}px`, left: '0', right: '0' }} />
        <div class="flower-chat-bottom-dock" style={{ position: 'absolute', bottom: '0', width: '100%', height: `${dockHeight()}px` }} />
        <FlowerComputerStage threadID={owner()} boundary={boundary()} open={open()} sessionState={state()}
          snapshot={{ item: { item_id: 'frame', kind: 'tool', status: 'running', severity: 'quiet', needs_attention: false, requires_approval: false }, status: 'running', targetID: 'browser-main', target: 'Browser', action: 'Browse', location: 'local', safety: '' }}
          userFrame={blob} onInput={input} onClose={() => setOpen(false)} onRestore={() => setOpen(true)}
          copy={{ title: 'Computer', close: 'Close', minimize: 'Minimize', restore: 'Restore viewer', move: 'Move viewer (arrow keys)', noFrame: 'Loading', retry: 'Retry', state: states }} />
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
        colors.add(getComputedStyle(launcher).getPropertyValue('--flower-computer-stage-state'));
      }
      expect(colors.size).toBe(4);
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark);
        expect(getComputedStyle(launcher).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(launcher).boxShadow).not.toBe('none');
      }
      setDockHeight(240);
      await waitFor(() => launcher.getBoundingClientRect().bottom <= boundary()!.getBoundingClientRect().bottom - 10);
      setOwner('next-window-thread');
      await waitFor(() => document.querySelector('.flower-computer-stage-ball') !== launcher);
      await waitFor(() => {
        const next = document.querySelector('.flower-computer-stage-ball')!.getBoundingClientRect();
        const bounds = boundary()!.getBoundingClientRect();
        return Math.abs(next.right - bounds.right + 12) < 2 && Math.abs(next.bottom - bounds.bottom + 12) < 2;
      });
      expect(document.querySelector('.flower-computer-stage')).toBeNull();
      expect(input).not.toHaveBeenCalled();
    } finally {
      dispose(); host.remove(); document.documentElement.classList.remove('dark');
    }
  });
}
