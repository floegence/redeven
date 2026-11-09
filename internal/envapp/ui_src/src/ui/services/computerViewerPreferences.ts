import { COMPUTER_FRAME_RATE_KEY, computerFrameRate } from '../../../../../flower_ui/src/computerViewer';
import { readUIStorageItem, writeUIStorageItem } from './uiStorage';

const listeners = new Set<(fps: number) => void>();

export function readComputerViewerFrameRate(): number {
  return computerFrameRate(readUIStorageItem(COMPUTER_FRAME_RATE_KEY));
}

export function writeComputerViewerFrameRate(value: number): void {
  const fps = computerFrameRate(value);
  // IMPORTANT: Global settings and the viewer quick control own this same existing
  // Env preference. Changing display cadence must never acquire computer control.
  writeUIStorageItem(COMPUTER_FRAME_RATE_KEY, String(fps));
  for (const listener of listeners) listener(fps);
}

export function subscribeComputerViewerFrameRate(listener: (fps: number) => void): () => void {
  let current = readComputerViewerFrameRate();
  const deliver = (fps: number) => { if (fps !== current) { current = fps; listener(fps); } };
  const refresh = () => deliver(readComputerViewerFrameRate());
  const stored = (event: StorageEvent) => { if (event.key === null || event.key === COMPUTER_FRAME_RATE_KEY) refresh(); };
  listeners.add(deliver);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', stored);
    window.addEventListener('focus', refresh);
  }
  return () => {
    listeners.delete(deliver);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', stored);
      window.removeEventListener('focus', refresh);
    }
  };
}

export const envComputerViewerFrameRate = {
  read: readComputerViewerFrameRate,
  write: writeComputerViewerFrameRate,
  subscribe: subscribeComputerViewerFrameRate,
};
