import type { FlowerMessageTextSource } from './contracts/flowerSurfaceContracts';

// The message owns complete text. This bounded append log only saves repeated
// full-source reads for mounted Markdown consumers; cursors are absolute.
export function createMessageTextSource(revision: () => number, publish: (value: number) => unknown) {
  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  const source: FlowerMessageTextSource = {
    get start() { return start; },
    get length() { return start + chunks.length; },
    get revision() { return revision(); },
    read(from) { return chunks.slice(Math.max(0, from - start)); },
  };
  return { source, append(text: string) {
    if (!text) return;
    chunks.push(text); bytes += text.length * 2;
    while (chunks.length > 256 || bytes > (256 << 10)) {
      bytes -= chunks.shift()!.length * 2; start++;
    }
    publish(source.length);
  } };
}
