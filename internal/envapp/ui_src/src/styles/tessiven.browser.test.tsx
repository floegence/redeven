import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Version } from '../../../../tessiven_ui/src/types';
import hadoopDocument from './fixtures/tessiven-hadoop.json';
import { projectCanvas } from '../../../../tessiven_ui/src/projection';
function fixture(count = 2): Version {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    name: `core-${String(i + 1).padStart(3, '0')}`,
    runtimeRef: `ssh:node-${i}`,
  }));
  return {
    canvas_id: 'commerce',
    number: 1,
    document_yaml: '',
    digest: 'fixture',
    created_at: Date.now(),
    source: 'manual',
    summary: 'Fixture',
    document: {
      apiVersion: 'redeven.io/tessiven/v1',
      kind: 'ServiceCanvas',
      metadata: { title: 'Commerce / Production' },
      nodes,
      groups: [
        {
          id: 'application',
          name: 'Application nodes',
          nodeRefs: nodes.map((node) => node.id),
        },
      ],
      services: [
        { id: 'orders', name: 'Orders API', kind: 'api' },
        { id: 'worker', name: 'Asset processor', kind: 'worker' },
      ],
      instances: nodes.flatMap((node) => [
        {
          id: `orders-${node.id}`,
          nodeRef: node.id,
          serviceRef: 'orders',
          role: 'peer',
        },
        {
          id: `worker-${node.id}`,
          nodeRef: node.id,
          serviceRef: 'worker',
          role: 'standalone',
        },
      ]),
      resources: [
        {
          id: 'cdn',
          name: 'Public delivery',
          kind: 'cdn',
          endpoint: 'https://assets.example.test',
        },
        {
          id: 'bucket',
          name: 'Product assets',
          kind: 'object_store',
          endpoint: 's3://commerce-assets',
        },
      ],
      relations: [
        {
          id: 'orders-bucket',
          from: 'orders',
          to: 'bucket',
          kind: 'reads',
          evidenceRefs: ['configuration'],
        },
        {
          id: 'worker-bucket',
          from: 'worker',
          to: 'bucket',
          kind: 'writes',
          evidenceRefs: ['configuration'],
        },
        {
          id: 'cdn-bucket',
          from: 'cdn',
          to: 'bucket',
          kind: 'reads',
          evidenceRefs: ['configuration'],
        },
      ],
      evidence: [
        {
          id: 'configuration',
          source: 'configuration',
          locator: 'repo://commerce/storage.yaml',
          summary: 'Configured object storage dependency',
        },
      ],
      presentation: { initiallyExpanded: ['application'] },
    },
  };
}
function luminance(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const rgb = [...context.getImageData(0, 0, 1, 1).data]
    .slice(0, 3)
    .map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
function mount(count = 2, version = fixture(count)) {
  host = document.createElement('div');
  host.style.cssText = 'width:1250px;height:740px;position:relative';
  host.className = 'tessiven';
  document.body.append(host);
  const ask = vi.fn(),
    inspect = vi.fn();
  const [visible, setVisible] = createSignal(true);
  dispose = render(
    () => (
      <TessivenGraph
        version={version}
        t={tessivenText('en-US')}
        historical={false}
        onAsk={ask}
        onInspect={inspect}
        visible={visible()}
      />
    ),
    host,
  );
  return { ask, inspect, setVisible };
}
beforeEach(async () => {
  await page.viewport(1300, 800);
});
afterEach(() => {
  dispose?.();
  host?.remove();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});
describe('Tessiven real graph interactions', () => {
  it('renders the saved Hadoop topology despite crowded coordinate hints', async () => {
    // This Chinese fixture is the unchanged user-generated document that
    // reproduced the blank canvas, including all 40 relationships and hints.
    const version: Version = {
      ...fixture(), number: 2,
      document: hadoopDocument as Version['document'],
    };
    mount(10, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(version.document, new Set(version.document.presentation?.initiallyExpanded), {});
    expect([...projected.relations.values()].flat()).toHaveLength(40);
    expect([...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort())
      .toEqual(projected.graph.edges.map(edge => edge.id).sort());
    const cards = [...host.querySelectorAll<HTMLElement>('.floe-graph__node')];
    for (const [index, card] of cards.entries()) {
      const a = card.getBoundingClientRect();
      for (const other of cards.slice(index + 1)) {
        const b = other.getBoundingClientRect();
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
    for (const theme of builtInShellThemePresets.filter(theme => ['porcelain-light', 'porcelain-dark'].includes(theme.name))) {
      document.documentElement.classList.toggle('dark', theme.mode === 'dark');
      for (const [name, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
      await page.screenshot({ path: `../../.vitest-attachments/redeven-hadoop-${theme.name}.png` });
    }
  });
  it('renders collapsed Hadoop groups without applying hidden members coordinate hints', async () => {
    const document = structuredClone(hadoopDocument) as Version['document'];
    document.presentation!.initiallyExpanded = [];
    mount(10, { ...fixture(), document });
    await expect.poll(() => host.querySelectorAll('.tessiven-group').length).toBe(5);
    expect(host.querySelectorAll('.tessiven-node')).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(document, new Set(), {});
    expect([...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort())
      .toEqual(projected.graph.edges.map(edge => edge.id).sort());
  });
  it('renders the complete Hadoop topology with automatic layout', async () => {
    const document = structuredClone(hadoopDocument) as Version['document'];
    delete document.presentation!.positions;
    mount(10, { ...fixture(), document });
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(document, new Set(document.presentation?.initiallyExpanded), {});
    expect([...projected.relations.values()].flat()).toHaveLength(40);
    expect([...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort())
      .toEqual(projected.graph.edges.map(edge => edge.id).sort());
  });
  it('lays out runtime nodes and opens details on click with immutable Ask context', async () => {
    const { ask, setVisible } = mount();
    await expect
      .poll(() => host.querySelectorAll('.tessiven-node').length)
      .toBe(2);
    expect(host.querySelectorAll('.floe-graph__edge').length).toBe(2);
    expect(host.querySelectorAll('.tessiven-popup').length).toBe(0);
    await page
      .getByRole('button', { name: 'Orders API API ×1' })
      .first()
      .click();
    await expect
      .element(page.getByRole('dialog', { name: 'Details' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Ask Flower' }).click();
    expect(ask).toHaveBeenCalledWith({
      canvas_id: 'commerce',
      version_id: 1,
      object_refs: ['orders-node-0'],
    });
    const row = host.querySelector<HTMLElement>('.tessiven-service')!;
    row.focus();
    row.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect.element(page.getByRole('menu')).toBeVisible();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    setVisible(false);
    await expect
      .poll(() => document.querySelector('.tessiven-popup'))
      .toBeNull();
  });
  it('switches the selected host at sixteen nodes', async () => {
    mount(16);
    await expect
      .poll(() => host.querySelectorAll('.tessiven-node').length)
      .toBe(1);
    const select = host.querySelector('select')!;
    expect(select.options).toHaveLength(16);
    select.value = 'node-15';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await expect
      .poll(() => host.querySelector('.tessiven-node strong')?.textContent)
      .toBe('core-016');
  });
  it('applies saved positions when hidden members are expanded', async () => {
    const version = fixture(2);
    version.document.presentation = {
      initiallyExpanded: [],
      positions: [{ objectRef: 'node-0', x: 700, y: 800 }],
    };
    mount(2, version);
    await expect
      .poll(() => host.querySelectorAll('.tessiven-group').length)
      .toBe(1);
    expect(host.querySelectorAll('.tessiven-node')).toHaveLength(0);
    await page.getByRole('button', { name: 'Show runtime nodes' }).click();
    await expect
      .poll(() => host.querySelectorAll('.tessiven-node').length)
      .toBe(2);
    const node = host
      .querySelector('.tessiven-node')!
      .closest<HTMLElement>('[data-graph-object]');
    expect(node).not.toBeNull();
    expect(node!.style.left).toBe('700px');
    expect(node!.style.top).toBe('800px');
  });
  it('preserves solid hierarchy across every published theme', async () => {
    mount();
    await expect
      .poll(() => host.querySelectorAll('.tessiven-node').length)
      .toBe(2);
    for (const preset of builtInShellThemePresets) {
      document.documentElement.classList.toggle('dark', preset.mode === 'dark');
      for (const [name, value] of Object.entries(preset.semanticTokens ?? {}))
        if (value) document.documentElement.style.setProperty(name, value);
      const group = getComputedStyle(host.querySelector('.tessiven-group')!);
      const node = getComputedStyle(host.querySelector('.tessiven-node')!);
      expect(group.borderStyle, preset.name).toBe('dashed');
      expect(node.backgroundColor, preset.name).not.toBe(group.backgroundColor);
      expect(
        getComputedStyle(host.querySelector('.tessiven-resource-name')!)
          .backgroundColor,
        preset.name,
      ).not.toBe(group.backgroundColor);
      expect(group.backgroundImage, preset.name).toBe('none');
      expect(node.backgroundImage, preset.name).toBe('none');
      for (const selector of [
        '.tessiven-node>header',
        '.tessiven-group',
        '.tessiven-service',
        '.tessiven-resource>header',
        '.tessiven-resource-name',
      ]) {
        const style = getComputedStyle(host.querySelector(selector)!);
        expect(
          contrast(style.color, style.backgroundColor),
          `${preset.name} ${selector} text contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      expect(
        getComputedStyle(host.querySelector('.tessiven-node>header')!)
          .backgroundColor,
        preset.name,
      ).toMatch(/rgb\((73|81), (73|81), (73|81)\)/);
    }
    for (const name of ['porcelain-light', 'porcelain-dark']) {
      const preset = builtInShellThemePresets.find((p) => p.name === name)!;
      document.documentElement.classList.toggle('dark', preset.mode === 'dark');
      for (const [key, value] of Object.entries(preset.semanticTokens ?? {}))
        if (value) document.documentElement.style.setProperty(key, value);
      await page.screenshot({
        path: `../../.vitest-attachments/tessiven-${name}.png`,
      });
    }
  });
});
