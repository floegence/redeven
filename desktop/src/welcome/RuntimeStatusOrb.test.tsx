import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeStatusOrbShouldAnimate } from './RuntimeStatusOrb';

function readRuntimeStatusOrbSource(): string {
  return fs.readFileSync(path.join(__dirname, 'RuntimeStatusOrb.tsx'), 'utf8');
}

describe('RuntimeStatusOrb', () => {
  it('uses the published thinking-orbs Working engine for both active and paused states', () => {
    const source = readRuntimeStatusOrbSource();

    expect(source).toContain("from 'thinking-orbs/engine'");
    expect(source).toContain("resolvePreset('working', RUNTIME_ORB_SIZE)");
    expect(source).toContain("data-runtime-orb-animation={props.running ? 'running' : 'paused'}");
  });

  it('animates only an active, visible runtime when motion is allowed', () => {
    expect(runtimeStatusOrbShouldAnimate({
      running: true,
      reducedMotion: false,
      visible: true,
      documentHidden: false,
    })).toBe(true);
    expect(runtimeStatusOrbShouldAnimate({
      running: false,
      reducedMotion: false,
      visible: true,
      documentHidden: false,
    })).toBe(false);
    expect(runtimeStatusOrbShouldAnimate({
      running: true,
      reducedMotion: true,
      visible: true,
      documentHidden: false,
    })).toBe(false);
  });

  it('stops hidden and reduced-motion animation while retaining a representative frame', () => {
    const source = readRuntimeStatusOrbSource();

    expect(source).toContain("const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'");
    expect(source).toContain("document.visibilityState === 'hidden'");
    expect(source).toContain('new IntersectionObserver');
    expect(source).toContain('paint(reducedMotion.matches ? 0.6');
    expect(source).toContain('window.cancelAnimationFrame(animationFrame)');
  });
});
