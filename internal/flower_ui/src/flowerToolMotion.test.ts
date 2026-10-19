import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowerToolMotion } from './flowerToolMotion';

describe('tool icon catalog', () => {
  it('covers every registered product tool and extension fallback', () => {
    const registry = readFileSync(new URL('../../ai/tools/registry.go', import.meta.url), 'utf8');
    const names = [...registry.matchAll(/^\s*"([^" ]+)":\s*\{/gm)].map(match => match[1]);
    expect(names.length).toBeGreaterThanOrEqual(53);
    for (const name of [...names, 'goal', 'ask_user', 'sources', 'web_search', 'mcp', 'unknown']) expect(flowerToolMotion[name], name).toBeDefined();
  });
  it('uses independent tracks with stable phase timing', () => {
    for (const [name, recipe] of Object.entries(flowerToolMotion)) {
      expect(recipe.cycle, name).toBeGreaterThan(0);
      const assigned = new Set<number>();
      for (const track of recipe.tracks) {
        expect(track.keyframes[0].offset, name).toBe(0);
        expect(track.keyframes.at(-1)?.offset, name).toBe(1);
        if (track.parts === 'all') expect(recipe.tracks, name).toHaveLength(1);
        else for (const part of track.parts) { expect(assigned.has(part), name).toBe(false); assigned.add(part); }
      }
    }
  });
});
