// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import type { GitCommitSummary } from '../protocol/redeven_v1';
import { GitCommitGraph, buildCommitGraphRows } from './GitCommitGraph';

function commit(hash: string, parents: string[], subject: string): GitCommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject,
    authorName: 'Tester',
    authorTimeMs: Date.now(),
  };
}

describe('buildCommitGraphRows', () => {
  it('keeps side lanes stable through a merge sequence', () => {
    const rows = buildCommitGraphRows([
      commit('merge000', ['main001', 'feat001'], 'Merge branch'),
      commit('main001', ['main000'], 'Main work'),
      commit('feat001', ['feat000'], 'Feature work'),
      commit('main000', ['root000'], 'Main base'),
      commit('feat000', ['root000'], 'Feature base'),
      commit('root000', [], 'Root'),
    ]);

    expect(rows).toHaveLength(6);
    expect(rows[0]?.afterLanes.map((lane) => lane.hash)).toEqual(['main001', 'feat001']);
    expect(rows[1]?.beforeLanes.map((lane) => lane.hash)).toEqual(['main001', 'feat001']);
    expect(rows[2]?.beforeLanes.map((lane) => lane.hash)).toEqual(['main000', 'feat001']);
    expect(rows[2]?.lane).toBe(1);
    expect(rows[2]?.afterLanes.map((lane) => lane.hash)).toEqual(['main000', 'feat000']);
    expect(new Set(rows.map((row) => row.columns))).toEqual(new Set([2]));
    expect(rows[0]?.afterLanes[1]?.colorIndex).toBe(rows[2]?.nodeColorIndex);
    expect(rows[0]?.nodeColorIndex).toBe(rows[1]?.nodeColorIndex);
  });
});

describe('GitCommitGraph layout', () => {
  it('keeps static rails separate from per-row graph segments', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => GitCommitGraph({
      commits: [
        commit('commit003', ['commit002'], 'Latest commit'),
        commit('commit002', ['commit001'], 'Previous commit'),
        commit('commit001', [], 'Root commit'),
      ],
      selectedCommitHash: 'commit002',
    }), host);

    try {
      const rails = host.querySelector('[data-commit-graph-rails]') as SVGSVGElement | null;
      expect(rails?.getAttribute('class')).toContain('absolute top-0 left-0');
      expect(rails?.getAttribute('style')).toContain('height: 102px;');
      expect(rails?.getAttribute('height')).toBe('102');
      expect(rails?.querySelectorAll('circle')).toHaveLength(0);

      const rowSegments = host.querySelectorAll('[data-commit-graph-segment]');
      expect(rowSegments).toHaveLength(3);
      expect((rowSegments[0] as SVGSVGElement | undefined)?.getAttribute('height')).toBe('34');

      const outerNodes = Array.from(host.querySelectorAll('[data-commit-graph-node]'));
      expect(outerNodes.map((node) => node.getAttribute('cy'))).toEqual(['10', '10', '10']);

      const content = host.querySelector('[data-commit-graph-row="commit003"] > div.relative.z-20.grid.min-w-0') as HTMLDivElement | null;
      expect(content).toBeTruthy();
      expect(content?.getAttribute('style')).toContain('height: 34px;');
      expect(content?.getAttribute('style')).toContain('padding-top: 3px;');
      expect(content?.getAttribute('style')).toContain('padding-bottom: 6px;');
      expect(content?.getAttribute('style')).toContain('grid-template-rows: 14px 10px;');
      expect(content?.getAttribute('style')).toContain('gap: 1px;');

      const firstSubject = host.querySelector('[data-commit-graph-subject="commit003"]');
      expect(firstSubject?.textContent).toBe('Latest commit');
    } finally {
      dispose();
    }
  });
});
