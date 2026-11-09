// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPUTER_FRAME_RATE_KEY, COMPUTER_FRAME_RATES } from '../../../../../flower_ui/src/computerViewer';
import { envComputerViewerFrameRate } from './computerViewerPreferences';

const cleanup: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); localStorage.clear(); });

describe('Env computer viewer preference', () => {
  it('reads existing preferences and opening an observer never writes storage', () => {
    localStorage.setItem(COMPUTER_FRAME_RATE_KEY, '15');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const listener = vi.fn(); cleanup.push(envComputerViewerFrameRate.subscribe(listener));
    expect(envComputerViewerFrameRate.read()).toBe(15);
    expect(setItem).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled(); setItem.mockRestore();
  });
  it.each(COMPUTER_FRAME_RATES)('shares supported %i FPS changes through the existing key', fps => {
    const listener = vi.fn(); cleanup.push(envComputerViewerFrameRate.subscribe(listener));
    envComputerViewerFrameRate.write(fps);
    expect(envComputerViewerFrameRate.read()).toBe(fps);
    expect(localStorage.getItem(COMPUTER_FRAME_RATE_KEY)).toBe(String(fps));
    if (fps !== 3) expect(listener).toHaveBeenCalledExactlyOnceWith(fps);
    else expect(listener).not.toHaveBeenCalled();
    envComputerViewerFrameRate.write(fps); expect(listener.mock.calls.length).toBe(fps === 3 ? 0 : 1);
    expect(Object.keys(localStorage)).toEqual([COMPUTER_FRAME_RATE_KEY]);
  });
  it('observes changes from another renderer without leaking listeners after disposal', () => {
    const listener = vi.fn(); const stop = envComputerViewerFrameRate.subscribe(listener);
    localStorage.setItem(COMPUTER_FRAME_RATE_KEY, '30');
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })); expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: COMPUTER_FRAME_RATE_KEY })); expect(listener).toHaveBeenLastCalledWith(30);
    localStorage.setItem(COMPUTER_FRAME_RATE_KEY, '10'); window.dispatchEvent(new Event('focus')); expect(listener).toHaveBeenLastCalledWith(10);
    stop(); listener.mockClear(); envComputerViewerFrameRate.write(5); window.dispatchEvent(new Event('focus')); expect(listener).not.toHaveBeenCalled();
  });
  it('uses the existing supported-rate default for invalid persisted data', () => {
    localStorage.setItem(COMPUTER_FRAME_RATE_KEY, 'unexpected'); expect(envComputerViewerFrameRate.read()).toBe(3);
    envComputerViewerFrameRate.write(120); expect(envComputerViewerFrameRate.read()).toBe(3);
  });
});
