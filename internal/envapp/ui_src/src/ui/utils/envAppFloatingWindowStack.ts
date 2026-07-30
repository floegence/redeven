import { createSignal, type Accessor } from 'solid-js';

import { ENV_APP_FLOATING_LAYER } from './envAppLayers';

export const MAX_ENV_APP_FLOATING_WINDOWS = (
  ENV_APP_FLOATING_LAYER.windowCeiling - ENV_APP_FLOATING_LAYER.windowBase + 1
);

export type EnvAppFloatingWindowStack = Readonly<{
  order: Accessor<readonly string[]>;
  register: (stackId: string) => () => void;
  activate: (stackId: string) => void;
  zIndex: (stackId: string) => number;
}>;

function normalizeStackId(value: string): string {
  const stackId = String(value ?? '').trim();
  if (!stackId) throw new Error('Floating window stack id must not be empty');
  return stackId;
}

export function createEnvAppFloatingWindowStack(): EnvAppFloatingWindowStack {
  const [order, setOrder] = createSignal<readonly string[]>([]);
  const registrationCounts = new Map<string, number>();

  const register = (value: string): (() => void) => {
    const stackId = normalizeStackId(value);
    const registrationCount = registrationCounts.get(stackId) ?? 0;
    if (registrationCount === 0) {
      setOrder((current) => {
        if (current.length >= MAX_ENV_APP_FLOATING_WINDOWS) {
          throw new RangeError('Env App floating window capacity exceeded');
        }
        return [...current, stackId];
      });
    }
    registrationCounts.set(stackId, registrationCount + 1);

    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const nextRegistrationCount = (registrationCounts.get(stackId) ?? 1) - 1;
      if (nextRegistrationCount > 0) {
        registrationCounts.set(stackId, nextRegistrationCount);
        return;
      }
      registrationCounts.delete(stackId);
      setOrder((current) => current.filter((candidate) => candidate !== stackId));
    };
  };

  const activate = (value: string): void => {
    const stackId = normalizeStackId(value);
    setOrder((current) => {
      const index = current.indexOf(stackId);
      if (index < 0 || index === current.length - 1) return current;
      return [...current.slice(0, index), ...current.slice(index + 1), stackId];
    });
  };

  const zIndex = (value: string): number => {
    const stackId = normalizeStackId(value);
    const index = order().indexOf(stackId);
    return ENV_APP_FLOATING_LAYER.windowBase + Math.max(0, index);
  };

  return Object.freeze({ order, register, activate, zIndex });
}
