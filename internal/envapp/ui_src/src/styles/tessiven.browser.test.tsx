import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { createGraphLayoutEngine } from '@floegence/floe-webapp-core/graph';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TessivenGraph, type GraphBrowseState, type TessivenViewportControl } from '../../../../tessiven_ui/src/TessivenGraph';
import { TessivenThumbnail } from '../../../../tessiven_ui/src/TessivenThumbnail';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Version } from '../../../../tessiven_ui/src/types';
import hadoopDocument from './fixtures/tessiven-hadoop.json';
import { projectCanvas, projectLayoutLayers } from '../../../../tessiven_ui/src/projection';
import { sharedHostsVersion } from './tessiven-shared-hosts.fixture';
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
function mount(count = 2, version = fixture(count), browseState?: GraphBrowseState) {
  host = document.createElement('div');
  host.style.cssText = 'width:1250px;height:740px;position:relative';
  host.className = 'tessiven';
  document.body.append(host);
  const ask = vi.fn(),
    inspect = vi.fn(),
    browse = vi.fn();
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
        browseState={browseState}
        onBrowseState={browse}
      />
    ),
    host,
  );
  return { ask, inspect, browse, setVisible };
}

function routeMetrics() {
  const paths = [...host.querySelectorAll<SVGPathElement>('.floe-graph__edge')].map(edge => {
    const numbers = edge.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    return Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[i * 2], y: numbers[i * 2 + 1] }));
  });
  const segments = paths.flatMap((path, edge) => path.slice(1).map((b, i) => ({ a: path[i], b, edge })));
  const length = segments.reduce((sum, s) => sum + Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y), 0);
  let sharedLength = 0, crossings = 0;
  for (const [index, s] of segments.entries()) for (const t of segments.slice(index + 1)) {
    if (s.edge === t.edge) continue;
    const horizontal = s.a.y === s.b.y, otherHorizontal = t.a.y === t.b.y;
    if (horizontal === otherHorizontal) {
      const fixed = horizontal ? 'y' : 'x', axis = horizontal ? 'x' : 'y';
      if (Math.abs(s.a[fixed] - t.a[fixed]) < 0.01)
        sharedLength += Math.max(0, Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis]))
          - Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis])));
    } else {
      const h = horizontal ? s : t, v = horizontal ? t : s;
      if (v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x)
        && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) crossings++;
    }
  }
  return { paths, segments, length, sharedLength, crossings };
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
  it('preserves native render notifications and details while controlling touch zoom', async () => {
    host = document.createElement('div');
    host.className = 'tessiven';
    host.style.cssText = 'width:1250px;height:740px;position:relative';
    document.body.append(host);
    const states = vi.fn(), details = vi.fn();
    let control: TessivenViewportControl | undefined;
    dispose = render(() => <TessivenGraph version={fixture()} historical={false}
      t={tessivenText('en-US')} onAsk={() => {}} onInspect={() => {}}
      onDetails={details} onRenderState={states} onViewportControl={value => { control = value; }} />, host);
    await expect.poll(() => states.mock.calls.at(-1)?.[0]).toBe('rendered');
    expect(states.mock.calls[0][0]).toBe('loading');
    await userEvent.click(host.querySelector('.tessiven-node')!);
    expect(details).toHaveBeenCalledOnce();
    expect(details.mock.calls[0][0].object_refs).toEqual(['node-0']);
    expect(host.querySelector('.tessiven-object-popup')).toBeNull();
    const transform = () => host.querySelector<HTMLElement>('.floe-infinite-canvas__viewport')!.style.transform;
    const before = transform();
    control!.setTouchZooming(true);
    control!.zoom(1.1, 400, 300, 10, 10);
    expect(transform()).not.toBe(before);
    control!.setTouchZooming(false);
    await userEvent.click(page.getByRole('button', { name: 'Collapse all', exact: true }));
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(0);
    expect(states.mock.calls.at(-1)?.[0]).toBe('rendered');
  });
  it('changes all group visibility and service scope from the canvas without editing the document', async () => {
    const version = sharedHostsVersion();
    const original = JSON.stringify(version.document);
    mount(3, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(0);
    expect(host.querySelectorAll('.tessiven-group[data-expanded="false"]')).toHaveLength(2);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const scope = host.querySelector<HTMLSelectElement>('[aria-label="Node services"]')!;
    scope.value = 'group';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => host.querySelector('[data-group-id="hdfs"][data-node-id="node-1"]')?.querySelectorAll('.tessiven-service').length).toBe(1);
    expect(host.querySelector('[data-group-id="zk"][data-node-id="node-1"] [data-service-id="zookeeper"]')).not.toBeNull();
    scope.value = 'all';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => host.querySelector('[data-group-id="hdfs"][data-node-id="node-1"]')?.querySelectorAll('.tessiven-service').length).toBe(2);
    expect(JSON.stringify(version.document)).toBe(original);
    await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]')).toBeNull();
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it('navigates the main graph with a keyboard-accessible draggable overview', async () => {
    mount();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(2);
    const overview = page.getByRole('region', { name: 'Canvas overview', exact: true });
    const indicator = host.querySelector<SVGRectElement>('.floe-graph__minimap-viewport')!;
    const before = Number(indicator.getAttribute('x'));
    await overview.element().focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(Number(indicator.getAttribute('x'))).toBeGreaterThan(before);
    const moved = Number(indicator.getAttribute('x'));
    await userEvent.keyboard('{Home}');
    expect(Number(indicator.getAttribute('x'))).not.toBe(moved);
    expect(host.querySelector('.floe-graph__minimap')?.querySelectorAll('path')).toHaveLength(3);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it('restores the selected service scope when returning to a canvas', async () => {
    const version = sharedHostsVersion();
    const { browse } = mount(3, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const scope = host.querySelector<HTMLSelectElement>('[aria-label="Node services"]')!;
    scope.value = 'group';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => host.querySelector('[data-group-id="hdfs"][data-node-id="node-1"]')?.querySelectorAll('.tessiven-service').length).toBe(1);
    dispose?.(); dispose = undefined;
    const state = browse.mock.calls.at(-1)![0] as GraphBrowseState;
    expect(state.serviceScope).toBe('group');
    host.remove();
    mount(3, version, state);
    await expect.poll(() => host.querySelector('[data-group-id="hdfs"][data-node-id="node-1"]')?.querySelectorAll('.tessiven-service').length).toBe(1);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Node services"]')?.value).toBe('group');
  });
  it('uses identical preview and main geometry including expanded group relation rows', async () => {
    const version = fixture();
    version.document.presentation!.layers = [['application'], ['cdn', 'bucket']];
    version.document.relations!.push({ id: 'group-relation', from: 'application', to: 'application', kind: 'calls', evidenceRefs: [] });
    mount(2, version);
    const preview = document.createElement('div');
    host.append(preview);
    const engine = createGraphLayoutEngine();
    const unmount = render(() => <TessivenThumbnail document={version.document} t={tessivenText('en-US')} engine={engine} />, preview);
    try {
      await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(2);
      await expect.poll(() => preview.querySelectorAll('[data-preview-object]').length).toBe(5);
      await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
      // Pointer isolation hides unrelated main routes; compare the full geometry.
      await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover();
      await expect.poll(() => host.querySelectorAll('.floe-graph__edge').length).toBe(preview.querySelectorAll('[data-preview-edge]').length);
      for (const node of preview.querySelectorAll<SVGForeignObjectElement>('[data-preview-object]')) {
        const main = host.querySelector<HTMLElement>(`[data-graph-object="${node.dataset.previewObject}"]`)!;
        expect([node.x.baseVal.value, node.y.baseVal.value, node.width.baseVal.value, node.height.baseVal.value])
          .toEqual([main.style.left, main.style.top, main.style.width, main.style.height].map(value => Number.parseFloat(value)));
      }
      expect([...preview.querySelectorAll('[data-preview-edge] path')].map(path => path.getAttribute('d')).sort())
        .toEqual([...host.querySelectorAll('.floe-graph__edge')].map(path => path.getAttribute('d')).sort());
    } finally {
      unmount(); engine.dispose(); preview.remove();
    }
  });
  it('renders the saved Hadoop topology despite crowded coordinate hints', async () => {
    const version: Version = {
      ...fixture(), number: 2,
      document: hadoopDocument as Version['document'],
    };
    mount(10, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(version.document, new Set(version.document.presentation?.initiallyExpanded), {});
    expect(new Set([
      ...[...projected.relations.values()].flat().map(relation => relation.id),
      ...[...projected.internalRelations.values()].flat().map(item => item.relation.id),
    ]).size).toBe(40);
    expect(projected.graph.edges.every(edge => edge.source !== edge.target)).toBe(true);
    expect(projected.internalRelations.get('n-eco')?.map(item => item.relation.id)).toContain('rel-hiveserver2-metastore');
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover();
    expect(projectLayoutLayers(version.document, projected)).toEqual(version.document.presentation?.layers);
    expect([...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort())
      .toEqual(projected.graph.edges.map(edge => edge.id).sort());
    const metrics = routeMetrics();
    // The unchanged user fixture previously had 26,020px of routes, 11,043.5px
    // of shared segments, and 32 crossings at these saved positions.
    expect(metrics.sharedLength, JSON.stringify({ length: metrics.length, sharedLength: metrics.sharedLength, crossings: metrics.crossings })).toBeLessThan(1_100);
    // Declared layers deliberately add space between the five architecture
    // stages; compare routing quality with the saved crowded-layout baseline.
    expect(metrics.length, JSON.stringify(metrics)).toBeLessThan(26_020);
    expect(metrics.crossings, JSON.stringify({ length: metrics.length, sharedLength: metrics.sharedLength, crossings: metrics.crossings })).toBeLessThanOrEqual(16);
    for (const segment of metrics.segments)
      expect(segment.a.x === segment.b.x || segment.a.y === segment.b.y).toBe(true);
    const cards = [...host.querySelectorAll<HTMLElement>('.floe-graph__node')];
    for (const card of cards) {
      const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
      const right = left + Number.parseFloat(card.style.width), bottom = top + Number.parseFloat(card.style.height);
      for (const { a, b } of metrics.segments)
        expect(Math.max(a.x, b.x) <= left + 0.001 || Math.min(a.x, b.x) >= right - 0.001
          || Math.max(a.y, b.y) <= top + 0.001 || Math.min(a.y, b.y) >= bottom - 0.001,
          JSON.stringify({ card: card.dataset.graphObject, left, top, right, bottom, a, b })).toBe(true);
    }
    for (const [index, card] of cards.entries()) {
      const a = card.getBoundingClientRect();
      for (const other of cards.slice(index + 1)) {
        const b = other.getBoundingClientRect();
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
    for (const node of host.querySelectorAll<HTMLElement>('.tessiven-node')) {
      const bounds = node.getBoundingClientRect();
      for (const service of node.querySelectorAll<HTMLElement>('.tessiven-service')) {
        const row = service.getBoundingClientRect();
        expect(row.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
        expect(row.right).toBeLessThanOrEqual(bounds.right + 0.5);
        expect(row.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
      }
      for (const relation of node.querySelectorAll<HTMLElement>('.tessiven-local-relation'))
        expect(relation.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
    }
    const rootPositions = ['g-access', 'g-master', 'g-coord', 'g-worker', 'g-eco']
      .map(id => host.querySelector<HTMLElement>(`[data-graph-object="${id}"]`))
      .map(node => Number.parseFloat(node?.style.left ?? 'NaN'));
    expect(rootPositions.every(Number.isFinite)).toBe(true);
    expect(rootPositions[0]).toBeLessThan(rootPositions[1]);
    expect(rootPositions[1]).toBeLessThan(rootPositions[2]);
    expect(rootPositions[2]).toBeLessThan(rootPositions[3]);
    expect(rootPositions[3]).toBeLessThan(rootPositions[4]);
    for (const theme of builtInShellThemePresets.filter(theme => ['porcelain-light', 'porcelain-dark'].includes(theme.name))) {
      document.documentElement.classList.toggle('dark', theme.mode === 'dark');
      for (const [name, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
      await page.screenshot({ path: `../../.vitest-attachments/redeven-hadoop-${theme.name}.png` });
    }
  });
  it('keeps nearby border connections readable at inspection scale and narrow widths', async () => {
    await page.viewport(1600, 1000);
    const version: Version = { ...fixture(), document: hadoopDocument as Version['document'] };
    mount(10, version, { expanded: version.document.presentation!.initiallyExpanded!, selectedNodes: {},
      viewport: { x: 520, y: 420, scale: 0.65 } });
    host.style.width = '1540px';
    host.style.height = '920px';
    await expect.poll(() => host.querySelectorAll('.floe-graph__edge').length).toBeGreaterThan(0);
    // Inspection zoom keeps only routes intersecting the visible viewport.
    expect(host.querySelectorAll('.floe-graph__edge').length).toBeLessThan(25);
    for (const theme of builtInShellThemePresets.filter(theme => ['porcelain-light', 'porcelain-dark'].includes(theme.name))) {
      document.documentElement.classList.toggle('dark', theme.mode === 'dark');
      for (const [name, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
      await page.screenshot({ path: `../../.vitest-attachments/redeven-hadoop-routing-detail-${theme.name}.png` });
    }
    await page.getByRole('group', { name: 'HDFS 元数据与 YARN 调度主控层', exact: true }).hover({ position: { x: 20, y: 20 } });
    expect(host.querySelectorAll('.floe-graph__edge').length).toBeLessThan(25);
    expect(host.querySelectorAll('.floe-graph__edge').length).toBeGreaterThan(0);
    await page.screenshot({ path: '../../.vitest-attachments/redeven-hadoop-routing-hover.png' });
    await page.viewport(430, 740);
    host.style.width = '390px';
    host.style.height = '670px';
    await page.getByRole('button', { name: 'Fit canvas' }).click();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await page.screenshot({ path: '../../.vitest-attachments/redeven-hadoop-routing-narrow.png' });
  });
  it('renders collapsed Hadoop groups without applying hidden members coordinate hints', async () => {
    const document = structuredClone(hadoopDocument) as Version['document'];
    document.presentation!.initiallyExpanded = [];
    mount(10, { ...fixture(), document });
    await expect.poll(() => host.querySelectorAll('.tessiven-group').length).toBe(5);
    expect(host.querySelectorAll('.tessiven-node')).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(document, new Set(), {});
    for (const group of host.querySelectorAll<HTMLElement>('.tessiven-group')) {
      const bounds = group.getBoundingClientRect();
      for (const row of group.querySelectorAll<HTMLElement>('.tessiven-service, .tessiven-more, .tessiven-local-relation'))
        expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom - 5);
    }
    expect(projectLayoutLayers(document, projected)).toEqual(document.presentation?.layers);
    expect([...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort())
      .toEqual(projected.graph.edges.map(edge => edge.id).sort());
  });
  it('preserves declared root layers and compacts layout across collapse and expand', async () => {
    const document = structuredClone(hadoopDocument) as Version['document'];
    mount(10, { ...fixture(), document });
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    const group = (id: string) => host.querySelector<HTMLElement>(`[data-graph-object="${id}"]`)!;
    const rank = () => ['g-access', 'g-master', 'g-coord', 'g-worker', 'g-eco']
      .map(id => Number.parseFloat(group(id).style.left));
    const fullRank = rank();
    expect(fullRank.every(Number.isFinite)).toBe(true);
    expect(fullRank.every((value, index) => index === 0 || fullRank[index - 1]! < value)).toBe(true);
    const fullBounds = Math.max(...fullRank) - Math.min(...fullRank);
    const expandedWidth = Number.parseFloat(group('g-coord').style.width);
    const anchor = [group('g-coord').style.left, group('g-coord').style.top];
    await page.getByRole('button', { name: 'Collapse group' }).nth(2).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(7);
    await expect.poll(() => Number.parseFloat(group('g-coord').style.width)).toBeLessThan(expandedWidth);
    expect([group('g-coord').style.left, group('g-coord').style.top]).toEqual(anchor);
    const collapsedRank = rank();
    expect(collapsedRank.every((value, index) => index === 0 || collapsedRank[index - 1]! < value)).toBe(true);
    expect(Math.max(...collapsedRank) - Math.min(...collapsedRank)).toBeLessThan(fullBounds);
    await page.getByRole('button', { name: 'Expand group' }).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    await expect.poll(() => Number.parseFloat(group('g-coord').style.width)).toBe(expandedWidth);
    expect([group('g-coord').style.left, group('g-coord').style.top]).toEqual(anchor);
    const expandedRank = rank();
    expect(expandedRank.every((value, index) => index === 0 || expandedRank[index - 1]! < value)).toBe(true);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('retains a visible selection while other groups compact and anchors its group when hidden', async () => {
    const version = fixture(3);
    version.document.groups = [
      { id: 'first', name: 'First group', nodeRefs: ['node-0', 'node-1'] },
      { id: 'second', name: 'Second group', nodeRefs: ['node-2'] },
    ];
    version.document.presentation = { layers: [['first'], ['second']], initiallyExpanded: ['first', 'second'] };
    mount(3, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(3);
    const object = (id: string) => host.querySelector<HTMLElement>(`[data-graph-object="${id}"]`)!;
    const position = (id: string) => [object(id).style.left, object(id).style.top];
    await userEvent.click(object('node-2').querySelector('.tessiven-node > header strong')!);
    await userEvent.keyboard('{Escape}');
    const selectedPosition = position('node-2');
    const firstWidth = object('first').style.width;
    await userEvent.click(object('first').querySelector('.tessiven-group-toggle')!);
    await expect.poll(() => object('first').style.width).not.toBe(firstWidth);
    expect(position('node-2')).toEqual(selectedPosition);
    const groupPosition = position('second');
    const secondHeight = object('second').style.height;
    await userEvent.click(object('second').querySelector('.tessiven-group-toggle')!);
    await expect.poll(() => object('second').style.height).not.toBe(secondHeight);
    expect(position('second')).toEqual(groupPosition);
    expect(host.querySelector('[data-graph-object="node-2"]')).toBeNull();
  });
  it('renders the complete Hadoop topology with automatic layout', async () => {
    const document = structuredClone(hadoopDocument) as Version['document'];
    delete document.presentation!.positions;
    delete document.presentation!.layers;
    mount(10, { ...fixture(), document });
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const projected = projectCanvas(document, new Set(document.presentation?.initiallyExpanded), {});
    expect(new Set([
      ...[...projected.relations.values()].flat().map(relation => relation.id),
      ...[...projected.internalRelations.values()].flat().map(item => item.relation.id),
    ]).size).toBe(40);
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
    expect(document.querySelector('.tessiven-ask-flower-mark svg')).not.toBeNull();
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
  it('uses saved positions as compact ordering hints when hidden members expand', async () => {
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
    await page.getByRole('button', { name: 'Expand group' }).click();
    await expect
      .poll(() => host.querySelectorAll('.tessiven-node').length)
      .toBe(2);
    const node = host
      .querySelector('.tessiven-node')!
      .closest<HTMLElement>('[data-graph-object]');
    expect(node).not.toBeNull();
    expect(node!.style.left).not.toBe('700px');
    expect(node!.style.top).not.toBe('800px');
    expect(version.document.presentation.positions).toEqual([
      { objectRef: 'node-0', x: 700, y: 800 },
    ]);
  });
  it('keeps compact browsing when a large group changes its visible host', async () => {
    const version = fixture(16);
    version.document.presentation = {
      initiallyExpanded: [],
      positions: [{ objectRef: 'node-15', x: 5000, y: 3000 }],
    };
    mount(16, version);
    await expect.poll(() => host.querySelectorAll('.tessiven-group').length).toBe(1);
    await page.getByRole('button', { name: 'Expand group' }).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(1);
    const select = host.querySelector('select')!;
    select.value = 'node-15';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => host.querySelector('[data-graph-object="node-15"]')).not.toBeNull();
    const node = host.querySelector<HTMLElement>('[data-graph-object="node-15"]')!;
    expect(Number.parseFloat(node.style.left)).toBeLessThan(1000);
    expect(Number.parseFloat(node.style.top)).toBeLessThan(1000);
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
