import type { FlowerQueuedDraft } from '../contracts/flowerSurfaceContracts';
import type { FlowerComposerDraftReference } from './createFlowerComposerDraftCoordinator';

export function flowerQueuedDraftReferences(draft: FlowerQueuedDraft): readonly FlowerComposerDraftReference[] {
  return draft.references.map((item, index) => {
    const local_id = `restored:${index}`;
    switch (item.kind) {
      case 'file_path': return { local_id, kind: item.is_directory ? 'directory' : 'file', path: item.path, label: item.path.split('/').filter(Boolean).at(-1) || item.path };
      case 'thread_reference': return { local_id, kind: 'thread', label: item.thread.title, thread: item.thread };
      case 'reference_snapshot': return { local_id, kind: 'snapshot', label: item.reference_snapshot.label, snapshot: item.reference_snapshot };
      default: throw new Error('Invalid restored composer reference.');
    }
  });
}
