import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const surfaceSource = readFileSync(new URL('./FlowerSurface.tsx', import.meta.url), 'utf8');
const cacheSource = readFileSync(new URL('./threadCache.ts', import.meta.url), 'utf8');

describe('Flower terminal detail convergence architecture', () => {
  it('keeps one detail receiver and removes superseded recovery paths', () => {
    expect(surfaceSource.match(/const receiveThreadDetail =/gu)).toHaveLength(1);
    expect(surfaceSource.match(/\.receiveView\(/gu)).toHaveLength(1);
    expect(surfaceSource).not.toContain('applyLiveBootstrap');
    expect(surfaceSource).not.toContain('threadBootstrapRequests');
    expect(surfaceSource).not.toContain('summaryDetailRecoveryInFlight');
    expect(surfaceSource).not.toContain('runtimeSummaryStateKey');
    expect(surfaceSource).not.toContain('const refreshSelectedThread');
    expect(surfaceSource).not.toContain('.replaceView(');
    expect(surfaceSource).not.toContain('applyThreadPermissionLocally');
    expect(surfaceSource).not.toContain('queueMicrotask(() => recoverSelectedThreadFromSummary');
  });

  it('keeps transport epochs out of cached detail ordering', () => {
    expect(cacheSource).not.toContain('connectionEpoch');
    expect(cacheSource).not.toContain('canReplaceThreadView');
    expect(cacheSource.match(/function classifyThreadView/gu)).toHaveLength(1);
    expect(cacheSource.match(/function classifyThreadSettings/gu)).toHaveLength(1);
    expect(cacheSource.match(/^ {4}receiveView\(view/gmu)).toHaveLength(1);
    expect(cacheSource).not.toContain('updateThread(');
  });
});
