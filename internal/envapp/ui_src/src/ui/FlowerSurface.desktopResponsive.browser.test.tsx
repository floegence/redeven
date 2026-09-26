import '../index.css';
import './flower-feature.css';

import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { render } from 'solid-js/web';
import { FlowerEmptyState } from '../../../../flower_ui/src/chat/FlowerEmptyState';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { adapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

import { REDEVEN_BROWSER_MOBILE_QUERY } from './mobileViewportPolicy';
const touchCommands = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };

const disposers: Array<() => void> = [];
afterEach(async () => { disposers.splice(0).forEach(dispose => dispose()); await touchCommands.emulateTouchInput(false); });

describe('Flower desktop space allocation', () => {
  it.each([800, 768, 767, 600, 480])('retains all welcome content in a %i px desktop chat region', async width => {
    await page.viewport(1280, 900);
    const host = document.createElement('div'); document.body.append(host);
    let draft = '';
    const dispose = render(() => <div class="flower-component-shell" data-flower-interaction-mode="desktop" style={{ display: 'block', width: `${width}px`, height: '800px' }}>
      <div class="flower-chat-shell"><FlowerEmptyState workingDirectory={<button>Project directory</button>} onSuggestionClick={prompt => { draft = prompt; }} /></div>
    </div>, host);
    disposers.push(() => { dispose(); host.remove(); });
    await page.screenshot({ element: host, path: `__screenshots__/desktop-welcome-${width}.png` });
    const hero = host.querySelector<HTMLElement>('.flower-empty-hero')!;
    expect(getComputedStyle(hero).display).not.toBe('none');
    expect(getComputedStyle(host.querySelector('.flower-empty-hint')!).display).not.toBe('none');
    const cards = [...host.querySelectorAll<HTMLButtonElement>('.flower-empty-suggestion')];
    expect(cards.filter(card => card.getBoundingClientRect().height > 0)).toHaveLength(4);
    expect(getComputedStyle(host.querySelector('.flower-empty-expand')!).display).toBe('none');
    for (const [index, card] of cards.entries()) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      await userEvent.click(card);
      expect(draft).toBe(DEFAULT_FLOWER_SURFACE_COPY.emptyState.suggestions[index].prompt);
    }
  });

  it('retains the composer and conversation search while a desktop sidebar changes placement', async () => {
    await page.viewport(1280, 850);
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true),
      listThreads: async () => Array.from({ length: 80 }, (_, index) => thread({ thread_id: `thread-${index}`, title: `Deploy ${index}` })),
    }, { layout: true });
    surface.style.cssText = 'position:relative;width:100%;height:800px';
    await waitFor(() => Boolean(surface.querySelector('.flower-composer textarea:not(:disabled)')));
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    const search = surface.querySelector<HTMLInputElement>('.flower-thread-search-input')!;
    await userEvent.fill(search, 'Deploy');
    const list = surface.querySelector<HTMLElement>('.flower-thread-list .flower-scroll')!;
    list.scrollTop = 340;
    expect(list.scrollTop).toBe(340);
    await userEvent.fill(editor, 'Retained draft 中文');
    editor.setSelectionRange(2, 7);
    surface.style.width = '640px';
    await waitFor(() => surface.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'overlay');
    expect(surface.querySelector('[data-flower-mobile-pane]')).toBeNull();
    const trigger = surface.querySelector<HTMLButtonElement>('.flower-chat-header .flower-mobile-navigation-button')!;
    await userEvent.click(trigger);
    await waitFor(() => Boolean(surface.querySelector('[data-floe-drawer-side="left"]')));
    expect(surface.querySelector('.flower-thread-search-input')).toBe(search);
    expect(search.value).toBe('Deploy');
    expect(list.scrollTop).toBe(340);
    await waitFor(() => Boolean(surface.querySelector('[data-floe-drawer-side="left"]')?.contains(document.activeElement)));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !surface.querySelector('[data-floe-drawer-side="left"]'));
    await waitFor(() => document.activeElement === trigger);
    await userEvent.click(trigger);
    await waitFor(() => Boolean(surface.querySelector('[data-floe-drawer-side="left"]')));
    await userEvent.click(surface.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!);
    await waitFor(() => !surface.querySelector('[data-floe-drawer-side="left"]'));
    await waitFor(() => document.activeElement === trigger);
    surface.style.width = '1024px';
    await waitFor(() => surface.querySelector('[data-flower-sidebar-presentation]')?.getAttribute('data-flower-sidebar-presentation') === 'inline');
    expect(surface.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('Retained draft 中文');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
    expect(surface.querySelector('.flower-thread-search-input')).toBe(search);
    expect(list.scrollTop).toBe(340);
  });
});


describe('Flower shared interaction mode', () => {
  it.each([false, true])('follows the browser primary input policy through repeated resizing with touch=%s', async touch => {
    await touchCommands.emulateTouchInput(touch);
    await page.viewport(1280, 850);
    const surface = renderSurfaceWithAdapterProps(adapter(), { layout: true, mobileQuery: REDEVEN_BROWSER_MOBILE_QUERY });
    surface.style.cssText = 'width:100%;height:800px;position:relative';
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-hero')));
    for (const width of [800, 768, 767, 640, 768, 767, 1280]) {
      await page.viewport(width, 850);
      const mobile = touch && width < 768;
      await waitFor(() => surface.querySelector('[data-flower-interaction-mode]')?.getAttribute('data-flower-interaction-mode') === (mobile ? 'mobile' : 'desktop'));
      expect(getComputedStyle(surface.querySelector('.flower-empty-hero')!).display === 'none').toBe(mobile);
      expect(surface.querySelector('[data-flower-mobile-pane]') !== null).toBe(mobile);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    }
  });

  it('keeps native Desktop interaction even with a narrow coarse-pointer viewport', async () => {
    await touchCommands.emulateTouchInput(true);
    await page.viewport(640, 720);
    const surface = renderSurfaceWithAdapterProps(adapter(), { layout: true, mobileQuery: 'not all' });
    surface.style.cssText = 'width:100%;height:680px;position:relative';
    await waitFor(() => Boolean(surface.querySelector('.flower-empty-hero')));
    expect(surface.querySelector('[data-flower-interaction-mode]')?.getAttribute('data-flower-interaction-mode')).toBe('desktop');
    expect(surface.querySelector('[data-flower-mobile-pane]')).toBeNull();
    expect([...surface.querySelectorAll('.flower-empty-suggestion')].filter(card => card.getBoundingClientRect().height > 0)).toHaveLength(4);
  });
});
