import '../../index.css';
import { expectSingleInputFocus } from '../../styles/inputFocus.test-support';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FlowerTurnLauncherPanel,
  FlowerTurnLauncherWindow,
} from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';

type Theme = 'light' | 'dark';

type Viewport = Readonly<{
  width: number;
  height: number;
}>;

const disposers: Array<() => void> = [];
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };

afterEach(async () => {
  await media.emulateTouchInput(false);
  while (disposers.length > 0) disposers.pop()?.();
  document.documentElement.classList.remove('light', 'dark');
  document.body.innerHTML = '';
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function nextFrame(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function mountLauncher(theme: Theme, viewport: Viewport) {
  await page.viewport(viewport.width, viewport.height);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    background: 'var(--background)',
  });
  document.body.appendChild(host);

  const pending = deferred<void>();
  let submitCount = 0;
  disposers.push(render(
    () => (
      <LayoutProvider>
        <FlowerTurnLauncherWindow
          open
          intent={{
            id: `browser-${theme}-${viewport.width}`,
            source_surface: 'file_preview',
            suggested_working_dir: '/Users/demo/project',
            context_items: [{
              kind: 'file_path',
              path: '/Users/demo/project/src/very-long-file-name-for-layout-validation.ts',
              is_directory: false,
            }],
            pending_attachments: [],
            notes: [],
          }}
          onClose={() => undefined}
          onSubmit={() => {
            submitCount += 1;
            return pending.promise;
          }}
        />
      </LayoutProvider>
    ),
    host,
  ));
  await nextFrame(3);
  await expect.poll(() => document.querySelector('.flower-ask-card')?.getAnimations().some(animation => animation.playState === 'running')).toBe(false);

  return {
    host,
    pending,
    submitCount: () => submitCount,
  };
}

async function mountPanel(theme: Theme, viewport: Viewport) {
  await page.viewport(viewport.width, viewport.height);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '40px',
    background: 'var(--background)',
  });
  document.body.appendChild(host);
  disposers.push(render(
    () => (
      <LayoutProvider>
        <FlowerTurnLauncherPanel
          open
          intent={{
            id: `browser-panel-${theme}-${viewport.width}`,
            source_surface: 'file_preview',
            suggested_working_dir: '/Users/demo/project',
            context_items: [],
            pending_attachments: [],
            notes: [],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
      </LayoutProvider>
    ),
    host,
  ));
  await nextFrame(3);
  return host;
}

function expectStableAnchoredRect(
  beforeButton: DOMRect,
  beforeEditor: DOMRect,
  afterButton: DOMRect,
  afterEditor: DOMRect,
): void {
  expect(Math.abs((afterEditor.right - afterButton.right) - (beforeEditor.right - beforeButton.right))).toBeLessThan(1);
  expect(Math.abs((afterEditor.bottom - afterButton.bottom) - (beforeEditor.bottom - beforeButton.bottom))).toBeLessThan(1);
  expect(Math.abs(afterButton.width - beforeButton.width)).toBeLessThan(1);
  expect(Math.abs(afterButton.height - beforeButton.height)).toBeLessThan(1);
}

describe('Flower turn launcher send feedback', () => {
  it.each([
    { viewport: { width: 1440, height: 900 }, expectedHeight: 200 },
    { viewport: { width: 390, height: 844 }, expectedHeight: 240 },
  ])('fits references above the editor within a content-sized card below $expectedHeight px', async ({ viewport, expectedHeight }) => {
    const mounted = await mountLauncher('dark', viewport);
    const floatingWindow = document.querySelector('.flower-turn-launcher-window');
    const dock = document.querySelector('.floe-prompt-card-composer');
    if (!(floatingWindow instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      throw new Error('Flower launcher window fixture did not mount.');
    }

    const frameRect = floatingWindow.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    expect(frameRect.height).toBeLessThan(expectedHeight);
    expect(document.querySelector('[data-floe-floating-window-titlebar]')).toBeNull();
    expect(document.querySelector('.floe-prompt-card-question')).toBeNull();
    const references = document.querySelector('.floe-prompt-card-references')!.getBoundingClientRect();
    const editor = document.querySelector('textarea')!.getBoundingClientRect();
    expect(references.bottom).toBeLessThanOrEqual(editor.top);
    expect(document.querySelector('.flower-turn-launcher-footer')).toBeNull();
    expect(Math.abs(dockRect.bottom - frameRect.bottom)).toBeLessThanOrEqual(48);
    expect(frameRect.right).toBeLessThanOrEqual(viewport.width);
    expect(frameRect.bottom).toBeLessThanOrEqual(viewport.height);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    disposers.pop()?.();
    mounted.host.remove();
    await nextFrame();
  });

  it('keeps the working-directory footer in panel placement', async () => {
    const host = await mountPanel('dark', { width: 1440, height: 900 });
    expect(host.querySelector('.flower-turn-launcher-footer')).not.toBeNull();
    expect(host.textContent).toContain('Working dir');
  });

  it('keeps the circular ArrowUp action stable while loading across themes and viewports', async () => {
    const cases: ReadonlyArray<Readonly<{ theme: Theme; viewport: Viewport; touch?: boolean }>> = [
      { theme: 'light', viewport: { width: 1440, height: 900 } },
      { theme: 'dark', viewport: { width: 1440, height: 900 } },
      { theme: 'light', viewport: { width: 390, height: 844 } },
      { theme: 'dark', viewport: { width: 390, height: 844 } },
      { theme: 'light', viewport: { width: 1440, height: 900 }, touch: true },
      { theme: 'dark', viewport: { width: 390, height: 844 }, touch: true },
    ];

    for (const testCase of cases) {
      await media.emulateTouchInput(Boolean(testCase.touch));
      const mounted = await mountLauncher(testCase.theme, testCase.viewport);
      const textarea = document.querySelector('.floe-prompt-card-input') as HTMLTextAreaElement | null;
      const editorShell = document.querySelector('.floe-prompt-card-composer') as HTMLElement | null;
      const sendButton = document.querySelector('.floe-prompt-card-submit') as HTMLButtonElement | null;
      expect(textarea).not.toBeNull();
      expect(editorShell).not.toBeNull();
      expect(sendButton).not.toBeNull();

      await page.getByRole('textbox').fill('Inspect this file and explain the safest change.');
      await nextFrame();

      const idleRect = sendButton!.getBoundingClientRect();
      const idleEditorRect = editorShell!.getBoundingClientRect();
      const idleStyle = getComputedStyle(sendButton!);
      const textareaStyle = getComputedStyle(textarea!);
      const targetSize = testCase.touch ? 44 : 28;
      expect(idleRect.width).toBeCloseTo(targetSize, 0);
      expect(idleRect.height).toBeCloseTo(targetSize, 0);
      expect(parseFloat(idleStyle.borderRadius)).toBeGreaterThanOrEqual(idleRect.width / 2);
      expect(idleRect.top).toBeGreaterThanOrEqual(textarea!.getBoundingClientRect().bottom - 1);
      expect(getComputedStyle(editorShell!).borderWidth).toBe('0px');
      expect(textareaStyle.fontSize).toBe(testCase.touch ? '16px' : '13px');
      expect(document.querySelector('.floe-prompt-card-question')).toBeNull();
      expect(sendButton!.querySelector('svg')).not.toBeNull();
      expect(sendButton!.querySelector('.animate-spin')).toBeNull();

      await page.getByRole('button', { name: 'Launch turn', exact: true }).click();
      await nextFrame();

      const loadingRect = sendButton!.getBoundingClientRect();
      const loadingEditorRect = editorShell!.getBoundingClientRect();
      expectStableAnchoredRect(idleRect, idleEditorRect, loadingRect, loadingEditorRect);
      await expect.poll(() => mounted.submitCount()).toBe(1);
      expect(sendButton!.disabled).toBe(true);
      expect(sendButton!.getAttribute('aria-busy')).toBe('true');
      expect(sendButton!.getAttribute('aria-label')).toBe('Sending');
      expect(sendButton!.querySelector('.animate-spin')).not.toBeNull();
      expect(textarea!.disabled).toBe(true);
      expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

      mounted.pending.resolve();
      await nextFrame(2);
      expect(sendButton!.getAttribute('aria-busy')).toBe('false');
      expect(sendButton!.querySelector('svg')).not.toBeNull();

      disposers.pop()?.();
      mounted.host.remove();
      await nextFrame();
    }
  });
});

it('keeps the real Flower launch editor frameless while focused', async () => {
  await mountLauncher('dark', { width: 1280, height: 800 });
  const input = document.querySelector<HTMLTextAreaElement>('.floe-prompt-card-input')!;
  expect(input.closest('[data-floe-input-surface]')).toBeTruthy();
  expectSingleInputFocus(input);
  expect(getComputedStyle(input.closest<HTMLElement>('[data-floe-input-surface]')!).borderWidth).toBe('0px');
});
