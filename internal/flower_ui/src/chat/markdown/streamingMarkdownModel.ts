import type { Marked } from 'marked';
import { createIncrementalMarkdownParser, type MarkdownUpdate } from '@floegence/floe-webapp-core/markdown';
import type { FlowerMessageTextSource } from '../../contracts/flowerSurfaceContracts';

/** One parser, one append cursor. Full source reads are explicit boundaries. */
export function createMarkdownRenderModel(markdown: Marked<string, string>, apply: (update: MarkdownUpdate, streaming: boolean, reset?: boolean) => void,
  source: { reset(): void; append(delta: string): void }) {
  const parser = createIncrementalMarkdownParser(markdown);
  let initialized = false; let previous = ''; let cursor = 0;
  let owner: FlowerMessageTextSource | undefined;
  let renderingKey = ''; let wasStreaming = false;
  return {
    update(content: () => string, streaming: boolean, textSource?: FlowerMessageTextSource, key = '') {
      // Reading revision tracks only this message. The append source itself
      // avoids flattening or comparing the complete growing JavaScript rope.
      void textSource?.revision;
      if (!initialized || owner !== textSource || key !== renderingKey || !textSource) {
        const value = content();
        if (!initialized || owner !== textSource || key !== renderingKey || value !== previous) {
          if (initialized && owner === textSource && key === renderingKey && value.startsWith(previous)) {
            const delta = value.slice(previous.length); source.append(delta); apply(parser.append(delta), streaming);
          } else {
            const reset = initialized && value !== previous;
            // A changed source needs a complete baseline: reset can otherwise
            // omit unchanged tokens whose source offsets and IDs have moved.
            if (reset) parser.reset('');
            source.reset(); source.append(value);
            apply(parser.reset(value), streaming, reset);
          }
          previous = value;
        }
        cursor = textSource?.length ?? 0;
      } else {
        for (const delta of textSource.read(cursor)) {
          source.append(delta); apply(parser.append(delta), streaming);
          previous += delta;
        }
        cursor = textSource.length;
      }
      if (!streaming && (!initialized || wasStreaming)) apply(parser.finish(), false);
      initialized = true; owner = textSource; renderingKey = key; wasStreaming = streaming;
    },
    diagnostics: parser.diagnostics,
  };
}
