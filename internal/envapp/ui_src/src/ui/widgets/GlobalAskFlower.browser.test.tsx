import '../../index.css';
import '../flower-feature.css';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerTurnLauncherWindow, type FlowerTurnLauncherSubmitInput } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('light', 'dark'); });
describe('global Ask Flower manual screenshots', () => {
  it.each([{ width: 390, theme: 'light' }, { width: 1440, theme: 'light' }, { width: 390, theme: 'dark' }, { width: 1440, theme: 'dark' }])('keeps input responsive and submits one frozen attachment at $width in $theme', async ({ width, theme }) => {
    document.documentElement.classList.add(theme);
    await page.viewport(width, 900);
    const host = document.createElement('div'); document.body.append(host);
    let resolve!: (file: File) => void;
    const capture = vi.fn(() => new Promise<File>(done => { resolve = done; }));
    const submitted: FlowerTurnLauncherSubmitInput[] = [];
    dispose = render(() => <LayoutProvider><FlowerTurnLauncherWindow open
      intent={{ id: 'global', source_surface: 'flower_composer', context_items: [{ kind: 'text_snapshot', title: 'Terminal', content: 'Frozen output' }] }}
      screenshot={{ label: 'Capture view', failed: 'Capture failed', capture }} onClose={() => undefined}
      onSubmit={async input => { submitted.push(input); }} /></LayoutProvider>, host);
    const editor = page.getByRole('textbox', { name: 'You' });
    await editor.fill('Explain this');
    expect(capture).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Capture view' }).click();
    await editor.fill('Explain this screen');
    expect(capture).toHaveBeenCalledTimes(1);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
    const context = canvas.getContext('2d')!; context.fillStyle = '#335577'; context.fillRect(0, 0, 240, 120);
    const blob = await new Promise<Blob>(done => canvas.toBlob(value => done(value!), 'image/png'));
    resolve(new File([blob], 'manual.png', { type: 'image/png' }));
    await expect.element(page.getByText('manual.png', { exact: true })).toBeVisible();
    await page.screenshot({ path: `__screenshots__/global-ask-${width}-${theme}.png` });
    await page.getByRole('button', { name: 'Launch turn', exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]!.intent.pending_attachments?.[0]?.name).toBe('manual.png');
    expect(submitted[0]!.prompt).toBe('Explain this screen');
    expect(submitted[0]!.intent.context_items).toEqual([{ kind: 'text_snapshot', title: 'Terminal', content: 'Frozen output' }]);
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it('discards delayed capture after close and reopen', async () => {
    const host = document.createElement('div'); document.body.append(host);
    let resolve!: (file: File) => void; let setOpen!: (value: boolean) => void;
    let signal: AbortSignal | undefined;
    dispose = render(() => { const [open, update] = createSignal(true); setOpen = update; return <LayoutProvider><FlowerTurnLauncherWindow open={open()}
      intent={{ id: 'cancel', source_surface: 'flower_composer', context_items: [] }}
      screenshot={{ label: 'Capture view', failed: 'Capture failed', capture: value => { signal = value; return new Promise(done => { resolve = done; }); } }}
      onClose={() => update(false)} onSubmit={async () => undefined} /></LayoutProvider>; }, host);
    await page.getByRole('button', { name: 'Capture view' }).click();
    setOpen(false); await expect.poll(() => signal?.aborted).toBe(true); setOpen(true);
    resolve(new File(['late'], 'late.png', { type: 'image/png' }));
    await new Promise(done => requestAnimationFrame(done));
    await expect.element(page.getByText('late.png', { exact: true })).not.toBeInTheDocument();
  });
});
