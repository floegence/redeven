import type { FlowerAttachmentErrorCode } from './attachments/createFlowerAttachmentController';
import type { FlowerSurfaceAdapter, FlowerTurnLaunchInput } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';

type UploadSource = Pick<FlowerSurfaceAdapter, 'loadAttachmentCapability' | 'createAttachmentStagingScope' | 'releaseAttachmentStagingScope' | 'uploadAttachment' | 'deleteStagedAttachment'>;

/** Stage the captured files once; the caller retains the result across unknown admission. */
export async function stageFlowerTurnLauncherAttachments(
  source: UploadSource,
  prepared: FlowerTurnLaunchInput,
  files: readonly File[],
  copy: Pick<FlowerSurfaceCopy['attachments'], 'errorUnavailable' | 'errorTooLarge' | 'errorCountExceeded' | 'errorTotalSizeExceeded' | 'errorUnsupported' | 'errorInvalidEncoding' | 'errorUploadFailed' | 'restoreFailed'>,
): Promise<FlowerTurnLaunchInput> {
  if (!files.length) return prepared;
  if (!source.loadAttachmentCapability || !source.createAttachmentStagingScope || !source.uploadAttachment || !prepared.model_id) {
    throw new Error(copy.errorUnavailable);
  }
  const { createFlowerAttachmentController } = await import('./attachments/createFlowerAttachmentController');
  const messages: Record<FlowerAttachmentErrorCode, string> = {
    attachment_unavailable: copy.errorUnavailable,
    attachment_too_large: copy.errorTooLarge,
    attachment_count_exceeded: copy.errorCountExceeded,
    attachment_total_size_exceeded: copy.errorTotalSizeExceeded,
    attachment_unsupported: copy.errorUnsupported,
    attachment_invalid_text_encoding: copy.errorInvalidEncoding,
    attachment_upload_failed: copy.errorUploadFailed,
    attachment_restore_failed: copy.restoreFailed,
  };
  const capability = await source.loadAttachmentCapability(prepared.model_id);
  if (capability.model_id !== prepared.model_id || !capability.enabled) throw new Error(copy.errorUnavailable);
  const uploads = createFlowerAttachmentController({ capability, upload: source.uploadAttachment, deleteStaged: source.deleteStagedAttachment });
  let scope: Awaited<ReturnType<NonNullable<UploadSource['createAttachmentStagingScope']>>> | undefined;
  try {
    uploads.setSuspended(true);
    uploads.addFiles(files, 'file');
    const invalid = uploads.snapshot().items.find(item => item.error_code);
    if (invalid?.error_code) throw new Error(`${invalid.name}: ${messages[invalid.error_code]}`);
    scope = await source.createAttachmentStagingScope(prepared.thread_id || prepared.client_request_id);
    uploads.setStagingScope(scope);
    uploads.setSuspended(false);
    await uploads.waitForIdle();
    const items = uploads.snapshot().items;
    const failed = items.find(item => item.status !== 'staged_ready' || !item.staged);
    if (failed) throw new Error(`${failed.name}: ${messages[failed.error_code ?? 'attachment_upload_failed']}`);
    return { ...prepared, staging_scope: scope, attachment_ids: items.map(item => item.staged!.attachment_id) };
  } catch (error) {
    if (scope) await source.releaseAttachmentStagingScope?.(scope).catch(() => undefined);
    throw error;
  } finally {
    uploads.dispose();
  }
}
