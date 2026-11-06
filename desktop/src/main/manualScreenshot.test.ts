import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { captureAuthorizedPage } from './manualScreenshot';
function source() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getURL: () => 'https://source.test/', executeJavaScript: vi.fn(async () => false),
    capturePage: vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from([1, 2, 3]) })),
  });
}
describe('authorized native screenshot', () => {
  it('captures only the supplied source and removes the navigation listener', async () => {
    const owner = source(); const region = { x: 1, y: 2, width: 300, height: 200 };
    await expect(captureAuthorizedPage(owner as unknown as WebContents, { url: owner.getURL(), region, valid: () => true })).resolves.toEqual({ png: new Uint8Array([1, 2, 3]) });
    expect(owner.capturePage).toHaveBeenCalledWith(region, { stayHidden: true });
    expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });
  it('rejects lost ownership and visible private inputs without capture', async () => {
    const owner = source();
    await expect(captureAuthorizedPage(owner as unknown as WebContents, { url: owner.getURL(), valid: () => false })).rejects.toThrow();
    owner.executeJavaScript.mockResolvedValue(true);
    await expect(captureAuthorizedPage(owner as unknown as WebContents, { url: owner.getURL(), valid: () => true })).rejects.toThrow('private');
    expect(owner.capturePage).not.toHaveBeenCalled(); expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });
  it('discards an image when the shell loses ownership during capture', async () => {
    const owner = source(); let authorized = true;
    owner.capturePage.mockImplementation(async () => {
      authorized = false; return { isEmpty: () => false, toPNG: () => Buffer.from([1]) };
    });
    await expect(captureAuthorizedPage(owner as unknown as WebContents, { url: owner.getURL(), valid: () => authorized })).rejects.toThrow('changed');
    expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });
  it('rejects navigation even when it returns to the original URL', async () => {
    const owner = source(); owner.capturePage.mockImplementation(async () => {
      owner.emit('did-start-navigation'); return { isEmpty: () => false, toPNG: () => Buffer.from([1]) };
    });
    await expect(captureAuthorizedPage(owner as unknown as WebContents, { url: owner.getURL(), valid: () => true })).rejects.toThrow('changed');
    expect(owner.listenerCount('did-start-navigation')).toBe(0);
  });
});
