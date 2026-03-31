import type * as PretextModule from '@chenglou/pretext';

export type CodexPretextModule = typeof PretextModule;

let pretextModulePromise: Promise<CodexPretextModule> | null = null;

export function loadCodexPretextModule(): Promise<CodexPretextModule> {
  if (!pretextModulePromise) {
    pretextModulePromise = import('@chenglou/pretext');
  }
  return pretextModulePromise;
}

export function resetCodexPretextModuleForTests(): void {
  pretextModulePromise = null;
}
