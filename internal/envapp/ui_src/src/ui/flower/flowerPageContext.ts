import type { FlowerPageContextSnapshot } from '../../../../../flower_ui/src';

export type FlowerPageContextState = Readonly<Record<string, unknown>>;
export type FlowerPageContextRegistrar = (read: () => FlowerPageContextState | undefined) => void;
const MAX_PAGE_CONTEXT_CHARS = 6000;

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
  if (typeof input.state?.screen_text === 'string'
    && Array.from(content).length > MAX_PAGE_CONTEXT_CHARS) {
    // Trim the screen's prefix before serialization so identity and the latest
    // visible lines survive JSON escaping within the automatic reference budget.
    const screen = Array.from(input.state.screen_text);
    const serializeTail = (omitted: number) => serialize({
      ...input.state, truncated: true, screen_text: `...${screen.slice(omitted).join('')}`,
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
  if (runes.length > MAX_PAGE_CONTEXT_CHARS) {
    // Bound fields before serialization, retaining the most useful identities.
    const state: Record<string, unknown> = { truncated: true };
    for (const [key, value] of Object.entries(input.state ?? {})) {
      if (Array.from(serialize({ ...state, [key]: value })).length <= MAX_PAGE_CONTEXT_CHARS) { state[key] = value; continue; }
      if (typeof value !== 'string') continue;
      const chars = Array.from(value); let low = 0; let high = chars.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Array.from(serialize({ ...state, [key]: chars.slice(0, middle).join('') + '…' })).length <= MAX_PAGE_CONTEXT_CHARS) low = middle;
        else high = middle - 1;
      }
      if (low) state[key] = chars.slice(0, low).join('') + '…';
    }
    content = serialize(state);
  }
  return {
    label: input.pageName,
    title: input.pageName,
    content,
  };
}
