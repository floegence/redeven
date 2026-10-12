import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import { repeatedCallsVersion } from './tessiven-relation-summary.fixture';
import type { Selection } from '../../../../tessiven_ui/src/types';

let host: HTMLDivElement, dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.removeAttribute('style'); document.documentElement.classList.remove('dark'); });
async function mount(version = repeatedCallsVersion(), native = false, previewRows = 2) {
  await page.viewport(1200, 850);
  host = document.createElement('div'); host.className = 'tessiven';
  host.style.cssText = 'width:1150px;height:780px;position:relative'; document.body.append(host);
  const ask = vi.fn(), selection = vi.fn<(value: Selection) => void>();
  dispose = render(() => <TessivenGraph version={toRenderVersion(version)} historical={false} t={tessivenText('en-US')}
    onAsk={ask} onInspect={() => {}} onSelectionChange={native ? selection : undefined} />, host);
  await expect.poll(() => host.querySelectorAll('[data-relation-summary]').length).toBe(previewRows);
  await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]')).toBeNull();
  return { ask, selection };
}

describe('bounded pool relation presentation', () => {
  it('shows two counted patterns, one preview, exact evidence and scoped Flower references in every theme', async () => {
    const { ask } = await mount();
    const rows = host.querySelectorAll<HTMLElement>('[data-relation-summary]');
    expect(rows[0].textContent).toContain('Local · 4');
    await userEvent.hover(rows[0]);
    await expect.poll(() => host.querySelectorAll('.tessiven-service-link-preview path[data-relation-id]').length).toBe(1);
    expect(document.querySelector('.tessiven-popup')).toBeNull();
    await userEvent.click(rows[0]);
    expect(document.querySelectorAll('[data-exact-relation-id]')).toHaveLength(4);
    expect(document.querySelector('.tessiven-relation-coverage')?.textContent).toContain('Nodes: 4');
    await page.getByRole('button', { name: 'Ask Flower', exact: true }).click();
    expect(ask).toHaveBeenLastCalledWith({ canvas_id: 'repeated-calls', version_id: 1, object_refs: ['pool', 'agent', 'runtime'] });
    for (const theme of builtInShellThemePresets) {
      document.documentElement.classList.toggle('dark', theme.mode === 'dark');
      for (const [name, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
      const bounds = rows[1].closest('.tessiven-group')!.getBoundingClientRect();
      expect(rows[1].getBoundingClientRect().bottom).toBeLessThan(bounds.bottom);
      await userEvent.click(rows[0]);
      await page.screenshot({ path: `../../.vitest-attachments/pool-relations-${theme.name}.png` });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await userEvent.click(rows[0]);
    await userEvent.click(document.querySelector<HTMLElement>('[data-exact-relation-id="host-0-agent-call"]')!);
    expect(document.querySelector('.tessiven-relation-exact')?.textContent).toContain('Design for Host 1');
    await page.getByRole('button', { name: 'Ask Flower', exact: true }).click();
    expect(ask).toHaveBeenLastCalledWith({ canvas_id: 'repeated-calls', version_id: 1, object_refs: ['host-0-agent-call'] });
  });

  it('browses the last of 1000 relationships with bounded DOM, filtering and preserved back state', async () => {
    await mount(repeatedCallsVersion(1000));
    for (const count of host.querySelectorAll<HTMLElement>('.tessiven-relation-summary-count')) {
      expect(count.textContent).toContain('1000');
      expect(count.scrollWidth).toBeLessThanOrEqual(count.offsetWidth);
    }
    await userEvent.click(host.querySelector<HTMLElement>('[data-relation-summary]')!);
    expect(document.querySelectorAll('[data-exact-relation-id]')).toHaveLength(50);
    for (let i = 0; i < 19; i++) await page.getByRole('button', { name: 'Next page', exact: true }).click();
    expect(document.querySelector('[data-exact-relation-id="host-999-agent-call"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-exact-relation-id]')).toHaveLength(50);
    await page.getByRole('searchbox', { name: 'Search nodes or endpoints', exact: true }).fill('host-999');
    expect(document.querySelectorAll('[data-exact-relation-id]')).toHaveLength(1);
    await userEvent.click(document.querySelector<HTMLElement>('[data-exact-relation-id]')!);
    expect(document.querySelector('.tessiven-relation-exact')?.textContent).toContain('Design for Host 1000');
    await page.getByRole('button', { name: 'Back to relationships', exact: true }).click();
    expect((document.querySelector('.tessiven-relation-filters input') as HTMLInputElement).value).toBe('host-999');
    await page.viewport(800, 420); host.style.cssText = 'width:760px;height:360px;position:relative';
    const popup = document.querySelector<HTMLElement>('.tessiven-popup')!;
    await expect.poll(() => popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(420);
    expect(popup.querySelector('.tessiven-ask-flower')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(popup.getBoundingClientRect().bottom);
    await page.screenshot({ path: '../../.vitest-attachments/pool-relations-short-window.png' });
  });

  it('keeps native summary browsing shared and sends only the selected exact relationship', async () => {
    const { selection } = await mount(repeatedCallsVersion(100), true);
    await userEvent.click(host.querySelector<HTMLElement>('[data-relation-summary]')!);
    expect(selection).toHaveBeenLastCalledWith({ canvas_id: 'repeated-calls', version_id: 1, object_refs: ['pool', 'agent', 'runtime'] });
    await userEvent.click(document.querySelector<HTMLElement>('[data-exact-relation-id="host-0-agent-call"]')!);
    expect(selection).toHaveBeenLastCalledWith({ canvas_id: 'repeated-calls', version_id: 1, object_refs: ['host-0-agent-call'] });
    expect(document.querySelector('.tessiven-popup')).toBeNull();
  });

  it('caps card previews and browses every pattern with a node filter', async () => {
    const version = repeatedCallsVersion();
    version.document.relations!.forEach((relation, index) => { relation.protocol = `protocol-${index}`; });
    await mount(version, false, 4);
    await page.getByRole('button', { name: 'View all 8 types', exact: true }).click();
    expect(document.querySelectorAll('[data-summary-key]')).toHaveLength(8);
    await page.getByRole('combobox', { name: 'Filter by node', exact: true }).selectOptions('host-3');
    expect(document.querySelectorAll('[data-summary-key]')).toHaveLength(2);
    await userEvent.click(document.querySelector<HTMLElement>('[data-summary-key]')!);
    expect(document.querySelectorAll('[data-exact-relation-id]')).toHaveLength(1);
    expect(document.querySelector('[data-exact-relation-id="host-3-agent-call"]')).not.toBeNull();
  });

  it('emphasizes logical endpoints without drawing a fabricated local route', async () => {
    const version = repeatedCallsVersion();
    version.document.relations![0] = { ...version.document.relations![0], from: 'agent', to: 'runtime' };
    // Three summary types after preserving the remaining exact local calls.
    version.document.relations = version.document.relations!.filter(item => item.id === 'host-0-agent-call' || item.from.endsWith('-ui'));
    await mount(version);
    const row = host.querySelector<HTMLElement>('[data-relation-summary]')!;
    expect(row.textContent).toContain('Logical');
    await userEvent.hover(row);
    await expect.poll(() => host.querySelectorAll('.tessiven-service[data-relation-endpoint]').length).toBe(2);
    expect(host.querySelector('.tessiven-service-link-preview')).toBeNull();
  });
});
