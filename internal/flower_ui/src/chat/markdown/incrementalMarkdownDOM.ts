import type { Marked, Token, Tokens, TokensList } from 'marked';
import type { MarkdownUpdate, MarkdownBlockChange } from '@floegence/floe-webapp-core/markdown';

type Region = { start: number; length: number; element: HTMLDivElement; code?: { append(text: string): void }; inline?: HTMLSpanElement[]; lengths?: number[]; offsets?: number[]; token: Token; live: boolean; specializedCode?: boolean };
export type MarkdownDecoration = { dispose(): void; finish?(): void; update?(token: Token, live: boolean): boolean };

// Mutating one huge Text forces Chromium to reshape the complete line. Stable
// inline boxes keep shaping local while preserving native selection and copy.
function createBoundedText(element: Element, initial: string, code: boolean) {
  const limit = 2048;
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let tail: Text | undefined;
  let pendingSpace: Text | undefined;
  let plain = initial.length <= 32768 ? document.createTextNode(initial) : undefined;
  const append = (text: string) => {
    if (plain && plain.length + text.length <= 32768) { plain.appendData(text); return; }
    plain = undefined;
    const nodes = document.createDocumentFragment();
    let offset = 0;
    while (offset < text.length) {
      // Whitespace belongs to the surrounding inline formatting context. A
      // trailing space inside an atomic box collapses away, and a tab inside
      // a box starts a new tab grid instead of using the code line's grid.
      const window = text.slice(offset, offset + limit + 64);
      const whitespace = code ? /^[\t\n\r]+/.exec(window) : /^\s+/.exec(window);
      if (whitespace) {
        const value = whitespace[0];
        const collapsible = !code && !/[\n\r]/.test(value);
        if (collapsible && pendingSpace) pendingSpace.appendData(value);
        else {
          const space = document.createTextNode(value); nodes.append(space);
          pendingSpace = collapsible ? space : undefined;
        }
        if (!collapsible) tail = undefined;
        offset += value.length; continue;
      }
      if (pendingSpace) {
        if (tail && tail.length + pendingSpace.length < limit) {
          // Internal whitespace participates in its box's shaping. Trailing
          // spaces remain outside it until more text arrives.
          tail.appendData(pendingSpace.data); pendingSpace.remove();
        } else tail = undefined;
        pendingSpace = undefined;
      }
      if (tail && tail.length >= limit) {
        const prefix = tail.data.slice(-64);
        for (const segment of graphemes.segment(prefix + window)) {
          const next = segment.index + segment.segment.length;
          if (segment.index < prefix.length && next > prefix.length) {
            const continuation = next - prefix.length;
            tail.appendData(text.slice(offset, offset + continuation));
            offset += continuation;
            break;
          }
        }
        tail = undefined;
        if (offset >= text.length) break;
        continue;
      }
      if (!tail || tail.length >= limit) {
        const span = document.createElement('span');
        span.className = code ? 'flower-chat-md-code-chunk' : 'flower-chat-md-text-chunk';
        tail = document.createTextNode(''); span.append(tail); nodes.append(span);
      }
      const delimiter = (code ? /[\t\n\r]/ : /[\n\r]/).exec(window)?.index ?? window.length;
      let end = Math.min(text.length, offset + limit - tail.length, offset + delimiter);
      if (!code) {
        const piece = text.slice(offset, end);
        const trailing = /\s+$/.exec(piece);
        if (trailing) end -= trailing[0].length;
        else if (end < text.length && end < offset + delimiter) {
          const boundary = piece.lastIndexOf(' ');
          if (boundary > 0) end = offset + boundary;
        }
      }
      // Find the last complete grapheme only near a shaping-box boundary; the
      // ordinary append path never segments the existing accumulated text.
      if (end < offset + delimiter && end > offset) {
        let boundary = offset;
        for (const segment of graphemes.segment(text.slice(offset, Math.min(text.length, end + 64)))) {
          const next = offset + segment.index + segment.segment.length;
          if (next > end) break;
          boundary = next;
        }
        // A single extended grapheme is indivisible, even if it exceeds the
        // usual box size. Retain it rather than dropping text or looping.
        if (boundary === offset && tail.length > 0) { tail = undefined; continue; }
        end = boundary > offset ? boundary : offset + graphemes.segment(window)[Symbol.iterator]().next().value!.segment.length;
      }
      if (end === offset) { tail = undefined; continue; }
      tail.appendData(text.slice(offset, end)); offset = end;
    }
    element.append(nodes);
  };
  element.replaceChildren();
  if (plain) element.append(plain);
  else append(initial);
  return { append };
}

/** The public parser owns syntax; this adapter owns only changed DOM regions. */
export function createIncrementalMarkdownDOM(markdown: Marked<string, string>, root: HTMLElement,
  decorate: (element: HTMLElement, token: Token, live: boolean) => MarkdownDecoration,
  locate: (tokens: readonly Token[], start: number, raw: string) => void = () => {},
  container: (token: Token) => HTMLElement = () => root,
  forget: (start: number, length: number) => void = () => {}) {
  const regions = new Map<number, Region>();
  const cleanups = new Map<number, MarkdownDecoration>();
  const inlineCleanups = new Map<HTMLElement, MarkdownDecoration>();
  const textRuns = new WeakMap<HTMLElement, { append(text: string): void }>();
  let links: TokensList['links'] = {};
  const render = (token: Token) => {
    const list = [token] as TokensList; list.links = links;
    return String(markdown.parser(list));
  };
  const inline = (tokens: readonly Token[]) => tokens.map(token => {
    const span = document.createElement('span');
    span.innerHTML = String(markdown.Parser.parseInline([token], { ...markdown.defaults }));
    if (token.type === 'text' && span.children.length === 0 && span.firstChild instanceof Text) {
      textRuns.set(span, createBoundedText(span, span.textContent ?? '', false));
    }
    return span;
  });
  const releaseInline = (node: HTMLElement) => { inlineCleanups.get(node)?.dispose(); inlineCleanups.delete(node); };
  const release = (id: number) => {
    const region = regions.get(id);
    for (const node of region?.inline ?? []) releaseInline(node);
    cleanups.get(id)?.dispose(); cleanups.delete(id);
  };
  const replace = (change: Extract<MarkdownBlockChange, { kind: 'replace' }>, live: boolean, redecorate = false) => {
    const { id, start, token } = change.block;
    const prior = regions.get(id);
    if (prior) forget(prior.start, prior.length);
    if (prior && !redecorate && cleanups.get(id)?.update?.(token, live)) {
      locate([token], start, token.raw);
      Object.assign(prior, { start, length: token.raw.length, token, live });
      return;
    }
    release(id);
    const element = prior?.element ?? document.createElement('div');
    element.className = 'flower-chat-md-committed-segment';
    element.dataset.segmentKey = String(id);
    locate([token], start, token.raw);
    element.innerHTML = render(token);
    const region: Region = { start, length: token.raw.length, element, token, live, specializedCode: token.type === 'code' && !element.querySelector('pre.flower-chat-md-code-block > code') };
    if (token.type === 'paragraph') {
      const paragraph = element.firstElementChild;
      if (paragraph?.tagName === 'P') {
        region.inline = inline((token as Tokens.Paragraph).tokens);
        region.lengths = (token as Tokens.Paragraph).tokens.map(token => token.raw.length);
        let offset = 0; region.offsets = region.lengths.map(length => { const start = offset; offset += length; return start; });
        paragraph.replaceChildren(...region.inline);
      }
    }
    if (token.type === 'code') {
      const code = element.querySelector('pre.flower-chat-md-code-block > code');
      if (code) region.code = createBoundedText(code, (token as Tokens.Code).text, true);
    }
    const parent = container(token);
    if (!prior || element.parentElement !== parent) {
      const after = [...regions.values()].find(value => value.start > start && value.element.parentElement === parent);
      parent.insertBefore(element, after?.element ?? null);
    }
    regions.set(id, region);
    cleanups.set(id, decorate(element, token, live));
  };
  return {
    refresh(predicate: (token: Token, element: HTMLElement) => boolean, streaming: boolean) {
      for (const [id, region] of regions) {
        if (predicate(region.token, region.element)) replace({ kind: 'replace', block: { id, start: region.start, token: region.token } }, streaming, true);
      }
    },
    apply(update: MarkdownUpdate, streaming: boolean) {
      links = update.links;
      for (const change of update.changes) {
        if (change.kind === 'replace') replace(change, streaming);
        else if (change.kind === 'remove') {
          const prior = regions.get(change.id);
          if (prior) forget(prior.start, prior.length);
          release(change.id); prior?.element.remove(); regions.delete(change.id);
        } else {
          const region = regions.get(change.id);
          if (!region) throw new Error('Flower contract error: Markdown update requires a block.');
          if (change.kind === 'append_text') {
            region.length += change.text.length;
            const target = change.code ? region.code : region.inline?.[change.inlineIndex!];
            if (!target && change.code && region.specializedCode && region.token.type === 'code') {
              region.token.text += change.text;
              region.token.raw += change.text;
              if (cleanups.get(change.id)?.update?.(region.token, streaming)) continue;
              replace({ kind: 'replace', block: { id: change.id, start: region.start, token: region.token } }, streaming);
              continue;
            }
            if (!target) throw new Error('Flower contract error: Markdown append requires a text region.');
            if (change.code && region.token.type === 'code') { region.token.text += change.text; region.token.raw += change.text; }
            if (change.code) region.code!.append(change.text);
            else if (target instanceof HTMLElement && textRuns.has(target)) textRuns.get(target)!.append(change.text);
            else if (target instanceof HTMLElement && target.lastChild instanceof Text) target.lastChild.appendData(change.text);
            else if (target instanceof HTMLElement) target.appendChild(document.createTextNode(change.text));
            if (!change.code && region.lengths) region.lengths[change.inlineIndex!] += change.text.length;
          } else {
            const nodes = region.inline;
            if (!nodes || change.from < 0 || change.from + change.deleteCount > nodes.length) throw new Error('Flower contract error: Markdown inline range is invalid.');
            const at = region.offsets?.[change.from] ?? ((region.offsets?.at(-1) ?? 0) + (region.lengths?.at(-1) ?? 0));
            const start = region.start + at;
            const removedLength = region.lengths?.slice(change.from, change.from + change.deleteCount).reduce((sum, length) => sum + length, 0) ?? 0;
            forget(start, removedLength);
            const raw = change.tokens.map(token => token.raw).join('');
            region.length += raw.length - removedLength;
            locate(change.tokens, start, raw);
            region.lengths?.splice(change.from, change.deleteCount, ...change.tokens.map(token => token.raw.length));
            const offsets: number[] = []; let offset = at;
            for (const token of change.tokens) { offsets.push(offset); offset += token.raw.length; }
            region.offsets?.splice(change.from, change.deleteCount, ...offsets);
            if (region.offsets && region.lengths) for (let i = change.from + change.tokens.length; i < region.offsets.length; i++) region.offsets[i] = region.offsets[i - 1] + region.lengths[i - 1];
            const added = inline(change.tokens);
            const anchor = nodes[change.from + change.deleteCount] ?? null;
            const parent = nodes[0]?.parentNode ?? region.element.firstElementChild;
            if (!parent) throw new Error('Flower contract error: Markdown inline parent is missing.');
            for (const node of nodes.splice(change.from, change.deleteCount, ...added)) { releaseInline(node); node.remove(); }
            for (let i = 0; i < added.length; i++) {
              const node = added[i]; parent.insertBefore(node, anchor);
              inlineCleanups.set(node, decorate(node, change.tokens[i], streaming));
            }
          }
        }
      }
      if (!streaming) for (const [id, region] of regions) if (region.live) {
        region.live = false;
        cleanups.get(id)?.finish?.();
        for (const node of region.inline ?? []) inlineCleanups.get(node)?.finish?.();
      }
    },

    dispose() { for (const id of cleanups.keys()) release(id); for (const region of regions.values()) { forget(region.start, region.length); region.element.remove(); } regions.clear(); },
  };
}
