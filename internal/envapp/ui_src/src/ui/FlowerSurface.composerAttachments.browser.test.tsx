import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerAttachmentCapability,
  FlowerAttachmentUploadInput,
  FlowerStagedAttachment,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  renderSurfaceWithAdapter,
  waitFor,
} from './FlowerSurface.navigation.testHarness';
import {
  FlowerAttachmentLane,
  type FlowerAttachmentLaneCopy,
} from '../../../../flower_ui/src/attachments/FlowerAttachmentLane';
import type { FlowerAttachmentItem } from '../../../../flower_ui/src/attachments/createFlowerAttachmentController';

function expectHorizontallyContained(child: DOMRect, parent: DOMRect): void {
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.right).toBeLessThanOrEqual(parent.right + 1);
}

describe('Flower composer attachment browser presentation', () => {
  it('contains reselect-required actions at 400-percent equivalent width with long German copy', async () => {
    await page.viewport(320, 720);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    host.style.width = '100%';
    document.body.appendChild(host);
    const reselectLabel = 'Dieselbe lokale Datei erneut aus dem Dateisystem auswählen';
    const removeLabel = 'Diesen nicht mehr verfügbaren Anhang dauerhaft aus dem Entwurf entfernen';
    const longCopy: FlowerAttachmentLaneCopy = {
      listLabel: 'Angehängte Dateien und automatisch ausgelagerte lange Texte',
      retry: 'Hochladen dieser Datei erneut versuchen',
      reselect: reselectLabel,
      cancel: 'Hochladen dieser Datei abbrechen',
      remove: removeLabel,
      restore: 'Den vollständigen langen Text im Eingabefeld wiederherstellen',
      preview: 'Den vollständigen langen Text in einem neuen Fenster anzeigen',
      copyReference: 'Den kanonischen Verweispfad dieses Anhangs kopieren',
      uploading: 'Wird hochgeladen', queued: 'Wartet', ready: 'Bereit', failed: 'Fehlgeschlagen',
      incompatible: 'Nicht kompatibel', reselectRequired: 'Die lokale Datei muss erneut ausgewählt werden',
      errorTooLarge: 'Zu groß', errorCountExceeded: 'Zu viele Anhänge',
      errorTotalSizeExceeded: 'Gesamtgröße überschritten', errorUnsupported: 'Nicht unterstützt',
      errorInvalidEncoding: 'Ungültige Zeichenkodierung', errorUploadFailed: 'Hochladen fehlgeschlagen',
      errorUnavailable: 'Nicht verfügbar', lines: (count) => `${count} Textzeilen`,
      added: (name) => `${name} hinzugefügt.`, converted: (name) => `${name} ausgelagert.`,
      uploaded: (name) => `${name} hochgeladen.`, uploadFailedAnnouncement: (name) => `${name} fehlgeschlagen.`,
    };
    const item: FlowerAttachmentItem = {
      local_id: 'reselect-browser', request_id: 'request-browser', attempt_id: 'attempt-browser',
      source: 'file', name: 'außergewöhnlich-lange-beobachtungs-und-bereitstellungsnotizen.txt',
      mime_type: 'text/plain', size_bytes: 18_432, status: 'reselect_required',
      loaded_bytes: 0, total_bytes: 18_432, progress_indeterminate: false,
    };
    const onReselect = vi.fn();
    const onRemove = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[item]} copy={longCopy} locale="de-DE" onRetry={vi.fn()} onReselect={onReselect}
        onCancel={vi.fn()} onRemove={onRemove} onRestore={vi.fn()}
      />
    ), host);
    try {
      await waitFor(() => host.querySelectorAll('.flower-attachment-actions button').length === 2);
      const lane = host.querySelector('.flower-attachment-lane') as HTMLElement;
      const attachment = host.querySelector('.flower-attachment-item') as HTMLElement;
      const actions = host.querySelector('.flower-attachment-actions') as HTMLElement;
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
      expect(attachment.scrollWidth).toBeLessThanOrEqual(attachment.clientWidth + 1);
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth + 1);
      expectHorizontallyContained(attachment.getBoundingClientRect(), lane.getBoundingClientRect());
      expectHorizontallyContained(actions.getBoundingClientRect(), attachment.getBoundingClientRect());

      const reselect = actions.querySelector<HTMLButtonElement>(`button[aria-label="${reselectLabel}"]`);
      const remove = actions.querySelector<HTMLButtonElement>(`button[aria-label="${removeLabel}"]`);
      for (const button of [reselect, remove]) {
        expect(button).not.toBeNull();
        const bounds = button!.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expectHorizontallyContained(bounds, actions.getBoundingClientRect());
      }
      expect(reselect!.title).toBe(reselectLabel);
      expect(remove!.title).toBe(removeLabel);
      reselect!.click();
      remove!.click();
      expect(onReselect).toHaveBeenCalledWith(item.local_id);
      expect(onRemove).toHaveBeenCalledWith(item.local_id);
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps every long-text action contained and touch-sized with long localized labels', async () => {
    await page.viewport(320, 720);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    host.style.width = '100%';
    document.body.appendChild(host);
    const longCopy: FlowerAttachmentLaneCopy = {
      listLabel: 'Angehängte Dateien und automatisch ausgelagerte lange Texte',
      retry: 'Hochladen dieser Datei erneut versuchen',
      reselect: 'Dieselbe Datei erneut auswählen',
      cancel: 'Hochladen dieser Datei abbrechen',
      remove: 'Diesen Anhang dauerhaft aus dem Entwurf entfernen',
      restore: 'Den vollständigen langen Text im Eingabefeld wiederherstellen',
      preview: 'Den vollständigen langen Text in einem neuen Fenster anzeigen',
      copyReference: 'Den kanonischen Verweispfad dieses Anhangs kopieren',
      uploading: 'Wird hochgeladen', queued: 'Wartet', ready: 'Bereit', failed: 'Fehlgeschlagen',
      incompatible: 'Nicht kompatibel', reselectRequired: 'Erneut auswählen',
      errorTooLarge: 'Zu groß', errorCountExceeded: 'Zu viele Anhänge',
      errorTotalSizeExceeded: 'Gesamtgröße überschritten', errorUnsupported: 'Nicht unterstützt',
      errorInvalidEncoding: 'Ungültige Zeichenkodierung', errorUploadFailed: 'Hochladen fehlgeschlagen',
      errorUnavailable: 'Nicht verfügbar', lines: (count) => `${count} Textzeilen`,
      added: (name) => `${name} hinzugefügt.`, converted: (name) => `${name} ausgelagert.`,
      uploaded: (name) => `${name} hochgeladen.`, uploadFailedAnnouncement: (name) => `${name} fehlgeschlagen.`,
    };
    const item: FlowerAttachmentItem = {
      local_id: 'long-text-browser', request_id: 'request-browser', attempt_id: 'attempt-browser',
      source: 'long_text', name: 'sehr-lange-technische-spezifikation-mit-ausführlichen-beobachtungen.txt',
      mime_type: 'text/plain; charset=utf-8', size_bytes: 240_000, status: 'staged_ready',
      loaded_bytes: 240_000, total_bytes: 240_000, progress_indeterminate: false,
      text_stats: { code_points: 220_000, lines: 4_321 },
      staged: {
        attachment_id: 'upl_long_text_browser',
        name: 'sehr-lange-technische-spezifikation-mit-ausführlichen-beobachtungen.txt',
        mime_type: 'text/plain; charset=utf-8', size_bytes: 240_000, digest_sha256: 'f'.repeat(64),
        locator: 'attachment://v1/upl_long_text_browser/specification.txt', source: 'long_text',
        capability_revision: 'browser-capability', text_stats: { code_points: 220_000, lines: 4_321 },
      },
    };
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[item]} copy={longCopy} locale="de-DE" onRetry={vi.fn()} onReselect={vi.fn()}
        onCancel={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} onPreview={vi.fn()}
        onCopyReference={vi.fn()}
      />
    ), host);
    try {
      await waitFor(() => host.querySelectorAll('.flower-attachment-actions button').length === 4);
      const lane = host.querySelector('.flower-attachment-lane') as HTMLElement;
      const attachment = host.querySelector('.flower-attachment-item') as HTMLElement;
      const actions = host.querySelector('.flower-attachment-actions') as HTMLElement;
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
      expect(attachment.scrollWidth).toBeLessThanOrEqual(attachment.clientWidth + 1);
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth + 1);
      expectHorizontallyContained(attachment.getBoundingClientRect(), lane.getBoundingClientRect());
      expectHorizontallyContained(actions.getBoundingClientRect(), attachment.getBoundingClientRect());
      const actionLabels = [longCopy.restore, longCopy.preview, longCopy.copyReference, longCopy.remove];
      for (const label of actionLabels) {
        const button = actions.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        expect(button).not.toBeNull();
        const bounds = button!.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expectHorizontallyContained(bounds, actions.getBoundingClientRect());
      }
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps attachment controls usable at 400-percent equivalent width and model guidance contained', async () => {
    await page.viewport(320, 720);
    const capability: FlowerAttachmentCapability = {
      model_id: 'openai/gpt-5.2',
      revision: 'browser-capability',
      enabled: true,
      supports_long_text: true,
      max_attachments: 4,
      max_file_size_bytes: 1_000_000,
      max_total_size_bytes: 2_000_000,
      routes: { 'text/plain': 'tool_read' },
    };
    const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
      attachment_id: 'upl_browser_attachment',
      name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      digest_sha256: 'e'.repeat(64),
      locator: `attachment://v1/upl_browser_attachment/${input.file.name}`,
      source: input.source,
      capability_revision: capability.revision,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadAttachmentCapability: vi.fn(async () => capability),
      uploadAttachment,
      previewStagedAttachment: vi.fn(async () => undefined),
    });

    await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getBoundingClientRect().width).toBeGreaterThanOrEqual(128);
    const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      ['browser attachment'],
      'deployment-observability-and-reliability-review-notes.txt',
      { type: 'text/plain' },
    ));
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => runtime.querySelector('[data-attachment-status="staged_ready"]') !== null);

    const surface = runtime.querySelector('#redeven-flower-surface') as HTMLElement;
    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    const lane = runtime.querySelector('.flower-attachment-lane') as HTMLElement;
    const item = runtime.querySelector('.flower-attachment-item') as HTMLElement;
    const actions = runtime.querySelector('.flower-attachment-actions') as HTMLElement;
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth + 1);
    expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
    expectHorizontallyContained(item.getBoundingClientRect(), lane.getBoundingClientRect());
    expectHorizontallyContained(actions.getBoundingClientRect(), item.getBoundingClientRect());

    const visibleModelTrigger = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.flower-model-reasoning-model-trigger'))
      .find((button) => !button.closest('.flower-composer-controls-measure') && button.getBoundingClientRect().width > 0);
    await page.viewport(800, 720);
    await waitFor(() => Boolean(visibleModelTrigger()));
    const modelTrigger = visibleModelTrigger();
    expect(modelTrigger).toBeTruthy();
    modelTrigger!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-model-menu-attachment-status')));
    const menu = document.querySelector('.flower-model-menu') as HTMLElement;
    await waitFor(() => {
      const menuBounds = menu.getBoundingClientRect();
      const surfaceBounds = surface.getBoundingClientRect();
      return menuBounds.left >= surfaceBounds.left - 1 && menuBounds.right <= surfaceBounds.right + 1;
    });
    expectHorizontallyContained(menu.getBoundingClientRect(), surface.getBoundingClientRect());
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});
