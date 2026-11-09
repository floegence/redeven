import { isWorkbenchThemeId } from '@floegence/floe-webapp-core/workbench';
import {
  samePersistedWorkbenchLocalState,
  sanitizePersistedWorkbenchLocalState,
  type PersistedWorkbenchLocalState,
} from '../workbench/runtimeWorkbenchLayout';
import { readUIStorageJSON, writeUIStorageJSON } from './uiStorage';

const listeners = new Map<string, Set<(state: PersistedWorkbenchLocalState) => void>>();

export function readWorkbenchLocalPreferences(key: string): PersistedWorkbenchLocalState {
  return sanitizePersistedWorkbenchLocalState(readUIStorageJSON(key, null), []);
}

export function writeWorkbenchLocalPreferences(key: string, value: PersistedWorkbenchLocalState): void {
  const state = sanitizePersistedWorkbenchLocalState(value, []);
  writeUIStorageJSON(key, state);
  for (const listener of listeners.get(key) ?? []) listener(state);
}

export function writeWorkbenchTheme(key: string, theme: unknown): void {
  if (!isWorkbenchThemeId(theme)) return;
  // IMPORTANT: Use the exact Env storage binding and the complete existing local
  // state. A global theme change cannot reset canvas lock/mode/tool or create a
  // second theme key; the published HUD and Settings share this preference owner.
  writeWorkbenchLocalPreferences(key, { ...readWorkbenchLocalPreferences(key), theme });
}

export function subscribeWorkbenchLocalPreferences(key: string, listener: (state: PersistedWorkbenchLocalState) => void): () => void {
  let current = readWorkbenchLocalPreferences(key);
  const deliver = (state: PersistedWorkbenchLocalState) => {
    if (!samePersistedWorkbenchLocalState(current, state)) { current = state; listener(state); }
  };
  const refresh = () => deliver(readWorkbenchLocalPreferences(key));
  const stored = (event: StorageEvent) => { if (event.key === null || event.key === key) refresh(); };
  const subscribers = listeners.get(key) ?? new Set<(state: PersistedWorkbenchLocalState) => void>();
  subscribers.add(deliver); listeners.set(key, subscribers);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', stored);
    window.addEventListener('focus', refresh);
  }
  return () => {
    subscribers.delete(deliver);
    if (subscribers.size === 0) listeners.delete(key);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', stored);
      window.removeEventListener('focus', refresh);
    }
  };
}
