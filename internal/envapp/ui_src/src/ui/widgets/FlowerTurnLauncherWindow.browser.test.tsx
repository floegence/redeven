import '../../index.css';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { FlowerTurnLauncherWindow } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';

type Theme = 'light' | 'dark';

type Viewport = Readonly<{
  width: number;
  height: number;
}>;

const disposers: Array<() => void> = [];

afterEach(() => {
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

  return {
    host,
    pending,
    submitCount: () => submitCount,
  };
}

function expectStableRect(before: DOMRect, after: DOMRect): void {
  expect(Math.abs(after.left - before.left)).toBeLessThan(1);
  expect(Math.abs(after.top - before.top)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
}

describe('Flower turn launcher send feedback', () => {
  it('keeps the circular ArrowUp action stable while loading across themes and viewports', async () => {
    const cases: ReadonlyArray<Readonly<{ theme: Theme; viewport: Viewport }>> = [
      { theme: 'light', viewport: { width: 1440, height: 900 } },
      { theme: 'dark', viewport: { width: 1440, height: 900 } },
      { theme: 'light', viewport: { width: 390, height: 844 } },
      { theme: 'dark', viewport: { width: 390, height: 844 } },
    ];

    for (const testCase of cases) {
      const mounted = await mountLauncher(testCase.theme, testCase.viewport);
      const textarea = document.querySelector('.flower-turn-launcher-textarea') as HTMLTextAreaElement | null;
      const sendButton = document.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement | null;
      expect(textarea).not.toBeNull();
      expect(sendButton).not.toBeNull();

      await page.getByRole('textbox').fill('Inspect this file and explain the safest change.');
      await nextFrame();

      const idleRect = sendButton!.getBoundingClientRect();
      const idleStyle = getComputedStyle(sendButton!);
      const textareaStyle = getComputedStyle(textarea!);
      expect(idleRect.width).toBeCloseTo(36, 0);
      expect(idleRect.height).toBeCloseTo(36, 0);
      expect(parseFloat(idleStyle.borderRadius)).toBeGreaterThanOrEqual(idleRect.width / 2);
      expect(parseFloat(textareaStyle.paddingRight)).toBeGreaterThan(idleRect.width + 12);
      expect(sendButton!.querySelector('svg')).not.toBeNull();
      expect(sendButton!.querySelector('.animate-spin')).toBeNull();

      await page.getByTestId('flower-turn-launcher-inline-send').click();
      await nextFrame();

      const loadingRect = sendButton!.getBoundingClientRect();
      expectStableRect(idleRect, loadingRect);
      expect(mounted.submitCount()).toBe(1);
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
