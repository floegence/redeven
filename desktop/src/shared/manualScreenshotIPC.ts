export const MANUAL_SCREENSHOT_CHANNEL = 'redeven-desktop:manual-screenshot';
export function parseManualScreenshotRequest(value: unknown): { url: string; region: { x: number; y: number; width: number; height: number } } {
  const input = value as { url?: unknown; region?: Record<string, unknown> } | null;
  if (!input || typeof input.url !== 'string' || input.url.length > 8192 || !input.region ||
    Object.keys(input.region).sort().join(',') !== 'height,width,x,y') throw new Error('Invalid screenshot request.');
  const { x, y, width, height } = input.region;
  if (![x, y, width, height].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 16384) || !width || !height) throw new Error('Invalid screenshot region.');
  return { url: input.url, region: { x: x as number, y: y as number, width: width as number, height: height as number } };
}

export const ASK_FLOWER_SOURCE_CHANNEL = 'redeven-desktop:ask-flower-source';
export const RELEASE_FLOWER_SOURCE_CHANNEL = 'redeven-desktop:release-flower-source';
export const SOURCE_SCREENSHOT_CHANNEL = 'redeven-desktop:source-screenshot';
export type DesktopAskFlowerSource = Readonly<{ id: string; title: string; url: string; captured_at_ms: number }>;
