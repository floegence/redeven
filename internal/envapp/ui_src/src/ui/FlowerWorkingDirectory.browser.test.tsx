import '../index.css';
import './flower-feature.css';

import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, flush, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { REDEVEN_BROWSER_MOBILE_QUERY } from './mobileViewportPolicy';

// Unicode paths are intentional: truncation must preserve the exact dispatch target.
const directory = '/Volumes/projects/客户项目/redeven-enterprise-customer-experience-platform';
const pathContext = { agentHomePathAbs: '/home/test', homePathAbs: '/home/test', defaultRootId: 'project', roots: [
  { id: 'project', label: 'Project', pathAbs: directory, kind: 'custom', permissions: { read: true, write: true } },
] };

afterEach(() => document.documentElement.classList.remove('dark'));

async function fixture(width: number, dark = false, projected = false, presentation: 'full' | 'companion' = 'full') {
  await page.viewport(width, 900);
  document.documentElement.classList.toggle('dark', dark);
  const openFiles = vi.fn(async () => undefined);
  const surface = renderSurfaceWithAdapterProps({
    ...adapter(), getWorkingDirectoryPathContext: async () => pathContext,
    listThreads: async () => [thread({ working_dir: directory })],
    listWorkingDirectoryEntries: vi.fn(async () => []), openWorkingDirectoryInFileBrowser: openFiles,
  }, { layout: true, mobileQuery: REDEVEN_BROWSER_MOBILE_QUERY, presentation, companionOpen: true });
  surface.style.cssText = `width:${width}px;height:850px;position:relative;`;
  if (projected) {
    surface.setAttribute('data-floe-dialog-surface-host', 'true');
    surface.style.transform = 'translate(30px, 12px) scale(0.8)';
    surface.style.transformOrigin = 'top left';
  }
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')?.title.includes(directory) === true);
  expect(surface.querySelector('[data-flower-interaction-mode]')?.getAttribute('data-flower-interaction-mode')).toBe('desktop');
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { surface, openFiles };
}

describe('Flower working directory presentation', () => {
  it('restores one playful hero turn with overshoot and honors reduced motion', async () => {
    const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    try {
      const { surface } = await fixture(720);
      const icon = surface.querySelector<SVGElement>('.flower-empty-hero-badge svg')!;
      const animation = icon.getAnimations()[0];
      expect(animation).toBeDefined();
      animation.pause();
      const timing = animation.effect!.getTiming();
      expect(timing.iterations).toBe(1);
      expect(timing.duration).toBe(1200);
      await userEvent.fill(surface.querySelector<HTMLTextAreaElement>('textarea')!, 'Keep the welcome animation stable');
      expect(surface.querySelector('.flower-empty-hero-badge svg')).toBe(icon);
      expect(icon.getAnimations()[0]).toBe(animation);
      animation.currentTime = Number(timing.delay) + 840;
      const peak = new DOMMatrix(getComputedStyle(icon).transform);
      expect(Math.hypot(peak.a, peak.b)).toBeCloseTo(1.12, 2);
      expect(Math.atan2(peak.b, peak.a) * 180 / Math.PI).toBeCloseTo(30, 1);
      animation.currentTime = Number(timing.delay) + 1200;
      expect(new DOMMatrix(getComputedStyle(icon).transform).isIdentity).toBe(true);
      await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
      expect(getComputedStyle(icon).animationName).toBe('none');
      expect(getComputedStyle(icon).transform).toBe('none');
    } finally {
      await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    }
  });

  it.each([
    [320, 'full'], [720, 'full'], [1280, 'full'], [320, 'companion'], [720, 'companion'],
  ] as const)('keeps long directory controls within the real Flower layout at %s px in %s', async (width, presentation) => {
    const { surface, openFiles } = await fixture(width, false, false, presentation);
    const header = surface.querySelector<HTMLElement>('.flower-chat-header')!.getBoundingClientRect();
    const browse = surface.querySelector<HTMLButtonElement>('.flower-working-directory-browse')!;
    const select = surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!;
    const row = surface.querySelector<HTMLElement>('.flower-new-working-directory')!;
    const hero = surface.querySelector<HTMLElement>('.flower-empty-hero')!.getBoundingClientRect();
    expect(browse.getBoundingClientRect().right).toBeLessThanOrEqual(header.right);
    expect(browse.getBoundingClientRect().left).toBeGreaterThanOrEqual(header.left);
    expect(browse.scrollWidth).toBeLessThanOrEqual(browse.clientWidth + 1);
    expect(select.scrollWidth).toBeLessThanOrEqual(select.clientWidth + 1);
    expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(hero.right + 1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    expect(getComputedStyle(surface.querySelector('.flower-new-working-directory-label')!).whiteSpace).toBe('nowrap');
    expect(select.getBoundingClientRect().width).toBeGreaterThan(70);
    expect(select.getAttribute('aria-label')).toContain(directory);
    expect(browse.title).toContain(directory);
    expect(select.querySelector('.flower-working-directory-name-end')?.textContent).toBe('platform');
    expect(getComputedStyle(select.querySelector('.flower-working-directory-name-start')!).textOverflow).toBe('ellipsis');
    expect(surface.querySelector('[data-flower-composer-control="working_dir"]')).toBeNull();
    await userEvent.click(browse);
    expect(openFiles).toHaveBeenCalledExactlyOnceWith({ path: directory });
  });

  it.each([false, true])('distinguishes the editable directory with theme-aware blue in dark=%s', async (dark) => {
    const { surface } = await fixture(720, dark);
    const select = surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!;
    const label = surface.querySelector('.flower-new-working-directory-label')!;
    const probe = document.createElement('span');
    probe.style.color = dark ? 'var(--color-blue-400)' : 'var(--color-blue-600)';
    select.parentElement!.appendChild(probe);
    expect(getComputedStyle(select).color).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(select).color).not.toBe(getComputedStyle(label).color);
    expect(getComputedStyle(select).cursor).toBe('pointer');
    expect(getComputedStyle(select).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    for (const icon of select.querySelectorAll('.flower-working-directory-icon, .flower-working-directory-chevron')) {
      expect(getComputedStyle(icon).color).toBe(getComputedStyle(select).color);
    }
  });

  it('opens the published picker in a projected surface and restores the editable entry on cancellation', async () => {
    const { surface } = await fixture(900, false, true);
    const select = surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!;
    select.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !!document.querySelector('[data-picker-suggested-path]'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(surface.contains(dialog)).toBe(true);
    expect(dialog.closest('[data-floe-local-interaction-surface="true"]')).not.toBeNull();
    expect(dialog.style.position).not.toBe('fixed');
    const tabs = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map(tab => tab.textContent)).toEqual(['Recently used', 'Project']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => !!dialog.querySelector('input[aria-label="Directory path"]'));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(dialog.querySelector('[data-picker-suggestions]')).toBeNull();
    await userEvent.click(tabs[0]);
    const recent = dialog.querySelector<HTMLButtonElement>('[data-picker-suggested-path]')!;
    expect(recent.title).toBe(directory);
    recent.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Select')!.disabled);
    expect(document.activeElement).toBe(document.querySelector('input[aria-label="Directory path"]'));
    const cancel = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Cancel')!;
    await userEvent.click(cancel);
    await flush();
    expect(document.querySelector('input[aria-label="Directory path"]')).toBeNull();
    expect(surface.querySelector('.flower-working-directory-select')?.getAttribute('aria-label')).toContain(directory);
    expect(document.activeElement).toBe(select);
  });

  it('keeps recent names and paths within a narrow directory picker', async () => {
    const { surface } = await fixture(320, true);
    await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!);
    await waitFor(() => !!document.querySelector('[data-picker-suggested-path]'));
    const recent = document.querySelector<HTMLButtonElement>('[data-picker-suggested-path]')!;
    expect(recent.getAttribute('aria-label')).toBe(directory);
    expect(recent.scrollWidth).toBeLessThanOrEqual(recent.clientWidth + 1);
    expect(getComputedStyle(recent).cursor).toBe('pointer');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(recent.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
    expect(recent.getBoundingClientRect().left).toBeGreaterThanOrEqual(dialog.getBoundingClientRect().left);
  });
});
