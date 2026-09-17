export const COMPUTER_FRAME_RATES = [3, 5, 10, 15, 30] as const;
export const COMPUTER_FRAME_RATE_KEY = 'flower.computer-viewer.fps';
export function computerFrameRate(value: unknown): number {
  const fps = Number(value);
  return COMPUTER_FRAME_RATES.some(rate => rate === fps) ? fps : 3;
}
export function computerControlErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code ?? '');
}
