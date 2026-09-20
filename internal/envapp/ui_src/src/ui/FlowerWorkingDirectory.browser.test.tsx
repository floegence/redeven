import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, flush, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

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
    listWorkingDirectoryEntries: vi.fn(async () => []), openWorkingDirectoryInFileBrowser: openFiles,
  }, { layout: true, presentation, companionOpen: true });
  surface.style.cssText = `width:${width}px;height:850px;position:relative;`;
  if (projected) {
    surface.setAttribute('data-floe-dialog-surface-host', 'true');
    surface.style.transform = 'translate(30px, 12px) scale(0.8)';
    surface.style.transformOrigin = 'top left';
  }
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')?.title.includes(directory) === true);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { surface, openFiles };
}

describe('Flower working directory presentation', () => {
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
    await waitFor(() => !!document.querySelector('input[aria-label="Directory path"]'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(surface.contains(dialog)).toBe(true);
    expect(dialog.closest('[data-floe-local-interaction-surface="true"]')).not.toBeNull();
    expect(dialog.style.position).not.toBe('fixed');
    const cancel = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Cancel')!;
    await userEvent.click(cancel);
    await flush();
    expect(document.querySelector('input[aria-label="Directory path"]')).toBeNull();
    expect(surface.querySelector('.flower-working-directory-select')?.getAttribute('aria-label')).toContain(directory);
    expect(document.activeElement).toBe(select);
  });
});
