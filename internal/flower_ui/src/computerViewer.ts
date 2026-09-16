import type { FlowerComputerFrameSource } from './contracts/flowerSurfaceContracts';

export const COMPUTER_FRAME_RATES = [3, 5, 10, 15, 30] as const;
export const COMPUTER_FRAME_RATE_KEY = 'flower.computer-viewer.fps';
export function computerFrameRate(value: unknown): number {
  const fps = Number(value);
  return COMPUTER_FRAME_RATES.some(rate => rate === fps) ? fps : 3;
}
export function computerFramePath(frame: FlowerComputerFrameSource): string {
  if (frame.private_frame) {
    const query = new URLSearchParams({ ...frame.private_frame, viewer_revision: String(frame.private_frame.viewer_revision), thread_id: frame.thread_id });
    return `/_redeven_proxy/api/ai/computer/private-frame?${query}`;
  }
  return `/_redeven_proxy/api/ai/threads/${encodeURIComponent(frame.thread_id)}/computer-media/${encodeURIComponent(frame.target_id)}/${encodeURIComponent(frame.sha256)}`;
}
export function computerControlErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code ?? '');
}
