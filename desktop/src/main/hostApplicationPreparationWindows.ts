import { randomUUID } from 'node:crypto';

type Reservation<T> = { id: string; owner: string; application: string; window: T };

// Preparation windows belong to the initiating Env App document, not merely its host.
export class HostApplicationPreparationWindows<T> {
  private readonly entries = new Map<string, Reservation<T>>();
  constructor(private readonly alive: (window: T) => boolean, private readonly close: (window: T) => void) {}

  reserve(owner: string, application: string, create: () => T): Reservation<T> {
    for (const entry of this.entries.values()) {
      if (entry.owner === owner && entry.application === application && this.alive(entry.window)) return entry;
    }
    const entry = { id: randomUUID(), owner, application, window: create() };
    this.entries.set(entry.id, entry);
    return entry;
  }

  get(owner: string, id: string): T | null {
    const entry = this.entries.get(id);
    return entry?.owner === owner && this.alive(entry.window) ? entry.window : null;
  }

  claim(owner: string, id: string): T | null {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner) return null;
    this.entries.delete(id);
    const window = this.alive(entry.window) ? entry.window : null;
    return window;
  }

  discard(owner: string, id: string): void {
    const window = this.claim(owner, id);
    if (window) this.close(window);
  }

  releaseOwner(owner: string): void {
    for (const entry of this.entries.values()) {
      if (entry.owner === owner) this.discard(owner, entry.id);
    }
  }
}
