import { safeMarkdownMediaURL, type MarkdownMediaSource } from '@floegence/floe-webapp-core/chat-media';
import type { ResolvedMarkdownMedia } from '@floegence/floe-webapp-core/chat';
import type { FlowerMarkdownMediaCopy } from './mediaCopy';
import type { FlowerSurfaceAdapter } from '../../contracts/flowerSurfaceContracts';

export function flowerMarkdownFilePath(source: string, workingDirectory: string): string | undefined {
  if (!source || [...source].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\') || source.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(source)) return undefined;
  if (source.startsWith('#')) return undefined;
  const path = source.startsWith('/') ? source : workingDirectory.startsWith('/') ? `${workingDirectory}/${source}` : '';
  if (!path) return undefined;
  // Only normalize path segments here. The Runtime remains the filesystem authority.
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export async function resolveFlowerMarkdownMedia(
  source: MarkdownMediaSource,
  signal: AbortSignal,
  context: Readonly<{ adapter: FlowerSurfaceAdapter; threadID: string; workingDirectory: string; copy: FlowerMarkdownMediaCopy; onActionError: (error: unknown) => void }>,
): Promise<ResolvedMarkdownMedia> {
  const remote = safeMarkdownMediaURL(source.src ?? '');
  if (remote) {
    if (source.kind === 'html') throw new Error('Remote HTML must be saved locally before previewing');
    return { src: remote, openURL: remote };
  }
  const frame = /^computer:\/\/([a-zA-Z0-9_-]+)\/([a-f0-9]{64})$/.exec(source.src ?? '');
  let blob: Blob;
  let filePath: string | undefined;
  if (frame && source.kind === 'image' && context.adapter.loadComputerFrame) {
    blob = await context.adapter.loadComputerFrame({ thread_id: context.threadID, target_id: frame[1], sha256: frame[2], resource_ref: source.src!, signal });
  } else {
    const path = flowerMarkdownFilePath(source.src ?? '', context.workingDirectory);
    if (!path || !context.adapter.loadMessageFile) throw new Error('Media source is unavailable');
    blob = await context.adapter.loadMessageFile({ path, signal });
    filePath = path;
  }
  signal.throwIfAborted();
  if (source.kind === 'html') {
    if (!blob.type.startsWith('text/plain') || blob.size > 1_000_000) throw new Error('Invalid HTML preview');
    return { loadHTML: async () => blob.text() };
  }
  if (!blob.type.startsWith(`${source.kind}/`)) throw new Error('Media type does not match the preview');
  const src = URL.createObjectURL(blob);
  signal.addEventListener('abort', () => URL.revokeObjectURL(src), { once: true });
  const openFile = context.adapter.openMessageFile;
  const path = filePath;
  const select = (action: 'preview' | 'reveal') => {
    if (!path || !openFile || signal.aborted) return;
    void openFile({ path, action }).catch(context.onActionError);
  };
  return {
    src,
    ...(source.kind !== 'image' ? { openURL: src } : {}),
    ...(path && openFile ? {
      ...(source.kind === 'image' ? { preview: { label: context.copy.previewImage, onSelect: () => select('preview') } } : {}),
      reveal: { label: context.copy.revealInFolder, onSelect: () => select('reveal') },
    } : {}),
  };
}
