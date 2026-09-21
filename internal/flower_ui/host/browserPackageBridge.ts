// This is the product's shared renderer boundary. Package bytes and paths stay
// in Desktop; callers name only an exact package from the Runtime catalog.
import type { BrowserPackageBridge } from '../../../desktop/src/shared/browserPackageIPC';
export type { BrowserPackageBridge } from '../../../desktop/src/shared/browserPackageIPC';
export function browserPackageBridge(): BrowserPackageBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as Window & { redevenBrowserPackage?: BrowserPackageBridge }).redevenBrowserPackage;
  return typeof bridge?.request === 'function' && typeof bridge?.subscribe === 'function' ? bridge : undefined;
}
