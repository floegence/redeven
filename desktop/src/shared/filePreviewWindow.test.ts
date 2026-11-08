import { describe, expect, it } from 'vitest';
import { filePreviewWindowURL, parseFilePreviewWindowRequest, readFilePreviewWindowRequest } from './filePreviewWindow';

describe('file preview window identity', () => {
  it('roundtrips exact Unicode and URL-special characters without carrying credentials or shell state', () => {
    const request = { path: '/workspace/文档 #?% &+.html' };
    const url = new URL(filePreviewWindowURL('https://env.example/_redeven_proxy/env/?entry_ticket=secret&surface=terminal#secret', request));
    expect(url.pathname).toBe('/_redeven_proxy/env/');
    expect([...url.searchParams.keys()]).toEqual(['window', 'path']);
    expect(url.hash).toBe('');
    expect(readFilePreviewWindowRequest(url.search)).toEqual(request);
  });
  it.each([null, [], {}, { path: '/' }, { path: 'relative.html' }, { path: '/a/../b' }, { path: '/a/./b' }, { path: '//host/a' }, { path: '/a\u0000b' }, { path: '/a\\b' }, { path: '/a', url: 'https://evil.example' }, { path: '/' + 'x'.repeat(4096) }])('rejects malformed identity %j', value => {
    expect(parseFilePreviewWindowRequest(value)).toBeNull();
  });
  it.each(['?path=/a', '?window=file-preview', '?window=file-preview&path=/a&path=/b', '?window=file-preview&window=other&path=/a'])('rejects ambiguous routes %s', search => {
    expect(readFilePreviewWindowRequest(search)).toBeNull();
  });
});
