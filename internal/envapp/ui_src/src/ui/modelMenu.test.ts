import { describe, expect, it } from 'vitest';
import { flowerMenuModels } from '../../../../flower_ui/src/modelMenu';

describe('chat model menu', () => {
  const models = Array.from({ length: 100 }, (_, i) => ({ id: `provider/m${i}`, label: `Model ${i}`, group: 'Provider' }));
  it('keeps every catalog row in a stable order as selection changes', () => {
    const menu = flowerMenuModels(models, 'provider/m99', '');
    expect(menu).toHaveLength(100);
    expect(menu.map(model => model.id)).toEqual(models.map(model => model.id));
    expect(flowerMenuModels(models, 'provider/m0', '')).toEqual(menu);
    expect(menu.some(model => model.id === 'provider/m99')).toBe(true);
    expect(flowerMenuModels(models, '', 'Model 87')[0].id).toBe('provider/m87');
  });
  it('folds confirmed aliases without replacing the current identity or crossing connections', () => {
    const options = [
      { id: 'a/default', label: 'Default', group: 'A', aliasKey: 'same' },
      { id: 'a/q8', label: 'Q8', group: 'A', aliasKey: 'same' },
      { id: 'a/q4', label: 'Q4', group: 'A', aliasKey: 'different' },
      { id: 'b/q8', label: 'Q8', group: 'B', aliasKey: 'same' },
    ];
    const menu = flowerMenuModels(options, 'a/q8', '');
    expect(menu.map((model) => model.id)).toEqual(['a/q8', 'a/q4', 'b/q8']);
    expect(menu[0].aliases).toEqual(['Default']);
    expect(flowerMenuModels(options, 'a/q4', '').map(model => model.id)).toEqual(['a/default', 'a/q4', 'b/q8']);
    expect(flowerMenuModels(options, 'b/q8', '').map(model => model.group)).toEqual(['A', 'A', 'B']);
    expect(options.map(model => model.id)).toEqual(['a/default', 'a/q8', 'a/q4', 'b/q8']);
    expect(flowerMenuModels(options, 'a/q8', 'Default')[0].id).toBe('a/q8');
  });
});
