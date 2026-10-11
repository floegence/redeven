import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { createGraphLayoutEngine } from '@floegence/floe-webapp-core/graph';
import { TessivenGraph, type TessivenViewportControl } from '../../../../tessiven_ui/src/TessivenGraph';
import { TessivenThumbnail } from '../../../../tessiven_ui/src/TessivenThumbnail';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { CanvasDocument, Version } from '../../../../tessiven_ui/src/types';

let host: HTMLDivElement, dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.removeAttribute('style'); document.documentElement.classList.remove('dark'); });

it('keeps a DOWN architecture with a row-packed peer pool across compact reflows and themes', async () => {
  await page.viewport(1280, 800);
  const document: CanvasDocument = {
    apiVersion: 'redeven.io/tessiven/v1.1.0', kind: 'ServiceCanvas', metadata: { title: 'Cluster architecture' },
    nodes: [0,1,2].map(i => ({ id: `host-${i}`, name: `Consensus member ${i+1}`, runtimeRef: 'conceptual:cluster' })),
    groups: [{ id: 'pool', name: 'Consensus node pool', nodeRefs: ['host-0','host-1','host-2'] }],
    services: [{ id: 'consensus', name: 'Consensus store', kind: 'coordination' }],
    instances: [0,1,2].map(i => ({ id: `instance-${i}`, nodeRef: `host-${i}`, serviceRef: 'consensus', role: 'peer' })),
    evidence: [{ id: 'design', source: 'inference', locator: 'Reference architecture', summary: 'Peer relationships' }],
    relations: [0,1,2].map(i => ({ id: `peer-${i}`, from: `instance-${i}`, to: `instance-${(i+1)%3}`, kind: 'peers', evidenceRefs: ['design'] })),
    presentation: { direction: 'DOWN', layers: [['pool']], initiallyExpanded: ['pool'],
      groupLayouts: { pool: { flow: 'row', maxPerLine: 3 } },
      positions: [2,1,0].map(i => ({ objectRef: `host-${i}`, x: 0, y: -1000*i })),
    },
  };
  host = window.document.createElement('div'); host.className = 'tessiven';
  host.style.cssText = 'width:1200px;height:680px;position:relative'; window.document.body.append(host);
  let control: TessivenViewportControl | undefined, state = '';
  const version = { canvas_id: 'cluster', number: 1, document } as Version;
  dispose = render(() => <TessivenGraph version={version} historical={false} t={tessivenText('en-US')}
    onAsk={() => {}} onInspect={() => {}} onViewportControl={value => { control = value; }}
    onRenderState={value => { state = value; }} />, host);
  const ready = async () => { await expect.poll(() => state, { timeout: 20000 }).toBe('rendered'); };
  const aligned = () => {
    const boxes = [0,1,2].map(i => host.querySelector<HTMLElement>(`[data-node-id="host-${i}"]`)!.getBoundingClientRect());
    expect(boxes[0].width).toBeGreaterThan(0);
    expect(boxes[0].top).toBeCloseTo(boxes[1].top); expect(boxes[1].top).toBeCloseTo(boxes[2].top);
    expect(boxes[0].right).toBeLessThan(boxes[1].left); expect(boxes[1].right).toBeLessThan(boxes[2].left);
    expect(host.querySelectorAll('.floe-graph__edge')).toHaveLength(3);
    const group = host.querySelector('.tessiven-group')!.getBoundingClientRect();
    for (const box of boxes) { expect(box.left).toBeGreaterThan(group.left); expect(box.right).toBeLessThan(group.right); expect(box.bottom).toBeLessThan(group.bottom); }
  };
  await ready(); aligned();
  for (let i = 0; i < 3; i++) {
    control!.collapseAll(); await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(0); await ready();
    control!.expandAll(); await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(3); await ready(); aligned();
  }
  for (const preset of builtInShellThemePresets) {
    window.document.documentElement.removeAttribute('style');
    window.document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [key,value] of Object.entries(preset.semanticTokens ?? {})) if (value) window.document.documentElement.style.setProperty(key,value);
    control!.fit(); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); aligned();
    await page.screenshot({ element: host, path: `../../.vitest-attachments/group-packing-${preset.name}.png` });
  }
});

it('uses identical member geometry in the main graph and thumbnail with authored ordering', async () => {
  const document: CanvasDocument = {
    apiVersion: 'redeven.io/tessiven/v1.1.0', kind: 'ServiceCanvas', metadata: { title: 'Ordered pool' },
    nodes: [0,1,2,3,4].map(i => ({ id: `host-${i}`, name: `Member ${i}`, runtimeRef: 'conceptual:pool' })),
    groups: [{ id: 'pool', name: 'Pool', nodeRefs: ['host-0','host-1','host-2','host-3','host-4'] }],
    presentation: { initiallyExpanded: ['pool'], direction: 'LEFT', order: ['host-4','host-3'],
      groupLayouts: { pool: { flow: 'column', maxPerLine: 2 } } },
  };
  host = window.document.createElement('div'); host.className = 'tessiven';
  host.style.cssText = 'width:1000px;height:680px;position:relative'; window.document.body.append(host);
  const engine = createGraphLayoutEngine(), t = tessivenText('en-US');
  let state = '';
  const unmount = render(() => <>
    <TessivenGraph version={{ canvas_id: 'pool', number: 1, document } as Version} historical={false} t={t}
      onAsk={() => {}} onInspect={() => {}} onRenderState={value => { state = value; }} />
    <div style="display:none"><TessivenThumbnail document={document} t={t} engine={engine} /></div>
  </>, host);
  dispose = () => { unmount(); engine.dispose(); };
  await expect.poll(() => state).toBe('rendered');
  await expect.poll(() => host.querySelectorAll('[data-preview-object]').length).toBe(6);
  const previews = new Map([...host.querySelectorAll<SVGForeignObjectElement>('[data-preview-object]')]
    .map(node => [node.dataset.previewObject!, { x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y')), width: Number(node.getAttribute('width')) }]));
  const first = host.querySelector<HTMLElement>('[data-node-id="host-4"]')!.getBoundingClientRect();
  const origin = previews.get('host-4')!, scale = first.width / origin.width;
  for (let i = 0; i < 5; i++) {
    const box = host.querySelector<HTMLElement>(`[data-node-id="host-${i}"]`)!.getBoundingClientRect();
    const preview = previews.get(`host-${i}`)!;
    expect(box.x - first.x).toBeCloseTo((preview.x - origin.x) * scale, 3);
    expect(box.y - first.y).toBeCloseTo((preview.y - origin.y) * scale, 3);
  }
  expect(previews.get('host-3')!.x).toBe(origin.x);
  expect(previews.get('host-3')!.y).toBeGreaterThan(origin.y);
  expect(previews.get('host-0')!.x).toBeGreaterThan(origin.x);
});
