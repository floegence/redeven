// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectTemplateSource } from './templateSourceAcquisition';
import { LocalApiError } from '../services/localApi';

const api = vi.hoisted(() => ({request: vi.fn()}));
vi.mock('../services/localApi', async original => ({...await original<typeof import('../services/localApi')>(), fetchLocalApiJSON: api.request}));
const source = {repository: 'owner/templates', repository_id: 123, ref: 'main', path: 'templates/app', commit_sha: 'a'.repeat(40)};
const snapshot = {source, files: [{path: 'redeven-service-template.json', mode: '100644' as const, content: 'e30K'}], sha256: 'b'.repeat(64)};
const expected = {repository_id: source.repository_id, commit_sha: source.commit_sha, sha256: snapshot.sha256};

afterEach(() => { delete window.redevenDesktopTemplateSources; api.request.mockReset(); });

describe('shared template source acquisition', () => {
  it('transfers pinned originals once while keeping Desktop credentials out of Runtime', async () => {
    const acquire = vi.fn().mockResolvedValue({ok: true, snapshot});
    window.redevenDesktopTemplateSources = {acquire, cancel: vi.fn().mockResolvedValue(undefined)};
    api.request.mockResolvedValue({candidate_id: 'review'});
    const controller = new AbortController();
    const result = await inspectTemplateSource({source, expected, mode: 'desktop_transfer', token: 'private-token'}, controller.signal);
    expect(result.candidate_id).toBe('review');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0][0]).toMatchObject({action: 'capture', source, expected, token: 'private-token'});
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.request.mock.calls[0][1].body)).toEqual({source, expected, snapshot});
    expect(api.request.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('cancels only its Desktop operation and rejects a late acquired snapshot', async () => {
    let resolve!: (value: unknown) => void;
    const acquire = vi.fn().mockReturnValue(new Promise(value => {resolve = value;}));
    const cancel = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopTemplateSources = {acquire, cancel};
    const controller = new AbortController();
    const promise = inspectTemplateSource({source, expected, mode: 'desktop_transfer'}, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({name: 'AbortError'});
    controller.abort(); resolve({ok: true, snapshot});
    await rejection;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(acquire.mock.calls[0][0].operation_id);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('does not fall back or mutate a source when Desktop acquisition fails', async () => {
    window.redevenDesktopTemplateSources = {acquire: vi.fn().mockResolvedValue({ok: false, error_code: 'TEMPLATE_SOURCE_RATE_LIMITED'}), cancel: vi.fn().mockResolvedValue(undefined)};
    await expect(inspectTemplateSource({source, expected, mode: 'desktop_transfer'}, new AbortController().signal)).rejects.toMatchObject({code: 'TEMPLATE_SOURCE_RATE_LIMITED'});
    expect(api.request).not.toHaveBeenCalled();
  });

  it('rejects missing snapshots without sending an unintended remote request', async () => {
    window.redevenDesktopTemplateSources = {acquire: vi.fn().mockResolvedValue({ok: true}), cancel: vi.fn().mockResolvedValue(undefined)};
    await expect(inspectTemplateSource({source, mode: 'desktop_transfer'}, new AbortController().signal)).rejects.toBeInstanceOf(LocalApiError);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('does not redirect Desktop credentials when its bridge disappears', async () => {
    await expect(inspectTemplateSource({source, mode: 'desktop_transfer', token: 'desktop-only'}, new AbortController().signal)).rejects.toMatchObject({code: 'TEMPLATE_SOURCE_UNAVAILABLE'});
    expect(api.request).not.toHaveBeenCalled();
  });

  it('uses explicit remote mode and preserves the selected source and temporary credential', async () => {
    const acquire = vi.fn();
    window.redevenDesktopTemplateSources = {acquire, cancel: vi.fn()};
    api.request.mockResolvedValue({candidate_id: 'remote-review'});
    await inspectTemplateSource({source, expected, mode: 'remote_download', token: 'remote-token'}, new AbortController().signal);
    expect(acquire).not.toHaveBeenCalled();
    expect(JSON.parse(api.request.mock.calls[0][1].body)).toEqual({source, expected, token: 'remote-token'});
  });
});
