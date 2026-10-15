import { describe, expect, it } from 'vitest';
import { FlowerToolIcon } from '../../../internal/flower_ui/src/FlowerToolIcon';

describe('Desktop tool icon resolution', () => {
  it('loads the shared glyphs through the Desktop dependency graph', () => {
    expect(typeof FlowerToolIcon).toBe('function');
  });
});
