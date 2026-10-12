import type { FlowerPageContextSnapshot } from '../../../../../flower_ui/src';

export type FlowerPageContextState = Readonly<Record<string, unknown>>;
export type FlowerPageContextRegistrar = (read: () => FlowerPageContextState | undefined) => void;
const MAX_PAGE_CONTEXT_CHARS = 6000;

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
  const serialize = (state: FlowerPageContextState | undefined) => JSON.stringify({
    environment: { id: input.environmentID, name: input.environmentName },
    page: { id: input.pageID, name: input.pageName },
    captured_at: new Date(input.capturedAtMs).toISOString(),
    ...(state ? { state } : {}),
  }, null, 2);
  let content = serialize(input.state);
  if (input.pageID === 'terminal' && typeof input.state?.screen_text === 'string'
    && Array.from(content).length > MAX_PAGE_CONTEXT_CHARS) {
    // Trim the screen's prefix before serialization so identity and the latest
    // visible lines survive JSON escaping within the automatic reference budget.
    const screen = Array.from(input.state.screen_text);
    const serializeTail = (omitted: number) => serialize({
      ...input.state, screen_text: `...${screen.slice(omitted).join('')}`,
    });
    let low = 0;
    let high = screen.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Array.from(serializeTail(middle)).length > MAX_PAGE_CONTEXT_CHARS) low = middle + 1;
      else high = middle;
    }
    content = serializeTail(low);
  }
  // Page identity remains first. Bound automatically captured metadata before it
  // enters the draft, so preview, submission and retries always show the same text.
  const runes = Array.from(content);
  return {
    label: input.pageName,
    title: input.pageName,
    content: runes.length > MAX_PAGE_CONTEXT_CHARS ? `${runes.slice(0, MAX_PAGE_CONTEXT_CHARS - 1).join('')}…` : content,
  };
}
