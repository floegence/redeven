import { describe, expect, it } from 'vitest';
import {
  projectCanvas,
  compareDocuments,
} from '../../../internal/tessiven_ui/src/projection';
import { tessivenText } from '../../../internal/tessiven_ui/src/i18n';
import type { CanvasDocument } from '../../../internal/tessiven_ui/src/types';
import { readFileSync, readdirSync } from 'node:fs';

function fixture(count: number): CanvasDocument {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    name: `Runtime ${index}`,
    runtimeRef: `ssh:target-${index}`,
  }));
  return {
    apiVersion: 'redeven.io/tessiven/v1',
    kind: 'ServiceCanvas',
    metadata: { title: 'Commerce' },
    nodes,
    groups: [
      {
        id: 'application',
        name: 'Application nodes',
        nodeRefs: nodes.map((n) => n.id),
      },
    ],
    services: [{ id: 'api', name: 'Orders API', kind: 'api' }],
    instances: nodes.map((n) => ({
      id: `orders-${n.id}`,
      nodeRef: n.id,
      serviceRef: 'api',
      role: 'peer',
    })),
    resources: [{ id: 'assets', name: 'Product assets', kind: 'object_store' }],
    relations: [
      {
        id: 'reads-assets',
        from: 'api',
        to: 'assets',
        kind: 'reads',
        evidenceRefs: ['config'],
      },
      {
        id: 'writes-assets',
        from: 'api',
        to: 'assets',
        kind: 'writes',
        evidenceRefs: ['config'],
      },
    ],
    evidence: [
      {
        id: 'config',
        source: 'configuration',
        locator: 'repo://orders/storage.yaml',
        summary: 'Configured bucket',
      },
    ],
  };
}
describe('Tessiven projection contracts', () => {
  it('shows all fifteen nodes and one selectable node at sixteen', () => {
    const fifteen = projectCanvas(fixture(15), new Set(['application']), {});
    expect(
      [...fifteen.cards.values()].filter((card) => card.kind === 'node'),
    ).toHaveLength(15);
    const sixteen = projectCanvas(fixture(16), new Set(['application']), {
      application: 'node-12',
    });
    expect(
      [...sixteen.cards.values()]
        .filter((card) => card.kind === 'node')
        .map((card) => card.kind === 'node' && card.node.id),
    ).toEqual(['node-12']);
    expect(
      sixteen.relations.get('application/assets')?.map((r) => r.id),
    ).toEqual(['reads-assets', 'writes-assets']);
    expect(sixteen.graph.edges[0].label).toBe('2');
  });
  it('keeps ten thousand instances out of the visible node tree', () => {
    const doc = fixture(10000);
    const result = projectCanvas(doc, new Set(['application']), {});
    expect(result.graph.nodes).toHaveLength(3);
    expect(doc.instances).toHaveLength(10000);
    expect(result.graph.edges).toHaveLength(1);
  });
  it('preserves cycle and self relation identities through collapsed groups', () => {
    const doc = fixture(2);
    doc.relations!.push({
      id: 'peer',
      from: 'orders-node-0',
      to: 'orders-node-1',
      kind: 'peers',
      evidenceRefs: ['config'],
    });
    const result = projectCanvas(doc, new Set(), {});
    expect(result.relations.get('application/application')?.[0].id).toBe(
      'peer',
    );
    expect(result.graph.nodes.every((n) => n.parentId === undefined)).toBe(
      true,
    );
  });
  it('summarizes logical relationships without inventing a host-to-host mesh', () => {
    const doc = fixture(1000);
    doc.groups = [];
    doc.services!.push({ id: 'worker', name: 'Processor', kind: 'worker' });
    doc.instances!.push(
      ...doc.nodes!.map((node) => ({
        id: `worker-${node.id}`,
        nodeRef: node.id,
        serviceRef: 'worker',
        role: 'peer',
      })),
    );
    doc.relations = [
      {
        id: 'dispatch',
        from: 'api',
        to: 'worker',
        kind: 'calls',
        evidenceRefs: ['config'],
      },
    ];
    const result = projectCanvas(doc, new Set(), {});
    expect(result.graph.edges).toHaveLength(1);
    expect(result.relations.get('api/worker')?.[0].id).toBe('dispatch');
    expect(result.cards.get('api')).toMatchObject({
      kind: 'service',
      instanceCount: 1000,
    });
  });
  it('compares stable identity rather than treating a rename as a replacement', () => {
    const before = fixture(1),
      after = structuredClone(before);
    after.nodes![0].name = 'Renamed';
    expect(compareDocuments(before, after)).toEqual([
      { id: 'node-0', kind: 'nodes', change: 'changed' },
    ]);
  });
});
it('ships explicit, complete catalogs with aligned placeholders', () => {
  const directory = new URL(
    '../../../internal/tessiven_ui/src/locales/',
    import.meta.url,
  );
  const source = JSON.parse(
    readFileSync(new URL('en-US.json', directory), 'utf8'),
  ) as Record<string, string>;
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  expect(files.sort()).toEqual([
    'de-DE.json',
    'en-US.json',
    'es-ES.json',
    'fr-FR.json',
    'ja-JP.json',
    'ko-KR.json',
    'pt-BR.json',
    'ru-RU.json',
    'zh-CN.json',
    'zh-TW.json',
  ]);
  for (const file of files) {
    const catalog = JSON.parse(
      readFileSync(new URL(file, directory), 'utf8'),
    ) as Record<string, string>;
    expect(Object.keys(catalog).sort(), file).toEqual(
      Object.keys(source).sort(),
    );
    for (const [key, value] of Object.entries(catalog)) {
      expect(value.trim(), `${file}:${key}`).not.toBe('');
      expect(value.match(/\{\w+\}/g)?.sort() ?? [], `${file}:${key}`).toEqual(
        source[key].match(/\{\w+\}/g)?.sort() ?? [],
      );
      expect(tessivenText(file.slice(0, -5))(key), `${file}:${key}`).toBe(
        value,
      );
    }
  }
});

import { parseTessivenLink } from '../../../internal/tessiven_ui/src/navigation';
it('opens canonical canvas links without accepting alternate authorities', () => {
  const base = 'https://localhost:23998/_redeven_proxy/env/';
  expect(
    parseTessivenLink(
      '/_redeven_proxy/env/?surface=tessiven&canvas=commerce&version=3',
      base,
    ),
  ).toMatchObject({ canvasID: 'commerce', version: 3 });
  for (const path of [
    'https://evil.test/_redeven_proxy/env/?surface=tessiven&canvas=commerce',
    '/_redeven_proxy/env/?surface=tessiven&canvas=commerce&version=0',
    '/_redeven_proxy/env/?surface=tessiven&canvas=a&canvas=b',
  ])
    expect(parseTessivenLink(path, base)).toBeNull();
});
