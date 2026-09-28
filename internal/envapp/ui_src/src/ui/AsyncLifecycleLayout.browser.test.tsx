import { ManagedReleaseCandidates } from './pages/EnvPortForwardsPage';
import '../index.css';
import './flower-feature.css';
import { createSignal, type ComponentProps } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { HostApplicationSetupPanel } from './pages/HostApplicationSetupPanel';
import { FlowerAttachmentLane, type FlowerAttachmentLaneCopy } from '../../../../flower_ui/src/attachments/FlowerAttachmentLane';
import type { FlowerAttachmentItem } from '../../../../flower_ui/src/attachments/createFlowerAttachmentController';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
const copy: FlowerAttachmentLaneCopy = {
  listLabel: 'Attachments', retry: 'Retry', reselect: 'Select file', cancel: 'Cancel', remove: 'Remove',
  restore: 'Restore', preview: 'Preview', copyReference: 'Copy reference', uploading: 'Uploading',
  queued: 'Queued', ready: 'Ready', failed: 'Failed', incompatible: 'Incompatible',
  reselectRequired: 'Select again', errorTooLarge: 'Too large', errorCountExceeded: 'Too many',
  errorTotalSizeExceeded: 'Total too large', errorUnsupported: 'Unsupported',
  errorInvalidEncoding: 'Invalid encoding', errorUploadFailed: 'Upload failed',
  errorUnavailable: 'Unavailable', lines: (count) => `${count} lines`,
  added: (name) => `${name} added.`, converted: (name) => `${name} converted.`,
  uploaded: (name) => `${name} uploaded.`, uploadFailedAnnouncement: (name) => `${name} failed.`,
};

it.each([900, 390])('keeps an attachment and the composer still through upload, error and retry at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
  const item: FlowerAttachmentItem = { local_id: 'one', request_id: 'one', attempt_id: 'one', source: 'file', name: 'requirements.txt', mime_type: 'text/plain', size_bytes: 100,
    status: 'queued', loaded_bytes: 0, total_bytes: 100, progress_indeterminate: false };
  const [current, setCurrent] = createSignal(item);
  dispose = render(() => <><FlowerAttachmentLane items={[current()]} copy={{...copy, errorUploadFailed: 'Connection failed. '.repeat(20)}}
    onRetry={() => {}} onReselect={() => {}} onCancel={() => {}} onRemove={() => {}} onRestore={() => {}} />
    <textarea aria-label="Message" /></>, host);
  await settle(); const geometry = () => [...host.querySelectorAll('.flower-attachment-item, textarea')].map(rect);
  const initial = geometry();
  for (const update of [{ status: 'uploading', loaded_bytes: 50 }, { status: 'upload_error', error_code: 'attachment_upload_failed' }, { status: 'uploading', progress_indeterminate: true }, { status: 'staged_ready', loaded_bytes: 100, text_stats: { code_points: 50, lines: 3 } }] as const) {
    setCurrent({ ...item, ...update }); await settle(); expect(geometry()).toEqual(initial);
  }
});

it.each([900, 390])('keeps preparation actions and following applications still through progress and failure at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); document.body.append(host);
  type Props = ComponentProps<typeof HostApplicationSetupPanel>;
  const [setup, setSetup] = createSignal<Props['setup']>(null);
  const [progress, setProgress] = createSignal<Props['desktopProgress']>();
  const [disconnected, setDisconnected] = createSignal(false);
  dispose = render(() => <><HostApplicationSetupPanel setup={setup()} desktopProgress={progress()} allowed submitting={false} canRelay
    disconnected={disconnected()} downloadMethod="desktop" onDownloadMethodChange={() => {}} onStart={() => {}} onCancel={() => {}}
    onReconnect={() => {}} onUpload={() => {}} /><p data-neighbor>Applications</p></>, host);
  await settle(); const geometry = () => [...host.querySelectorAll('.host-apps-preparation, .host-apps-preparation-footer, [data-neighbor]')].map(rect);
  const initial = geometry();
  for (const phase of ['checking', 'downloading', 'packing'] as const) {
    setProgress({ phase, component_bytes: 100, downloaded_bytes: 50, download_bytes: 100, cached_bytes: 25 }); await settle(); expect(geometry()).toEqual(initial);
  }
  setProgress(undefined);
  setSetup({ state: 'validating', received_bytes: 100, expected_bytes: 100, can_cancel: false });
  await settle(); expect(geometry()).toEqual(initial);
  expect(host.querySelector('.host-apps-preparation-actions')?.childElementCount).toBe(0);
  setSetup({ state: 'failed', received_bytes: 100, expected_bytes: 100, can_cancel: false, error_code: 'download_failed' });
  await settle(); expect(geometry()).toEqual(initial);
  setDisconnected(true); await settle(); expect(geometry()).toEqual(initial);
});

it.each([900, 390])('keeps release rows still through verification and unavailable feedback at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.style.height = '700px'; document.body.append(host);
  type Result = NonNullable<ComponentProps<typeof ManagedReleaseCandidates>['result']>;
  const candidate: Result['candidates'][number] = { schema_version: 2, candidate_id: 'one', source_kind: 'oci', source: 'example/workspace', tag: '1.0.1',
    channel: 'stable', trust: 'registry_verified', selectable: true, verification_status: 'pending', relation: 'newer' };
  const [current, setCurrent] = createSignal(candidate);
  dispose = render(() => <ManagedReleaseCandidates result={{ schema_version: 2, check_status: 'fresh', checked_at_unix_ms: 1, catalog_status: 'complete', has_more: false, loaded_count: 2,
    candidates: [current(), {...candidate, candidate_id: 'two'}] }} loading={false} error="" query="" filter="all" selectedID=""
    onQueryChange={() => {}} onFilterChange={() => {}} onSelect={() => {}} />, host);
  await settle(); const geometry = () => [...host.querySelectorAll('[role="radio"]')].map(rect); const initial = geometry();
  for (const update of [{ verification_status: 'verified', digest_verified: true, is_recommended: true, recommendation_status: 'available', digest: 'sha256:verified' },
    { verification_status: 'unavailable', selectable: false, tag_moved: true, reason_code: 'RELEASE_IDENTITY_UNVERIFIABLE' }] as const) {
    setCurrent({...candidate, ...update}); await settle(); expect(geometry()).toEqual(initial);
  }
});
