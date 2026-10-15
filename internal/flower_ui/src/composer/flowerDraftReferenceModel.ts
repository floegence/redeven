import type { ContextActionContextItem } from '../contextActionWire';
import type { FlowerComposerDraftReference } from './createFlowerComposerDraftCoordinator';
import { normalizeFlowerComposerReferencePath } from './flowerComposerReferenceIndex';

/** One type dispatch for draft identity, submission and visible description. */
export function flowerDraftReferenceIdentity(reference: FlowerComposerDraftReference): string {
  switch (reference.kind) {
    case 'snapshot': return `snapshot\0${reference.local_id}`;
    case 'thread': return `thread\0${reference.thread.runtime_id}\0${reference.thread.thread_id}`;
    case 'page_context': return 'page_context';
    case 'file':
    case 'directory': return `${reference.kind}\0${normalizeFlowerComposerReferencePath(reference.path)}`;
  }
}

export function flowerDraftReferenceContextItem(reference: FlowerComposerDraftReference): ContextActionContextItem {
  switch (reference.kind) {
    case 'snapshot': return { kind: 'reference_snapshot', reference_snapshot: reference.snapshot };
    case 'thread': return { kind: 'thread_reference', thread: reference.thread };
    case 'page_context': return { kind: 'text_snapshot', title: reference.title, content: reference.content };
    case 'file':
    case 'directory': return { kind: 'file_path', path: reference.path, is_directory: reference.kind === 'directory' };
  }
}

export function flowerDraftReferenceDescription(reference: FlowerComposerDraftReference): string {
  switch (reference.kind) {
    case 'snapshot': return reference.snapshot.label;
    case 'thread': return reference.thread.title || reference.label;
    case 'page_context': return reference.title;
    case 'file':
    case 'directory': return reference.path;
  }
}
