import { describe, expect, it } from 'vitest';

import { ENV_APP_FLOATING_LAYER } from './envAppLayers';
import {
  MAX_ENV_APP_FLOATING_WINDOWS,
  createEnvAppFloatingWindowStack,
} from './envAppFloatingWindowStack';

describe('Env App floating window stack', () => {
  it('registers, activates, and unregisters windows with compact unique layers', () => {
    const stack = createEnvAppFloatingWindowStack();
    const unregisterA = stack.register('a');
    const unregisterB = stack.register('b');
    const unregisterC = stack.register('c');

    expect(stack.order()).toEqual(['a', 'b', 'c']);
    expect([stack.zIndex('a'), stack.zIndex('b'), stack.zIndex('c')]).toEqual([1000, 1001, 1002]);

    stack.activate('a');
    expect(stack.order()).toEqual(['b', 'c', 'a']);
    expect([stack.zIndex('b'), stack.zIndex('c'), stack.zIndex('a')]).toEqual([1000, 1001, 1002]);

    stack.activate('a');
    expect(stack.order()).toEqual(['b', 'c', 'a']);

    unregisterC();
    expect(stack.order()).toEqual(['b', 'a']);
    expect(stack.zIndex('a')).toBe(ENV_APP_FLOATING_LAYER.windowBase + 1);
    unregisterA();
    unregisterB();
    expect(stack.order()).toEqual([]);
  });

  it('keeps every supported window inside the fixed 1000-1099 band', () => {
    const stack = createEnvAppFloatingWindowStack();
    for (let index = 0; index < MAX_ENV_APP_FLOATING_WINDOWS; index += 1) {
      stack.register('window-' + index);
    }

    const layers = stack.order().map((stackId) => stack.zIndex(stackId));
    expect(new Set(layers)).toHaveLength(MAX_ENV_APP_FLOATING_WINDOWS);
    expect(Math.min(...layers)).toBe(ENV_APP_FLOATING_LAYER.windowBase);
    expect(Math.max(...layers)).toBe(ENV_APP_FLOATING_LAYER.windowCeiling);
    expect(() => stack.register('window-overflow')).toThrow(RangeError);
  });

  it('mixes plugin and product windows in one most-recently-used order', () => {
    const stack = createEnvAppFloatingWindowStack();
    stack.register('file-browser');
    stack.register('plugin:one');
    stack.register('debug-console');
    stack.register('plugin:two');

    stack.activate('plugin:one');
    stack.activate('file-browser');

    expect(stack.order()).toEqual(['debug-console', 'plugin:two', 'plugin:one', 'file-browser']);
    expect(stack.zIndex('file-browser')).toBeGreaterThan(stack.zIndex('plugin:one'));
  });

  it('keeps a shared id registered until every owner unregisters', () => {
    const stack = createEnvAppFloatingWindowStack();
    const unregisterFirst = stack.register('shared');
    const unregisterSecond = stack.register('shared');

    expect(stack.order()).toEqual(['shared']);
    unregisterFirst();
    expect(stack.order()).toEqual(['shared']);
    unregisterSecond();
    expect(stack.order()).toEqual([]);
  });
});
