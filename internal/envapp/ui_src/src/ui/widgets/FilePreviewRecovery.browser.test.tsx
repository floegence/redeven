import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FilePreviewContent } from './FilePreviewContent';

afterEach(() => document.body.replaceChildren());

it.each([360, 760])('keeps recovery controls and focus stable at width %s', async width => {
  await page.viewport(width, 720);
  const path = '/Volumes/Unavailable/' + 'long-folder-name/'.repeat(12) + 'report.txt';
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>('ENOENT');
  const onRetry = vi.fn(() => setBusy(true));
  const onOpenParent = vi.fn();
  const onCopyPath = vi.fn(async () => true);
  const host = document.createElement('div');
  host.style.cssText = 'height:680px;display:flex;flex-direction:column;width:100%';
  document.body.append(host);
  const dispose = render(() => <FilePreviewContent
    item={{ id: path, name: 'report.txt', path, type: 'file' }}
    descriptor={{ mode: 'xlsx' }}
    showHeader={false} error={error()} errorType="not_found" loading={busy()}
    onRetry={onRetry} onOpenParent={onOpenParent} onCopyPath={onCopyPath}
  />, host);
  try {
    const panel = host.querySelector<HTMLElement>('[data-testid="file-preview-recovery"]')!;
    expect(panel.textContent).toContain('File not found');
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    const retryNode = retry.element();
    retryNode.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="file-preview-recovery"]')).toBe(panel);
    expect(document.activeElement).toBe(retryNode);
    await userEvent.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledOnce();
    setError('still unavailable'); setBusy(false);
    expect(document.activeElement).toBe(retryNode);
    const fullPath = panel.querySelector('code')!;
    expect(fullPath.textContent).toBe(path);
    expect(getComputedStyle(fullPath).userSelect).toBe('text');
    for (const button of panel.querySelectorAll('button')) {
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    }
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    await page.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    expect(onOpenParent).toHaveBeenCalledOnce();
    await page.getByRole('button', { name: 'Copy path', exact: true }).click();
    expect(onCopyPath).toHaveBeenCalledOnce();
    await page.screenshot({ path: '__screenshots__/file-recovery-' + width + '.png' });
    setError(null);
    expect(host.querySelector('[data-testid="file-preview-recovery"]')).toBeNull();
  } finally { dispose(); }
});
