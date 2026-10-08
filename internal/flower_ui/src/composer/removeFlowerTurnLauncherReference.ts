import type { FlowerTurnLauncherIntent } from '../contracts/flowerSurfaceContracts';
import { requireAskFlowerContextActionEnvelope } from '../contextActionWire';
import type { FlowerTurnLauncherContextChip } from '../flowerTurnLauncherCopy';

/** Remove the displayed source and its consolidated snapshots from the same launch input. */
export function removeFlowerTurnLauncherReference(
  intent: FlowerTurnLauncherIntent,
  entry: FlowerTurnLauncherContextChip,
): FlowerTurnLauncherIntent {
  const attachments = [entry.primary_action, ...entry.secondary_actions]
    .flatMap(action => action?.type === 'open_attachment_snapshot_preview' ? [action.file] : []);
  const action = requireAskFlowerContextActionEnvelope(intent.context_action);
  if (action && action.context.length !== intent.context_items.length) {
    throw new Error('Flower launch context does not match its displayed references.');
  }
  const contextItems = intent.context_items.filter((_, index) => index !== entry.item_index);
  const context = action?.context.filter((_, index) => index !== entry.item_index);
  return {
    ...intent,
    context_items: contextItems,
    ...(intent.pending_attachments ? {
      pending_attachments: intent.pending_attachments.filter(file => !attachments.includes(file)),
    } : {}),
    context_action: context?.length ? { ...action, context } : undefined,
  };
}
