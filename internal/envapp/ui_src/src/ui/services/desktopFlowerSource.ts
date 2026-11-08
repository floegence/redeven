import type { DesktopAskFlowerSource } from '../../../../../../desktop/src/shared/manualScreenshotIPC';
import { flowerPageContextSnapshot } from '../flower/flowerPageContext';
import { buildAskFlowerContextAction } from '../contextActions/askFlower';
import { createClientId } from '../utils/clientId';
import { receiveFilePreviewFlowerIntent } from './filePreviewFlowerIntent';

export function prepareFlowerWindowHandoff(source: DesktopAskFlowerSource | undefined, environmentID: string, environmentName: string, invalidPath: string) {
  return source ? { intent: desktopFlowerSourceIntent(source, environmentID, environmentName, invalidPath),
    screenshot: desktopFlowerSourceScreenshot(source.id), anchor: { x: 32, y: 80 } }
    : { intent: receiveFilePreviewFlowerIntent(undefined, invalidPath), screenshot: undefined, anchor: undefined };
}

export function deliverFlowerWindowHandoff(source: DesktopAskFlowerSource | undefined, environmentID: string, environmentName: string, invalidPath: string,
  open: (intent: ReturnType<typeof prepareFlowerWindowHandoff>['intent'], anchor?: { x: number; y: number }) => unknown,
  attachScreenshot: (screenshot: ReturnType<typeof prepareFlowerWindowHandoff>['screenshot']) => void) {
  const handoff = prepareFlowerWindowHandoff(source, environmentID, environmentName, invalidPath);
  if (open(handoff.intent, handoff.anchor)) attachScreenshot(handoff.screenshot);
  else window.redevenDesktopShell?.releaseAskFlowerSource?.();
}

export function desktopFlowerSourceIntent(source: DesktopAskFlowerSource, environmentID: string, environmentName: string, invalidPath: string) {
  if (source.file_path) return receiveFilePreviewFlowerIntent(source.file_path, invalidPath);
  const snapshot = flowerPageContextSnapshot({ environmentID, environmentName, pageID: '', pageName: source.title || environmentName,
    capturedAtMs: source.captured_at_ms, state: { url: source.url, ...(source.selection ? { selection: source.selection } : {}) } });
  const context = { kind: 'text_snapshot' as const, title: snapshot.title, content: snapshot.content };
  return { id: createClientId(), source_surface: 'flower_composer' as const, context_items: [context],
    context_action: buildAskFlowerContextAction({ source: 'flower_composer', context_items: [context], surfaceId: source.id }) };
}

export function desktopFlowerSourceScreenshot(id: string) {
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const result = await window.redevenDesktopShell?.captureSourceScreenshot?.(id);
    signal.throwIfAborted(); if (!result) throw new Error('source_unavailable');
    return new File([new Uint8Array(result.png)], `Screenshot-${Date.now()}.png`, { type: 'image/png' });
  };
}
