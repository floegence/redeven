// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { bindSessionHTTP, envDirectoryFavorites } from '../services/sessionHTTP';
import { useGitDirectoryFavorites } from './gitDirectoryFavorites';

describe('captured Git directory favorite actions', () => {
  it('keeps an open menu on its original client and captures a new client on reopen', async () => {
    const response = () => new Response(JSON.stringify({ok:true,data:{paths:[],revision:0}}));
    const first = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
    const second = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
    const releaseFirst = bindSessionHTTP({fetch:first,events:async function*(){}});
    let dispose!: () => void;
    const menu = createRoot(cleanup => {dispose=cleanup;return useGitDirectoryFavorites();});
    const target = {path:'/captured'};
    const captured = menu.item(target.path,target)!;
    const releaseSecond = bindSessionHTTP({fetch:second,events:async function*(){}});
    try {
      const retained = menu.item(target.path,target)!;
      expect(retained.disabled).toBe(true);
      retained.onSelect?.();
      expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();
      const reopened = menu.item('/new-target',{path:'/new-target'})!;
      expect(reopened.disabled).toBe(false);
      reopened.onSelect?.();
      await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
      expect(JSON.parse(String(second.mock.calls[0]?.[1]?.body))).toEqual({path:'/new-target'});
      expect(captured.label).toBe('Add directory to favorites');
      await vi.waitFor(() => expect(envDirectoryFavorites(() => 'Failed')?.pendingPaths).toEqual([]));
    } finally {dispose();releaseFirst();releaseSecond();}
  });
});
