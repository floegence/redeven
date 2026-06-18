import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const flowerSurfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');
const threadListPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'threads', 'FlowerThreadList.tsx');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('Flower warmup presentation', () => {
  it('keeps runtime warmup distinct from empty and selected-thread loading states', () => {
    const source = readSource(flowerSurfacePath);

    expect(source).toContain('export type FlowerSurfaceWarmupState');
    expect(source).toContain('const surfaceWarmupActive = createMemo');
    expect(source).toContain('const warmupCanReplaceTranscript = createMemo');
    expect(source).toContain('data-flower-warmup={surfaceWarmupActive() ? \'true\' : \'false\'}');
    expect(source).toContain('surfaceWarmupActive()');
    expect(source).toContain('? warmupPanel()');
    expect(source).toContain('when={selectedThreadHasContent() || pendingTurnForSelectedThread()}');
    expect(source).toContain(': warmupCanReplaceTranscript()');
    expect(source).toContain('copy().chat.warmupComposerPlaceholder');
    expect(source).toContain('disabled={surfaceWarmupActive()}');
    expect(source).toContain('warmup={surfaceWarmupActive()}');
    expect(source).not.toContain('initialSurfaceLoading() && !snapshot() && threads().length === 0');
    expect(source).not.toContain('if (surfaceWarmupActive()) return true;');
  });

  it('renders a sidebar skeleton instead of the empty conversation copy while warmup is active', () => {
    const source = readSource(threadListPath);

    expect(source).toContain('warmup?: boolean');
    expect(source).toContain('const showWarmupSkeleton = createMemo(() => props.warmup === true && props.items.length === 0)');
    expect(source).toContain('const searchDisabled = createMemo(() => props.warmup === true && props.items.length === 0)');
    expect(source).toContain('copy().warmupDescription');
    expect(source).toContain('flower-thread-warmup-list');
    expect(source).toContain('disabled={props.refreshing || props.warmup}');
    expect(source).toContain('disabled={searchDisabled()}');
    expect(source.indexOf('when={!showWarmupSkeleton()}')).toBeLessThan(source.indexOf('fallback={<div class="flower-thread-empty'));
  });

  it('ships restrained warmup motion with reduced-motion fallbacks', () => {
    const css = readSource(stylesPath);

    expect(css).toContain('.flower-warmup');
    expect(css).toContain('.flower-thread-warmup-card');
    expect(css).toContain('.flower-model-chip-warmup');
    expect(css).toContain('@keyframes flower-thread-card-warmup');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.flower-thread-warmup-card::after,');
    expect(css).toContain('.flower-model-chip-warmup::after,');
    expect(css).toContain(".flower-surface[data-flower-warmup='true'] .flower-new-chat-button:disabled");
    expect(css).toContain(".flower-surface[data-flower-warmup='true'] .flower-composer textarea:disabled");
  });
});
