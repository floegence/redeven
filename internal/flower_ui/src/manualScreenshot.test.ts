// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureManualScreenshot, screenshotRegion } from './manualScreenshot';
let element: HTMLElement;
beforeEach(() => {
  element = document.createElement('section'); document.body.append(element);
  element.getBoundingClientRect = () => ({ left: 20, top: 40, right: 320, bottom: 240, width: 300, height: 200 }) as DOMRect;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(1)); return 1; });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('manual screenshots', () => {
  it('captures only the bound region and restores mounted prompt chrome', async () => {
    const card = document.createElement('div'); card.className = 'floe-prompt-card-positioner'; document.body.append(card);
    const bridge = vi.fn(async () => {
      card.setAttribute('style', 'left: 40px'); // Reactive positioning must not reveal the card.
      expect(getComputedStyle(card).opacity).toBe('0'); return { png: new Uint8Array([1, 2, 3]) };
    });
    const image = await captureManualScreenshot({ element, valid: () => true }, new AbortController().signal, bridge);
    expect(bridge).toHaveBeenCalledWith({ url: location.href, region: { x: 20, y: 40, width: 300, height: 200 } });
    expect(image.type).toBe('image/png'); expect(image.size).toBe(3); expect(card.style.opacity).toBe('');
  });
  it('rejects changed sources and private fields before calling the host', async () => {
    const bridge = vi.fn();
    await expect(captureManualScreenshot({ element, valid: () => false }, new AbortController().signal, bridge)).rejects.toThrow('source_unavailable');
    element.innerHTML = '<input type="password" value="private">';
    element.firstElementChild!.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList;
    await expect(captureManualScreenshot({ element, valid: () => true }, new AbortController().signal, bridge)).rejects.toThrow('private_surface');
    expect(bridge).not.toHaveBeenCalled();
  });
  it('discards a late host image after cancellation and restores the prompt', async () => {
    const card = document.createElement('div'); card.className = 'floe-prompt-card-positioner'; document.body.append(card);
    const operation = new AbortController();
    const bridge = vi.fn(async () => { operation.abort(); return { png: new Uint8Array([1]) }; });
    await expect(captureManualScreenshot({ element, valid: () => true }, operation.signal, bridge)).rejects.toThrow();
    expect(card.style.opacity).toBe('');
  });
  it('restores the card immediately on abort even if the host never replies', async () => {
    const card = document.createElement('div'); card.className = 'floe-prompt-card-positioner'; document.body.append(card);
    const operation = new AbortController();
    const bridge = vi.fn(() => new Promise<{ png: Uint8Array }>(() => undefined));
    const result = captureManualScreenshot({ element, valid: () => true }, operation.signal, bridge);
    await vi.waitFor(() => expect(bridge).toHaveBeenCalledOnce());
    operation.abort();
    await expect(result).rejects.toThrow(); expect(card.style.opacity).toBe('');
  });
  it('never accepts another browser tab and stops all acquired tracks', async () => {
    const stop = vi.fn(); const track = { stop, getCaptureHandle: () => ({ handle: 'other', origin: location.origin }) };
    const devices = { setCaptureHandleConfig: vi.fn(), getDisplayMedia: vi.fn(async () => ({ getVideoTracks: () => [track], getTracks: () => [track] })) };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    await expect(captureManualScreenshot({ element, valid: () => true }, new AbortController().signal)).rejects.toThrow('select_current_tab');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(devices.setCaptureHandleConfig).toHaveBeenLastCalledWith({ handle: '', exposeOrigin: false, permittedOrigins: [] });
  });
  it('drains pre-crop frames and closes the fresh frame and stream', async () => {
    const closed = [vi.fn(), vi.fn()]; let handle = ''; let cropped = false;
    const pending: Array<(value: ReadableStreamReadResult<VideoFrame>) => void> = [];
    const frames = closed.map(close => ({ displayWidth: 300, displayHeight: 200, close } as unknown as VideoFrame));
    const reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<VideoFrame>>(resolve => pending.push(resolve))), cancel: vi.fn(async () => undefined) };
    const track = { stop: vi.fn(), getCaptureHandle: () => ({ handle, origin: location.origin }), applyConstraints: vi.fn(async () => undefined),
      cropTo: vi.fn(async () => {
        pending.shift()!({ done: false, value: frames[0]! });
        await Promise.resolve(); cropped = true;
        setTimeout(() => pending.shift()!({ done: false, value: frames[1]! }), 0);
      }) };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      setCaptureHandleConfig: (config: { handle: string }) => { handle = config.handle; },
      getDisplayMedia: vi.fn(async () => ({ getVideoTracks: () => [track], getTracks: () => [track] })),
    } });
    vi.stubGlobal('CropTarget', { fromElement: vi.fn(async source => { expect(source).toBe(element); return 'target'; }) });
    vi.stubGlobal('MediaStreamTrackProcessor', class { readable = { getReader: () => reader }; });
    const draw = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(frame => { expect(cropped).toBe(true); expect(frame).toBe(frames[1]); }) } as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['image'], { type: 'image/png' })));
    try {
      const file = await captureManualScreenshot({ element, valid: () => true }, new AbortController().signal);
      expect(file.type).toBe('image/png'); expect(track.cropTo).toHaveBeenCalledWith('target');
      expect(track.applyConstraints).toHaveBeenCalledWith({ frameRate: { min: 5, ideal: 30 } });
      expect(closed[0]).toHaveBeenCalledOnce(); expect(closed[1]).toHaveBeenCalledOnce();
      expect(reader.cancel).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
    } finally { draw.mockRestore(); encode.mockRestore(); }
  });
  it('clips the visible source and rejects a detached source', () => {
    element.getBoundingClientRect = () => ({ left: -20, top: -10, right: 300, bottom: 200 }) as DOMRect;
    expect(screenshotRegion(element)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    element.remove(); expect(() => screenshotRegion(element)).toThrow();
  });
});
