import '../../index.css';
import '../flower-feature.css';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { GlobalFlowerContextMenu } from '../../../../../flower_ui/src/GlobalFlowerContextMenu';
import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { FlowerTurnLauncherSubmitInput } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';
import { FlowerTurnLauncherWindow } from './FlowerTurnLauncherWindow';
import { FilePreviewContext, type FilePreviewContextValue } from './FilePreviewContext';
import { I18nProvider } from '../i18n';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('light', 'dark'); });
const body = Array.from({ length: 80 }, (_, index) => `Context line ${index + 1}: /workspace/source.ts`).join('\n');

async function mount(width: number, theme: string) {
  await page.viewport(width, 900);
  document.documentElement.classList.add(theme);
  const host = document.createElement('div'); document.body.append(host);
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d')!; context.fillStyle = '#335577'; context.fillRect(0, 0, 640, 360);
  context.fillStyle = '#eeaa55'; context.fillRect(32, 32, 180, 90);
  const blob = await new Promise<Blob>(done => canvas.toBlob(value => done(value!), 'image/png'));
  const file = new File([blob], 'Screenshot.png', { type: 'image/png' });
  const submitted: FlowerTurnLauncherSubmitInput[] = [];
  dispose = render(() => {
    const [intent, setIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
    return <I18nProvider><LayoutProvider><FilePreviewContext.Provider value={{ openPreview: async () => {}, closePreview: () => {} } as unknown as FilePreviewContextValue}>
      <GlobalFlowerContextMenu label="Ask Flower" onError={error => { throw error; }}
        editingLabels={{ undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', openLink: 'Open link', copyLink: 'Copy link' }}
        prepare={() => () => setIntent({ id: 'context-preview', source_surface: 'flower_composer', context_items: [{ kind: 'text_snapshot', title: 'File Browser', content: body }] })}>
        <button id="source">File Browser source</button>
        <FlowerTurnLauncherWindow open={!!intent()} intent={intent()} onClose={() => setIntent(null)}
          screenshot={{ label: 'Capture view', failed: 'Capture failed', capture: async () => file }}
          onSubmit={async input => { submitted.push(input); }} />
      </GlobalFlowerContextMenu>
    </FilePreviewContext.Provider></LayoutProvider></I18nProvider>;
  }, host);
  await userEvent.click(document.querySelector('#source')!, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
  await page.getByRole('textbox', { name: 'You', exact: true }).fill('Inspect the selected context');
  return { file, submitted };
}

it('keeps the editor focused through screenshot capture so Escape dismisses the prompt', async () => {
  await mount(1100, 'dark');
  await page.getByRole('button', { name: 'Capture view', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-floe-prompt-card]')?.textContent).toContain('Screenshot.png');
  await expect.poll(() => document.activeElement).toBe(document.querySelector('textarea'));
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[data-floe-prompt-card]')).toBeNull();
});

it.each([{ width: 1440, theme: 'light' }, { width: 390, theme: 'dark' }, { width: 430, theme: 'light' }, { width: 768, theme: 'dark' }])('shows the complete frozen context without file chrome at $width', async ({ width, theme }) => {
  await mount(width, theme);
  await page.getByRole('button', { name: 'File Browser', exact: true }).click();
  await expect.poll(() => document.querySelector('.flower-context-preview-window')?.textContent).toContain('Context line 80');
  const surface = document.querySelector('.flower-context-preview-window')!;
  const content = surface.querySelector('[data-flower-context-preview-text]') as HTMLElement;
  expect(content, 'Context is a readable snapshot, not a file path or editor').toBeTruthy();
  expect(content.textContent).toBe(body);
  expect(content.getBoundingClientRect().height).toBeGreaterThan(240);
  expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
  content.scrollTop = content.scrollHeight;
  expect(content.scrollTop).toBeGreaterThan(0);
  expect(surface.querySelector('.redeven-file-preview-toolbar')).toBeNull();
  expect(surface.querySelector('[data-flower-context-preview-close]')).toBeNull();
  await page.screenshot({ path: `__screenshots__/context-preview-${width}-${theme}.png` });
});

it.each([{ width: 1440, theme: 'light' }, { width: 390, theme: 'dark' }, { width: 430, theme: 'light' }, { width: 768, theme: 'dark' }])('decodes the actual screenshot bytes and keeps the draft at $width', async ({ width, theme }) => {
  const { file, submitted } = await mount(width, theme);
  await page.getByRole('button', { name: 'Capture view', exact: true }).click();
  await page.getByRole('button', { name: 'Screenshot.png', exact: true }).click();
  await expect.poll(() => document.querySelector<HTMLImageElement>('.flower-context-preview-window img')?.naturalWidth).toBe(640);
  const surface = document.querySelector('.flower-context-preview-window')!;
  const image = surface.querySelector('img')!;
  const previewURL = image.src;
  expect(image.getBoundingClientRect().height).toBeGreaterThan(100);
  expect(new Uint8Array(await (await fetch(image.src)).arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  expect(surface.querySelector('.redeven-file-preview-toolbar')).toBeNull();
  expect(surface.textContent).not.toContain('Queued');
  expect(surface.textContent).not.toContain('snapshot');
  expect(surface.querySelector('[data-flower-context-preview-close]')).toBeNull();
  await page.screenshot({ path: `__screenshots__/screenshot-preview-${width}-${theme}.png` });
  const close = surface.querySelector<HTMLButtonElement>('[data-floe-floating-window-control=close],button[aria-label=Close]')!;
  await userEvent.click(close);
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Inspect the selected context');
  await expect(fetch(previewURL)).rejects.toThrow();
  expect(document.activeElement?.textContent).toBe('Screenshot.png');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].intent.pending_attachments?.[0]).toBe(file);
  expect(submitted[0].intent.context_items[0]).toEqual({ kind: 'text_snapshot', title: 'File Browser', content: body });
});
