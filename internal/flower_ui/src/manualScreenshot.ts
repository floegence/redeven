export type ScreenshotRegion = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ManualScreenshotSource = Readonly<{
  element: HTMLElement;
  valid: () => boolean;
}>;
export type ScreenshotBridge = (request: { url: string; region: ScreenshotRegion }) => Promise<{ png: Uint8Array }>;
type CaptureDevices = MediaDevices & { setCaptureHandleConfig?: (config: { handle: string; exposeOrigin: boolean; permittedOrigins: string[] }) => void };
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(signal.reason));
    const timer = setTimeout(() => finish(() => reject(new Error('capture_unavailable'))), 5000);
    const finish = (done: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', abort); done(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

type CaptureTrack = MediaStreamTrack & {
  getCaptureHandle?: () => { handle?: string; origin?: string } | null;
  cropTo?: (target: unknown) => Promise<void>;
};
type CropAPI = { fromElement: (element: Element) => Promise<unknown> };
type TrackProcessorAPI = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> };

export function screenshotRegion(element: HTMLElement): ScreenshotRegion {
  const bounds = element.getBoundingClientRect();
  const x = Math.max(0, Math.floor(bounds.left)); const y = Math.max(0, Math.floor(bounds.top));
  const width = Math.min(innerWidth, Math.ceil(bounds.right)) - x;
  const height = Math.min(innerHeight, Math.ceil(bounds.bottom)) - y;
  if (!element.isConnected || width <= 0 || height <= 0) throw new Error('source_unavailable');
  return { x, y, width, height };
}

/** Explicit gesture only. No observer, background sampling or model callback. */
export async function captureManualScreenshot(source: ManualScreenshotSource, signal: AbortSignal, bridge?: ScreenshotBridge): Promise<File> {
  const url = location.href;
  const check = () => {
    signal.throwIfAborted();
    if (url !== location.href || !source.valid() || !source.element.isConnected) throw new Error('source_unavailable');
    const privateSelector = 'input[type="password"], [data-private="true"], [data-flower-capture-private]';
    if (source.element.matches(privateSelector) || [...source.element.querySelectorAll(privateSelector)].some(element => element.getClientRects().length > 0)) throw new Error('private_surface');
  };
  check();
  let stream: MediaStream | undefined;
  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined;
  let captureStyle: HTMLStyleElement | undefined;
  const restore = () => { captureStyle?.remove(); captureStyle = undefined; };
  const stop = () => stream?.getTracks().forEach(track => track.stop());
  signal.addEventListener('abort', stop, { once: true });
  const devices = navigator.mediaDevices as CaptureDevices | undefined;
  const handle = crypto.randomUUID();
  try {
    if (!bridge) {
      if (!devices?.getDisplayMedia || !devices.setCaptureHandleConfig) throw new Error('capture_unavailable');
      devices.setCaptureHandleConfig({ handle, exposeOrigin: true, permittedOrigins: [location.origin] });
      // Request before awaiting anything, while the explicit click is active.
      stream = await devices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
      check();
      const track = stream.getVideoTracks()[0] as CaptureTrack | undefined;
      if (track?.getCaptureHandle?.()?.handle !== handle || track.getCaptureHandle?.()?.origin !== location.origin) throw new Error('select_current_tab');
      await bounded(track.applyConstraints({ frameRate: { min: 5, ideal: 30 } }), signal);
      if (!track.cropTo || !(globalThis as typeof globalThis & { CropTarget?: CropAPI }).CropTarget
        || !(globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorAPI }).MediaStreamTrackProcessor) throw new Error('capture_unavailable');
    }
    check();
    // Keep the editor mounted and focused; omit only prompt chrome from this frame.
    // An isolated stylesheet survives reactive inline positioning updates and
    // applies outside the animated card without unmounting or blurring it.
    captureStyle = document.createElement('style');
    captureStyle.textContent = '.floe-prompt-card-positioner, .flower-turn-launcher-related-surface { opacity: 0 !important; }';
    document.head.append(captureStyle);
    await bounded(new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), signal);
    check();
    const region = screenshotRegion(source.element);
    let blob: Blob;
    if (bridge) {
      const result = await bounded(bridge({ url, region }), signal);
      check();
      restore();
      blob = new Blob([new Uint8Array(result.png)], { type: 'image/png' });
    } else {
      const track = stream!.getVideoTracks()[0] as CaptureTrack;
      const crop = (globalThis as typeof globalThis & { CropTarget: CropAPI }).CropTarget;
      const target = await bounded(crop.fromElement(source.element), signal);
      const Processor = (globalThis as typeof globalThis & { MediaStreamTrackProcessor: TrackProcessorAPI }).MediaStreamTrackProcessor;
      reader = new Processor({ track, maxBufferSize: 1 }).readable.getReader();
      let cropped = false;
      let expired = false;
      // Drain pre-crop frames continuously. The crop completion boundary only
      // guarantees future track frames; it cannot clear a consumer's old buffer.
      const nextFrame = (async () => {
        while (true) {
          const result = await reader!.read();
          if (!result.value) throw new Error('capture_unavailable');
          if (cropped && !expired) return result.value;
          result.value.close();
          if (expired) throw new Error('capture_unavailable');
        }
      })();
      void nextFrame.catch(() => undefined);
      let frame: VideoFrame | undefined;
      try {
        await bounded(track.cropTo!(target).then(() => { cropped = true; }), signal);
        frame = await bounded(nextFrame, signal);
        check();
        if (track.getCaptureHandle?.()?.handle !== handle) throw new Error('source_unavailable');
        const canvas = document.createElement('canvas');
        canvas.width = frame.displayWidth; canvas.height = frame.displayHeight;
        if (!canvas.width || !canvas.height) throw new Error('capture_unavailable');
        const context = canvas.getContext('2d'); if (!context) throw new Error('capture_unavailable');
        context.drawImage(frame, 0, 0);
        restore();
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('capture_unavailable')), 'image/png'));
      } finally { expired = true; frame?.close(); void nextFrame.then(value => { if (value !== frame) value.close(); }, () => undefined); }
    }
    check();
    if (!blob.size) throw new Error('capture_unavailable');
    return new File([blob], `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: 'image/png' });
  } finally {
    if (reader) void reader.cancel().catch(() => undefined);
    stop(); signal.removeEventListener('abort', stop);
    restore();
    if (!bridge) {
      try { devices?.setCaptureHandleConfig?.({ handle: '', exposeOrigin: false, permittedOrigins: [] }); }
      catch { /* Cleanup cannot replace the original capture outcome. */ }
    }
  }
}
