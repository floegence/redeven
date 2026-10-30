import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { SUPPORTED_LOCALES, type RedevenLocale } from './i18n/localeMeta';
import { loadEnvAppDictionary, type EnvAppTranslationKey, type EnvAppTranslationShape } from './i18n/locales';
import { adapter, flush, flowerSurfaceNotifications, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function localizedCopy(locale: RedevenLocale, dictionary: EnvAppTranslationShape) {
  const helpers = createI18nHelpers(locale, dictionary);
  return createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => helpers.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => helpers.tn(key as EnvAppTranslationKey, count, params),
  });
}

describe('Flower complete locale presentation', () => {
  it.each(SUPPORTED_LOCALES)('localizes model preference failure notifications in %s', async locale => {
    await page.viewport(1280, 900);
    const copy = localizedCopy(locale, await loadEnvAppDictionary(locale));
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [],
      persistDefaultModel: async () => { throw new Error('Request failed'); },
    }, { copy });
    await waitFor(() => !!surface.querySelector('button.flower-model-reasoning-model-trigger:not(:disabled)'));
    surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!.click();
    await waitFor(() => !!document.querySelector('.flower-model-menu-item:not(:disabled)'));
    document.querySelector<HTMLButtonElement>('.flower-model-menu-item:not(:disabled)')!.click();
    await waitFor(() => flowerSurfaceNotifications().length > 0);
    expect(flowerSurfaceNotifications().at(-1)?.title).toBe(copy.chat.defaultModelUpdateFailedTitle);
  });
  it.each(SUPPORTED_LOCALES)('uses %s for the conversation and published directory picker', async locale => {
    const dictionary = await loadEnvAppDictionary(locale);
    const copy = localizedCopy(locale, dictionary);
    const home = '/Users/alice';
    const surface = renderSurfaceWithAdapterProps({ ...adapter(),
      listThreads: async () => [thread({ working_dir: '/Volumes/project' })],
      directoryFavorites: () => ({ paths: [], onToggle: async () => undefined }),
      getWorkingDirectoryPathContext: async () => ({ agentHomePathAbs: home, homePathAbs: home, defaultRootId: 'home', roots: [
        { id: 'home', label: 'Server home', kind: 'home', pathAbs: home, permissions: { read: true, write: true } },
        { id: 'computer', label: 'Server root', kind: 'computer', pathAbs: '/', permissions: { read: true, write: false } },
      ] }),
      listWorkingDirectoryEntries: async () => [],
    }, { copy });
    await waitFor(() => !!surface.querySelector('.flower-working-directory-select'));
    expect(surface.textContent).toContain(copy.chat.titleFallback);
    expect(surface.querySelector('textarea')?.getAttribute('placeholder')).toBe(copy.chat.placeholder);
    surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!.click();
    await waitFor(() => !!document.querySelector('[data-filesystem-picker]'));
    await flush();
    const dialog = document.querySelector('.flower-working-dir-picker')!;
    for (const label of [copy.chat.workingDirPickerTitle, copy.chat.workingDirPickerRecent, copy.filesystemPicker.favorites, copy.filesystemPicker.home, copy.filesystemPicker.root, copy.filesystemPicker.cancel, copy.chat.workingDirPickerConfirm]) {
      expect(dialog.textContent, `${locale}: ${label}`).toContain(label);
    }
    const homeTab = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(tab => tab.textContent === copy.filesystemPicker.home)!;
    homeTab.click();
    await flush();
    expect(dialog.textContent).toContain(copy.filesystemPicker.showHidden);
    expect(dialog.textContent).toContain(copy.filesystemPicker.go);
    expect(dialog.querySelector('input')?.getAttribute('aria-label')).toBe(copy.filesystemPicker.path);
    expect(dialog.textContent).not.toContain('Server home');
  });

  it.each(SUPPORTED_LOCALES)('keeps directory creation usable in %s at narrow and desktop widths', async locale => {
    const copy = localizedCopy(locale, await loadEnvAppDictionary(locale));
    const createWorkingDirectory = vi.fn(async () => { throw { code: 409 }; });
    const home = '/Users/alice';
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [], createWorkingDirectory,
      getWorkingDirectoryPathContext: async () => ({ agentHomePathAbs: home, homePathAbs: home, defaultRootId: 'home', roots: [{ id: 'home', kind: 'home', label: 'Home', pathAbs: home, permissions: { read: true, write: true } }] }),
      listWorkingDirectoryEntries: async () => [],
    }, { copy });
    await waitFor(() => !!surface.querySelector('.flower-working-directory-select'));
    for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(width, 900);
      surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!.click();
      await waitFor(() => !!document.querySelector('[data-filesystem-picker]'));
      await flush();
      const modalCount = document.querySelectorAll('[aria-modal=true]').length;
      await page.getByRole('button', { name: copy.filesystemPicker.newFolder, exact: true }).click();
      const input = document.querySelector<HTMLInputElement>('input[aria-label="' + copy.filesystemPicker.folderName + '"]')!;
      expect(document.activeElement).toBe(input);
      const popup = document.querySelector<HTMLElement>('[data-floe-popover-panel]')!;
      expect(popup.getAttribute('aria-modal')).toBe('false');
      expect(document.querySelectorAll('[aria-modal=true]').length).toBe(modalCount);
      expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth + 1);
      input.value = 'Existing project'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await page.getByRole('button', { name: copy.filesystemPicker.create, exact: true }).click();
      await waitFor(() => !!document.querySelector('[data-picker-create-folder] [role="alert"]'));
      expect(document.querySelector('[data-picker-create-folder] [role="alert"]')?.textContent).toBe(copy.filesystemPicker.folderExists);
      const dialog = document.querySelector<HTMLElement>('.flower-working-dir-picker')!;
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      const controls = Array.from(popup.querySelectorAll<HTMLButtonElement>('[data-picker-create-folder] button'));
      for (const control of controls) expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
      if (locale === 'zh-CN' && theme === 'dark') {
        await Promise.all(popup.getAnimations().map(animation => animation.finished));
        await page.screenshot({ path: '__screenshots__/directory-picker-zh-CN-dark-' + width + '.png' });
      }
      popup.querySelector<HTMLButtonElement>('button[type=button]')!.click();
      await waitFor(() => !document.querySelector('[data-picker-create-folder]'));
      expect(document.querySelector('[data-filesystem-picker]')).toBeTruthy();
      expect(document.activeElement?.textContent).toBe(copy.filesystemPicker.newFolder);
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === copy.filesystemPicker.cancel)!.click();
      await waitFor(() => !document.querySelector('[data-filesystem-picker]'));
    }
    document.documentElement.classList.remove('dark');
    expect(createWorkingDirectory).toHaveBeenCalledTimes(4);
  });

  it('updates a retained conversation when its active language changes', async () => {
    const dictionaries = { 'en-US': await loadEnvAppDictionary('en-US'), 'zh-CN': await loadEnvAppDictionary('zh-CN') };
    const [locale, setLocale] = createRoot(dispose => {
      onTestFinished(dispose);
      return createSignal<'en-US' | 'zh-CN'>('zh-CN');
    });
    const copy = () => localizedCopy(locale(), dictionaries[locale()]);
    const pathContext = vi.fn(async () => ({ agentHomePathAbs: '/Users/alice', homePathAbs: '/Users/alice', defaultRootId: 'home', roots: [
      { id: 'home', label: 'Home', kind: 'home', pathAbs: '/Users/alice', permissions: { read: true, write: true } },
      { id: 'computer', label: 'Root', kind: 'computer', pathAbs: '/', permissions: { read: true, write: false } },
    ] }));
    const surface = renderSurfaceWithAdapterProps({ ...adapter(),
      directoryFavorites: () => ({ paths: [], onToggle: async () => undefined }),
      getWorkingDirectoryPathContext: pathContext,
      listWorkingDirectoryEntries: async () => [],
    }, { get copy() { return copy(); } });
    await waitFor(() => !!surface.querySelector('textarea'));
    const editor = surface.querySelector('textarea')!;
    editor.value = 'Keep this draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!.click();
    await waitFor(() => !!document.querySelector('[data-filesystem-picker]'));
    await flush();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(tab => tab.textContent === copy().filesystemPicker.home)!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('[data-filesystem-picker] input')!;
    input.value = '/draft-unconfirmed';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const contextReads = pathContext.mock.calls.length;
    expect(document.querySelector('[role=tablist]')?.textContent).toContain('主目录');
    setLocale('en-US');
    await flush();
    expect(surface.textContent).toContain(copy().chat.titleFallback);
    expect(surface.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('Keep this draft');
    expect(editor?.getAttribute('placeholder')).toBe(copy().chat.placeholder);
    expect(document.querySelector('[data-filesystem-picker] input')).toBe(input);
    expect(input.value).toBe('/draft-unconfirmed');
    expect(pathContext).toHaveBeenCalledTimes(contextReads);
    expect(document.querySelector('[role=tablist]')?.textContent).toContain('Home');
    expect(document.querySelector('[role=tablist]')?.textContent).not.toContain('主目录');
  });
});
