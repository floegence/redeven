import '../../index.css';

import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHistoryModeSwitch } from './GitHistoryModeSwitch';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

describe('Git mode unavailable tooltip placement', () => {
  it.each([
    { width: 1280, left: 80, top: 56, controlWidth: 320, projected: false },
    { width: 390, left: 8, top: 8, controlWidth: 280, projected: false },
    { width: 1280, left: 80, top: 56, controlWidth: 320, projected: true },
  ])('keeps the entire mode switch clear at $width px (projected: $projected)', async ({ width, left, top, controlWidth, projected }) => {
    await page.viewport(width, 640);
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${controlWidth}px` });
    if (projected) {
      host.setAttribute('data-floe-dialog-surface-host', 'true');
      host.style.height = '480px';
    }
    document.body.append(host);
    const change = vi.fn();
    const preview = vi.fn();
    dispose = render(() => (
      <GitHistoryModeSwitch
        mode="files"
        onChange={change}
        onPreviewGitMode={preview}
        gitHistoryDisabled
        gitHistoryDisabledReason="Current path is not inside a Git repository."
      />
    ), host);
    const group = host.querySelector<HTMLElement>('[data-browser-mode-switch]')!;
    const anchor = host.querySelector<HTMLElement>('[data-redeven-tooltip-anchor]')!;
    const git = host.querySelector<HTMLButtonElement>('button:disabled')!;
    const samples: { gap: number; placement: string | undefined }[] = [];
    let frame = 0;
    const sample = () => {
      const tooltip = document.querySelector<HTMLElement>('[role=tooltip]');
      if (tooltip && getComputedStyle(tooltip).visibility === 'visible') {
        samples.push({ gap: tooltip.getBoundingClientRect().top - group.getBoundingClientRect().bottom, placement: tooltip.dataset.placement });
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    try {
      await page.elementLocator(anchor).hover();
      await vi.waitFor(() => expect(samples.length).toBeGreaterThanOrEqual(12));
      const tooltip = document.querySelector<HTMLElement>('[role=tooltip]')!;
      const rect = tooltip.getBoundingClientRect();
      expect(Math.min(...samples.map(({ gap }) => gap))).toBeGreaterThanOrEqual(4);
      expect(samples.every(({ placement }) => placement === 'bottom')).toBe(true);
      expect(rect.left).toBeGreaterThanOrEqual(7);
      expect(rect.right).toBeLessThanOrEqual(width - 7);
      expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth + 1);
      expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight + 1);
      expect(git.disabled).toBe(true);
      expect(preview).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
      await page.screenshot({ path: `__screenshots__/git-mode-tooltip-${width}-${projected ? 'surface' : 'viewport'}.png` });
      await page.elementLocator(host.querySelector('button')!).hover();
      await vi.waitFor(() => expect(document.querySelector('[role=tooltip]')).toBeNull());
    } finally {
      cancelAnimationFrame(frame);
    }
  });
});
