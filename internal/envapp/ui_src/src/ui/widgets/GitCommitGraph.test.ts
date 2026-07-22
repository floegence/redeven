// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
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
    expect(rows[0]?.afterLanes.map((lane) => lane.colorIndex)).toEqual([0, 1]);
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
  it('exposes stable commit actions from the row context menu', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const selectedCommit = vi.fn();
    const askFlower = vi.fn();
    const openTerminal = vi.fn();
    const browseFiles = vi.fn();
    const switchDetached = vi.fn();
    const copyText = vi.fn();
    const targetCommit = commit('commit-context-hash', ['parent'], 'Context target');

    const dispose = render(() => GitCommitGraph({
      commits: [targetCommit],
      repoRootPath: '/workspace/repo',
      onSelect: selectedCommit,
      onAskFlower: askFlower,
      onOpenInTerminal: openTerminal,
      onBrowseFiles: browseFiles,
      onSwitchDetached: switchDetached,
      onCopyText: copyText,
    }), host);
    const row = host.querySelector<HTMLButtonElement>('[data-commit-graph-row]')!;
    const openMenu = async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
      await Promise.resolve();
      return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    };

    try {
      let actions = await openMenu();
      expect(actions).toHaveLength(6);
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(askFlower).toHaveBeenCalledWith(expect.objectContaining({ kind: 'commit', commit: expect.objectContaining({ hash: 'commit-context-hash' }), files: [] }));

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('View Commit Details'))!.click();
      expect(selectedCommit).toHaveBeenCalledWith('commit-context-hash');

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Open Terminal'))!.click();
      expect(openTerminal).toHaveBeenCalledWith({ path: '/workspace/repo' });

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Browse Files'))!.click();
      expect(browseFiles).toHaveBeenCalledWith({ path: '/workspace/repo' });

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Switch Detached'))!.click();
      expect(switchDetached).toHaveBeenCalledWith({ commitHash: 'commit-context-hash', shortHash: targetCommit.shortHash, source: 'graph' });

      actions = await openMenu();
      targetCommit.hash = 'mutated-after-open';
      actions.find((item) => item.textContent?.includes('Copy Commit Hash'))!.click();
      expect(copyText).toHaveBeenCalledWith('commit-context-hash');
    } finally {
      dispose();
    }
  });

  it('uses the theme categorical palette for distinct merge lanes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => GitCommitGraph({
      commits: [
        commit('merge000', ['main001', 'feat001'], 'Merge branch'),
        commit('main001', ['root000'], 'Main work'),
        commit('feat001', ['root000'], 'Feature work'),
        commit('root000', [], 'Root'),
      ],
    }), host);

    try {
      const strokes = Array.from(host.querySelectorAll('[data-commit-graph-segment] path')).map((path) => path.getAttribute('stroke'));
      expect(strokes.some((stroke) => stroke?.includes('var(--redeven-categorical-1)'))).toBe(true);
      expect(strokes.some((stroke) => stroke?.includes('var(--redeven-categorical-2)'))).toBe(true);
      const fills = Array.from(host.querySelectorAll('[data-commit-graph-segment] circle:not([data-commit-graph-node])')).map((node) => node.getAttribute('fill'));
      expect(fills).toContain('var(--redeven-categorical-1)');
      expect(fills).toContain('var(--redeven-categorical-2)');
      const mergeLabel = Array.from(host.querySelectorAll('span')).find((node) => node.textContent === 'Merge x2');
      expect(mergeLabel?.className).toContain('text-[var(--redeven-categorical-6)]');
    } finally {
      dispose();
    }
  });

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
