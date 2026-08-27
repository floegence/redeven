import '../../index.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GitCommitSummary } from '../protocol/redeven_v1';
import { GitCommitGraph } from './GitCommitGraph';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function complexCommits(parentCount: number): GitCommitSummary[] {
  const parents = Array.from({ length: parentCount }, (_, index) => `parent-${String(index).padStart(2, '0')}`);
  return [
    {
      hash: 'merge-head',
      shortHash: 'merge-he',
      parents,
      subject: 'Merge every active feature line without hiding the commit summary',
      authorName: 'Integration Maintainer',
      authorTimeMs: Date.now() - 60_000,
    },
    ...parents.map((hash, index) => ({
      hash,
      shortHash: hash.slice(0, 8),
      parents: ['root-commit'],
      subject: `Feature line ${index + 1}`,
      authorName: `Contributor ${index + 1}`,
      authorTimeMs: Date.now() - (index + 2) * 60_000,
    })),
    {
      hash: 'root-commit',
      shortHash: 'root-com',
      parents: [],
      subject: 'Shared root',
      authorName: 'Repository Owner',
      authorTimeMs: Date.now() - 3_600_000,
    },
  ];
}

function readLayout(host: HTMLElement) {
  const row = host.querySelector<HTMLElement>('[data-commit-graph-row="merge-head"]')!;
  const rail = host.querySelector<SVGSVGElement>('[data-commit-graph-rails]')!;
  const graphCell = row.querySelector<HTMLElement>('[data-commit-graph-cell]')!;
  const summaryCell = row.querySelector<HTMLElement>('[data-commit-graph-summary]')!;
  const subject = row.querySelector<HTMLElement>('[data-commit-graph-subject]')!;
  const hash = row.querySelector<HTMLElement>('[data-commit-graph-hash]')!;
  const author = row.querySelector<HTMLElement>('[data-commit-graph-author]')!;
  const time = row.querySelector<HTMLElement>('[data-commit-graph-time]')!;
  return { row, rail, graphCell, summaryCell, subject, hash, author, time };
}

function expectContained(element: Element, container: Element) {
  const rect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(containerRect.left - 1);
  expect(rect.right).toBeLessThanOrEqual(containerRect.right + 1);
}

describe('GitCommitGraph responsive geometry', () => {
  let host: HTMLDivElement | null = null;
  let frame: HTMLDivElement | null = null;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    frame = document.createElement('div');
    frame.style.width = '240px';
    host.appendChild(frame);
    document.body.appendChild(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    host?.remove();
    host = null;
    frame = null;
  });

  it.each([22, 30])('keeps commit summaries visible for a %s-lane graph', async (parentCount) => {
    dispose = render(() => (
      <LayoutProvider>
        <GitCommitGraph commits={complexCommits(parentCount)} />
      </LayoutProvider>
    ), frame!);

    await settle();
    const narrow = readLayout(host!);
    expect(narrow.row.scrollWidth).toBeLessThanOrEqual(narrow.row.clientWidth + 1);
    expect(narrow.graphCell.getBoundingClientRect().width).toBeLessThanOrEqual(narrow.row.getBoundingClientRect().width * 0.45 + 1);
    expect(narrow.summaryCell.getBoundingClientRect().width).toBeGreaterThanOrEqual(128 - 1);
    for (const item of [narrow.subject, narrow.hash, narrow.author, narrow.time]) {
      expectContained(item, narrow.summaryCell);
      expect(item.getBoundingClientRect().width).toBeGreaterThan(0);
    }
    const railX = narrow.rail.querySelector<SVGLineElement>('line')!.x1.baseVal.value;
    const nodeX = narrow.row.querySelector<SVGCircleElement>('[data-commit-graph-node]')!.cx.baseVal.value;
    expect(nodeX).toBeCloseTo(railX, 5);

    const narrowGraphWidth = narrow.graphCell.getBoundingClientRect().width;
    frame!.style.width = '520px';
    await settle();

    const wide = readLayout(host!);
    expect(wide.row.scrollWidth).toBeLessThanOrEqual(wide.row.clientWidth + 1);
    expect(wide.graphCell.getBoundingClientRect().width).toBeGreaterThan(narrowGraphWidth);
    expect(wide.graphCell.getBoundingClientRect().width).toBeLessThanOrEqual(wide.row.getBoundingClientRect().width * 0.45 + 1);
    expect(wide.summaryCell.getBoundingClientRect().width).toBeGreaterThanOrEqual(wide.row.getBoundingClientRect().width * 0.55 - 1);
    for (const item of [wide.subject, wide.hash, wide.author, wide.time]) {
      expectContained(item, wide.summaryCell);
    }
  });
});
