import { createHash } from 'node:crypto';
import {
  createNativeCodeSpaceGateway,
  type NativeCodeSpaceGateway,
  type NativeCodeSpaceRoute,
} from './codespaceNativeGateway';
import type { NativeCodeSpaceProfiles } from './codespaceNativeProfiles';

type BrowserEntry = {
  lifetime: AbortController;
  gateway?: NativeCodeSpaceGateway;
  opening?: Promise<void>;
};

/** Browser tabs outlive editor windows, but never their owning environment session. */
export class CodeSpaceBrowserSessions {
  private readonly entries = new Map<string, BrowserEntry>();
  private closed = false;

  async open(
    id: string,
    options: {
      identity: string;
      profiles: NativeCodeSpaceProfiles;
      createRoute: (signal: AbortSignal) => Promise<NativeCodeSpaceRoute>;
      openExternal: (url: string) => Promise<void>;
    },
  ): Promise<void> {
    if (this.closed) throw new Error('codespace_closed');
    const previous = this.entries.get(id);
    if (previous?.opening) return previous.opening;
    // An explicit reopen reacquires the current editor generation, including after restart.
    const entry: BrowserEntry = { lifetime: new AbortController() };
    this.entries.set(id, entry);
    entry.opening = (async () => {
      previous?.lifetime.abort();
      await previous?.gateway?.close();
      const identity = createHash('sha256')
        .update('browser:' + options.identity)
        .digest('hex');
      const port = options.profiles.port(identity);
      const signal = entry.lifetime.signal;
      if (signal.aborted) throw new Error('codespace_closed');
      const route = await options.createRoute(signal);
      if (signal.aborted) {
        await route.close();
        throw new Error('codespace_closed');
      }
      const gateway = await createNativeCodeSpaceGateway(
        route,
        port,
        `cs-${identity.slice(0, 40)}.localhost`,
      );
      entry.gateway = gateway;
      if (signal.aborted) throw new Error('codespace_closed');
      options.profiles.remember(identity, gateway.port);
      await options.openExternal(gateway.mintBrowserEntry());
    })();
    try {
      await entry.opening;
    } catch (error) {
      entry.lifetime.abort();
      await entry.gateway?.close();
      if (this.entries.get(id) === entry) this.entries.delete(id);
      throw error;
    } finally {
      entry.opening = undefined;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) entry.lifetime.abort();
    await Promise.all(
      entries.map(async (entry) => {
        await entry.gateway?.close();
        await entry.opening?.catch(() => undefined);
      }),
    );
  }
}
