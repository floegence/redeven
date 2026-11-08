import { describe, expect, it, vi } from 'vitest';
import { askFilePreviewFlower, openFilePreviewWindow, type FilePreviewWindowOwner } from './filePreviewWindow';
const owner = (): FilePreviewWindowOwner => ({ mainFrame: true, allowed: true, sourceURL: 'https://env.example/_redeven_proxy/env/', entryURL: 'https://env.example/_redeven_proxy/env/?ticket=secret', open: vi.fn(() => true) });
describe('authorized file preview windows', () => {
  it('opens only within the sender session with a file-specific reuse identity', () => {
    const source = owner();
    expect(openFilePreviewWindow({ path: '/tmp/a.html' }, source)).toEqual({ ok: true });
    expect(source.open).toHaveBeenCalledWith('https://env.example/_redeven_proxy/env/?window=file-preview&path=%2Ftmp%2Fa.html', 'file-preview:/tmp/a.html');
  });
  it.each([{ mainFrame: false }, { allowed: false }, { sourceURL: 'https://other.example/_redeven_proxy/env/' }, { sourceURL: 'https://env.example/untrusted' }, { sourceURL: 'invalid' }])('rejects unauthorized senders %j', override => {
    const source = { ...owner(), ...override }; expect(openFilePreviewWindow({ path: '/tmp/a' }, source)).toEqual({ ok: false }); expect(source.open).not.toHaveBeenCalled();
  });
  it('reports closed sessions, invalid inputs, and failed window creation', () => {
    expect(openFilePreviewWindow({ path: '/tmp/a' }, null)).toEqual({ ok: false });
    const source = owner(); expect(openFilePreviewWindow({ path: '/tmp/a', url: 'https://other' }, source)).toEqual({ ok: false }); expect(source.open).not.toHaveBeenCalled();
    expect(openFilePreviewWindow({ path: '/tmp/a' }, { ...source, open: () => false })).toEqual({ ok: false });
    expect(openFilePreviewWindow({ path: '/tmp/a' }, { ...source, open: () => { throw new Error('creation failed'); } })).toEqual({ ok: false });
  });
});

describe('preview Flower handoff authority', () => {
  const previewOwner = () => ({ ...owner(), sourceURL: 'https://env.example/_redeven_proxy/env/?window=file-preview&path=%2Ftmp%2Fa.html' });
  it('hands only the displayed file to its existing session owner', () => {
    const source = previewOwner();
    expect(askFilePreviewFlower({ path: '/tmp/a.html' }, source)).toEqual({ ok: true });
    expect(source.open).toHaveBeenCalledWith(source.sourceURL, '/tmp/a.html');
  });
  it.each([{ mainFrame: false }, { allowed: false }, { sourceURL: 'https://other.example/_redeven_proxy/env/?window=file-preview&path=%2Ftmp%2Fa.html' },
    { sourceURL: 'https://env.example/_redeven_proxy/env/' }, { sourceURL: 'https://env.example/_redeven_proxy/env/?window=file-preview&path=/tmp/a.html&path=/other' }])('rejects an unauthorized handoff %j', override => {
    const source = { ...previewOwner(), ...override };
    expect(askFilePreviewFlower({ path: '/tmp/a.html' }, source)).toEqual({ ok: false }); expect(source.open).not.toHaveBeenCalled();
  });
  it('rejects other paths, extra fields, and retired receivers', () => {
    const source = previewOwner();
    expect(askFilePreviewFlower({ path: '/tmp/other' }, source)).toEqual({ ok: false });
    expect(askFilePreviewFlower({ path: '/tmp/a.html', url: 'https://other' }, source)).toEqual({ ok: false });
    expect(askFilePreviewFlower({ path: '/tmp/a.html' }, null)).toEqual({ ok: false });
    expect(source.open).not.toHaveBeenCalled();
  });
});
