import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopShellOpenWebServiceWindowRequest,
  normalizeDesktopShellOpenWebServiceWindowResponse,
} from './desktopShellWebServiceWindowIPC';

describe('desktopShellWebServiceWindowIPC', () => {
  it('normalizes an isolated Web Service window request', () => {
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({
      url: 'http://127.0.0.1:43123/pf/demo/docs?q=1',
      forward_id: 'demo',
      target_url: 'http://localhost:3000',
    })).toEqual({
      url: 'http://127.0.0.1:43123/pf/demo/docs?q=1',
      forward_id: 'demo',
      target_url: 'http://localhost:3000/',
    });
  });

  it('rejects unsupported URLs and invalid forward ids', () => {
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({ url: 'file:///tmp/a', forward_id: 'demo' })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({ url: 'https://example.com', forward_id: '../demo' })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({ url: 'https://user:secret@example.com', forward_id: 'demo' })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({ url: 'https://example.com', forward_id: 'a'.repeat(49) })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({
      url: 'https://example.com',
      forward_id: 'demo',
      target_url: 'file:///tmp/a',
    })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({
      url: 'https://example.com',
      forward_id: 'demo',
      target_url: 'https://example.com:3000',
    })).toBeNull();
    expect(normalizeDesktopShellOpenWebServiceWindowRequest({
      url: 'https://example.com',
      forward_id: 'demo',
      target_url: 'http://localhost:3000/admin',
    })).toBeNull();
  });

  it('normalizes missing responses as a closed failure', () => {
    expect(normalizeDesktopShellOpenWebServiceWindowResponse(null)).toEqual({
      ok: false,
      message: 'Desktop failed to open the Web Service window.',
    });
  });
});
