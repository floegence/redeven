/// <reference lib="webworker" />

// Markdown worker — parses markdown into HTML using marked.
//
// Runs off the main thread to keep streaming chat rendering smooth.

import { Marked } from 'marked';

import { createMarkdownRenderer } from '../markdown/markedConfig';
import type { MarkdownRendererVariant } from '../markdown/markdownRendererOptions';
import { buildMarkdownRenderSnapshot } from '../markdown/streamingMarkdownModel';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from '../types';

const ctx: DedicatedWorkerGlobalScope = self as any;

const markedInstances = new Map<MarkdownRendererVariant, Marked>();

function getMarked(variant: MarkdownRendererVariant): Marked {
  const cached = markedInstances.get(variant);
  if (cached) return cached;

  const instance = new Marked();
  instance.use({ renderer: createMarkdownRenderer({ variant }) });
  markedInstances.set(variant, instance);
  return instance;
}

ctx.addEventListener('message', (ev: MessageEvent<MarkdownWorkerRequest>) => {
  const data = ev.data as any;
  const id = String(data?.id ?? '').trim();
  if (!id) return;

  const content = String(data?.content ?? '');
  const streaming = data?.streaming === true;
  const rendererVariant: MarkdownRendererVariant = data?.rendererVariant === 'codex' ? 'codex' : 'default';

  try {
    const snapshot = buildMarkdownRenderSnapshot(getMarked(rendererVariant), content, streaming);
    const res: MarkdownWorkerResponse = { id, snapshot };
    ctx.postMessage(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const res: MarkdownWorkerResponse = {
      id,
      error: msg || 'Markdown parse error.',
    };
    ctx.postMessage(res);
  }
});
