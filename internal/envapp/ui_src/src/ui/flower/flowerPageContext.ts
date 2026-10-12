import type { FlowerPageContextSnapshot } from '../../../../../flower_ui/src';

export type FlowerPageContextState = Readonly<Record<string, unknown>>;
export type FlowerPageContextRegistrar = (read: () => FlowerPageContextState | undefined) => void;

/** Readers expose current page facts without mirroring state or requesting data. */
export function createFlowerPageContextRegistry() {
  const readers = new Map<string, () => FlowerPageContextState | undefined>();
  return {
    register(pageID: string, read: () => FlowerPageContextState | undefined): () => void {
      readers.set(pageID, read);
      return () => { if (readers.get(pageID) === read) readers.delete(pageID); };
    },
    read: (pageID: string) => readers.get(pageID)?.(),
  };
}

export function flowerPageContextSnapshot(input: {
  environmentID: string;
  environmentName: string;
  pageID: string;
  pageName: string;
  state?: FlowerPageContextState;
  capturedAtMs: number;
}): FlowerPageContextSnapshot {
  const content = JSON.stringify({
    environment: { id: input.environmentID, name: input.environmentName },
    page: { id: input.pageID, name: input.pageName },
    captured_at: new Date(input.capturedAtMs).toISOString(),
    ...(input.state ? { state: input.state } : {}),
  }, null, 2);
  // Page identity remains first. Bound automatically captured metadata before it
  // enters the draft, so preview, submission and retries always show the same text.
  const runes = Array.from(content);
  return {
    label: input.pageName,
    title: input.pageName,
    content: runes.length > 6000 ? `${runes.slice(0, 5999).join('')}…` : content,
  };
}
