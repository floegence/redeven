import { createEffect, createMemo, mapArray, onCleanup, untrack, type Accessor } from 'solid-js';
import { createFlowerKeyedSubscriptions } from './flowerPresentationSubscriptions';
import type { FlowerToolSequence } from './flowerToolSequences';

type PendingContent = Readonly<{ nodeKey: string; motionKey: string }>;
export function observeFlowerSequenceDisclosure(options: {
  groups: Accessor<ReadonlyMap<string, FlowerToolSequence>>;
  pending: Accessor<ReadonlyMap<string, PendingContent>>;
  revealing: Accessor<ReadonlySet<string>>;
  animate: Accessor<boolean>;
  observe: (group: FlowerToolSequence, animate: boolean) => void;
}) {
  // Publish only the groups whose own motion boundary changed. A title in the
  // live tail must not reschedule disclosure work for every retained sequence.
  const blocked = createFlowerKeyedSubscriptions(() => {
    const pending = options.pending(), revealing = options.revealing();
    return new Map([...options.groups()].map(([key, group]) => [key,
      group.followingContentKeys.some(key => {
        const owner = pending.get(key);
        return owner && owner.motionKey !== 'tools:' + owner.nodeKey;
      }) || group.disclosure === 'automatic' && group.entryKeys.some(key => revealing.has(key)),
    ]));
  });
  const observe = mapArray(() => [...options.groups().values()], group => {
    const waiting = blocked(group.key);
    createEffect(() => {
      const animate = options.animate();
      if (waiting()) return;
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      // Fresh row titles mount before the automatic fold claims their group.
      queueMicrotask(() => untrack(() => {
        if (!cancelled && !waiting()) options.observe(group, animate);
      }));
    });
    return group;
  });
  createMemo(observe);
}
