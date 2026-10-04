import { describe, expect, it } from 'vitest';
import { flowerMenuModels } from '../../../../flower_ui/src/modelMenu';

describe('chat model menu', () => {
  const models = Array.from({ length: 100 }, (_, i) => ({ id: `provider/m${i}`, label: `Model ${i}`, group: 'Provider' }));
  it('bounds initial choices while keeping current and recent models first', () => {
    const menu = flowerMenuModels(models, 'provider/m99', ['provider/m88'], '', false);
    expect(menu.models).toHaveLength(8);
    expect(menu.total).toBe(100);
    expect(menu.models.slice(0, 2).map((model) => model.id)).toEqual(['provider/m99', 'provider/m88']);
    expect(flowerMenuModels(models, '', [], '', true).models).toHaveLength(100);
    expect(flowerMenuModels(models, '', [], 'Model 87', false).models[0].id).toBe('provider/m87');
  });
  it('folds confirmed aliases without replacing the current identity or crossing connections', () => {
    const options = [
      { id: 'a/default', label: 'Default', group: 'A', aliasKey: 'same' },
      { id: 'a/q8', label: 'Q8', group: 'A', aliasKey: 'same' },
      { id: 'a/q4', label: 'Q4', group: 'A', aliasKey: 'different' },
      { id: 'b/q8', label: 'Q8', group: 'B', aliasKey: 'same' },
    ];
    const menu = flowerMenuModels(options, 'a/q8', [], '', false);
    expect(menu.models.map((model) => model.id)).toEqual(['a/q8', 'a/q4', 'b/q8']);
    expect(menu.models[0].aliases).toEqual(['Default']);
    expect(flowerMenuModels(options, 'a/q8', [], 'Default', false).models[0].id).toBe('a/q8');
  });
});
