// Keep ordinary refresh below the per-device Gateway budget, leaving capacity
// for pairing and opening. A slow source occupies only its own worker.
export function createCatalogLoader<T>(
  read: (id: string, signal: AbortSignal) => Promise<T>,
  accept: (id: string, value: T) => void,
  reject: (id: string, error: unknown) => void,
) {
  let active: AbortController | undefined;
  const cancel = () => { active?.abort(); active = undefined; };
  return { cancel, async load(ids: readonly string[]) {
    cancel();
    const owner = new AbortController();
    active = owner;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (!owner.signal.aborted && cursor < ids.length) {
        const id = ids[cursor++];
        try { const value = await read(id, owner.signal); if (!owner.signal.aborted) accept(id, value); }
        catch (error) { if (!owner.signal.aborted) reject(id, error); }
      }
    }));
    if (active === owner) active = undefined;
  } };
}
