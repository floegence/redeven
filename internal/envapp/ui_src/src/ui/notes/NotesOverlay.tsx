import {
  NotesOverlay as SharedNotesOverlay,
  type NotesOverlayProps as SharedNotesOverlayProps,
} from '@floegence/floe-webapp-core/notes';
import { createEffect, createMemo, onCleanup } from 'solid-js';
import {
  createI18nHelpers,
  SUPPORTED_LOCALES,
  useI18n,
  type I18nHelpers,
} from '../i18n';
import type { TranslationParams } from '../i18n/dictionaryTypes';
import { useRedevenNotesController } from './createRedevenNotesController';
import { createNotesOverlayViewportController } from './notesOverlayViewport';

export interface NotesOverlayProps {
  open: boolean;
  onClose: () => void;
  viewportHosts?: readonly (HTMLElement | null | undefined)[];
  /** Shell-owned toggle shortcut that must remain available while floating Notes is focused. */
  toggleKeybind?: string;
}

export function NotesOverlay(props: NotesOverlayProps) {
  const i18n = useI18n();
  const controller = useRedevenNotesController(() => props.open);
  const viewportController = createNotesOverlayViewportController();
  const allowGlobalHotkeys = createMemo<readonly string[] | undefined>(() => {
    const keybind = props.toggleKeybind?.trim();
    return keybind ? [keybind] : undefined;
  });

  createEffect(() => {
    viewportController.setViewportHostElements(props.viewportHosts ?? []);
  });

  createEffect(() => {
    viewportController.setActive(props.open);
  });

  createEffect(() => {
    if (!props.open || typeof document === 'undefined') {
      return;
    }
    const overlay = document.querySelector('.notes-overlay');
    if (!overlay) {
      return;
    }
    const copy: SharedNotesOverlayChromeCopy = {
      title: i18n.t('notesOverlay.title'),
      ariaLabel: i18n.t('notesOverlay.ariaLabel'),
      closeAriaLabel: i18n.t('notesOverlay.closeAriaLabel'),
      topics: i18n.t('notesOverlay.topics'),
      liveNote: i18n.t('notesOverlay.liveNote'),
      liveNotesSuffix: i18n.t('notesOverlay.liveNotesSuffix'),
      trash: i18n.t('notesOverlay.trash'),
      openTrashDock: i18n.t('notesOverlay.openTrashDock'),
      openTrashDockWithCount: (count) => i18n.t('notesOverlay.openTrashDockWithCount', { count }),
      addTopic: i18n.t('notesOverlay.addTopic'),
      saveTopicName: i18n.t('notesOverlay.saveTopicName'),
      cancelTopicEdit: i18n.t('notesOverlay.cancelTopicEdit'),
      editTopic: (name) => i18n.t('notesOverlay.editTopic', { name }),
      deleteTopic: (name) => i18n.t('notesOverlay.deleteTopic', { name }),
      topicNamePlaceholder: i18n.t('notesOverlay.topicNamePlaceholder'),
      activeTopic: i18n.t('notesOverlay.activeTopic'),
      canvasForTopic: (topic) => i18n.t('notesOverlay.canvasForTopic', { topic }),
      openOverviewMap: i18n.t('notesOverlay.openOverviewMap'),
      zoomOut: i18n.t('notesOverlay.zoomOut'),
      zoomIn: i18n.t('notesOverlay.zoomIn'),
      createNoteAtCanvasCenter: i18n.t('notesOverlay.createNoteAtCanvasCenter'),
      pasteNoteAtCanvasCenter: i18n.t('notesOverlay.pasteNoteAtCanvasCenter'),
      newNote: i18n.t('notesOverlay.newNote'),
      pasteNote: i18n.t('notesOverlay.pasteNote'),
      map: i18n.t('notesOverlay.map'),
      dragNote: i18n.t('notesOverlay.dragNote'),
      editNote: i18n.t('notesOverlay.editNote'),
      moveNoteToTrash: i18n.t('notesOverlay.moveNoteToTrash'),
      emptyNote: i18n.t('notesOverlay.emptyNote'),
      copied: i18n.t('notesOverlay.copied'),
      trashDock: i18n.t('notesOverlay.trashDock'),
      closeTrashDock: i18n.t('notesOverlay.closeTrashDock'),
      trashItemsSuffix: i18n.t('notesOverlay.trashItemsSuffix'),
      trashDescription: i18n.t('notesOverlay.trashDescription'),
      trashEmptyTitle: i18n.t('notesOverlay.trashEmptyTitle'),
      trashEmptyDescription: i18n.t('notesOverlay.trashEmptyDescription'),
      deletedNote: i18n.t('notesOverlay.deletedNote'),
      deletedNotesSuffix: i18n.t('notesOverlay.deletedNotesSuffix'),
      clearTopicTrash: i18n.t('notesOverlay.clearTopicTrash'),
      restore: i18n.t('notesOverlay.restore'),
      deleteNow: i18n.t('notesOverlay.deleteNow'),
      editorEditNote: i18n.t('notesOverlay.editorEditNote'),
      editorRefineNote: i18n.t('notesOverlay.editorRefineNote'),
      editorComposeNote: i18n.t('notesOverlay.editorComposeNote'),
      editorClose: i18n.t('notesOverlay.editorClose'),
      editorColor: i18n.t('notesOverlay.editorColor'),
      editorHeadline: i18n.t('notesOverlay.editorHeadline'),
      editorText: i18n.t('notesOverlay.editorText'),
      editorHeadlinePlaceholder: i18n.t('notesOverlay.editorHeadlinePlaceholder'),
      editorHeadlineHelper: i18n.t('notesOverlay.editorHeadlineHelper'),
      editorBodyPlaceholder: i18n.t('notesOverlay.editorBodyPlaceholder'),
      editorCancel: i18n.t('notesOverlay.editorCancel'),
      editorSave: i18n.t('notesOverlay.editorSave'),
      manualPaste: i18n.t('notesOverlay.manualPaste'),
      manualPasteTitle: i18n.t('notesOverlay.manualPasteTitle'),
      closePastePanel: i18n.t('notesOverlay.closePastePanel'),
      pastePanelPlaceholder: i18n.t('notesOverlay.pastePanelPlaceholder'),
      createNote: i18n.t('notesOverlay.createNote'),
      createFailed: i18n.t('notesOverlay.createFailed'),
      pastedTitle: i18n.t('notesOverlay.pastedTitle'),
      pastedMessage: i18n.t('notesOverlay.pastedMessage'),
      pasteFailed: i18n.t('notesOverlay.pasteFailed'),
      clipboardEmptyTitle: i18n.t('notesOverlay.clipboardEmptyTitle'),
      clipboardEmptyMessage: i18n.t('notesOverlay.clipboardEmptyMessage'),
      clipboardBlockedTitle: i18n.t('notesOverlay.clipboardBlockedTitle'),
      clipboardBlockedMessage: i18n.t('notesOverlay.clipboardBlockedMessage'),
      nothingToCopyTitle: i18n.t('notesOverlay.nothingToCopyTitle'),
      nothingToCopyMessage: (label) => i18n.t('notesOverlay.nothingToCopyMessage', { label }),
      copiedTitle: i18n.t('notesOverlay.copiedTitle'),
      copiedMessage: (label) => i18n.t('notesOverlay.copiedMessage', { label }),
      copyFailedTitle: i18n.t('notesOverlay.copyFailedTitle'),
      copyFailedMessage: i18n.t('notesOverlay.copyFailedMessage'),
      deleteFailed: i18n.t('notesOverlay.deleteFailed'),
      restoreFailed: i18n.t('notesOverlay.restoreFailed'),
      moveFailed: i18n.t('notesOverlay.moveFailed'),
    };
    const localize = () => localizeSharedNotesOverlayChrome(overlay, copy);
    localize();
    if (typeof MutationObserver === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => localize());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label', 'placeholder'],
    });
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    viewportController.dispose();
  });

  return (
    <SharedNotesOverlay
      open={props.open}
      controller={controller}
      onClose={props.onClose}
      interactionMode="floating"
      allowGlobalHotkeys={allowGlobalHotkeys()}
    />
  );
}

export type { SharedNotesOverlayProps };

type SharedNotesOverlayChromeCopy = Readonly<{
  title: string;
  ariaLabel: string;
  closeAriaLabel: string;
  topics: string;
  liveNote: string;
  liveNotesSuffix: string;
  trash: string;
  openTrashDock: string;
  openTrashDockWithCount: (count: string) => string;
  addTopic: string;
  saveTopicName: string;
  cancelTopicEdit: string;
  editTopic: (name: string) => string;
  deleteTopic: (name: string) => string;
  topicNamePlaceholder: string;
  activeTopic: string;
  canvasForTopic: (topic: string) => string;
  openOverviewMap: string;
  zoomOut: string;
  zoomIn: string;
  createNoteAtCanvasCenter: string;
  pasteNoteAtCanvasCenter: string;
  newNote: string;
  pasteNote: string;
  map: string;
  dragNote: string;
  editNote: string;
  moveNoteToTrash: string;
  emptyNote: string;
  copied: string;
  trashDock: string;
  closeTrashDock: string;
  trashItemsSuffix: string;
  trashDescription: string;
  trashEmptyTitle: string;
  trashEmptyDescription: string;
  deletedNote: string;
  deletedNotesSuffix: string;
  clearTopicTrash: string;
  restore: string;
  deleteNow: string;
  editorEditNote: string;
  editorRefineNote: string;
  editorComposeNote: string;
  editorClose: string;
  editorColor: string;
  editorHeadline: string;
  editorText: string;
  editorHeadlinePlaceholder: string;
  editorHeadlineHelper: string;
  editorBodyPlaceholder: string;
  editorCancel: string;
  editorSave: string;
  manualPaste: string;
  manualPasteTitle: string;
  closePastePanel: string;
  pastePanelPlaceholder: string;
  createNote: string;
  createFailed: string;
  pastedTitle: string;
  pastedMessage: string;
  pasteFailed: string;
  clipboardEmptyTitle: string;
  clipboardEmptyMessage: string;
  clipboardBlockedTitle: string;
  clipboardBlockedMessage: string;
  nothingToCopyTitle: string;
  nothingToCopyMessage: (label: string) => string;
  copiedTitle: string;
  copiedMessage: (label: string) => string;
  copyFailedTitle: string;
  copyFailedMessage: string;
  deleteFailed: string;
  restoreFailed: string;
  moveFailed: string;
}>;

function updateElementText(root: Element, selector: string, value: string): void {
  const element = root.querySelector(selector);
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function updateAllElementText(root: ParentNode, selector: string, value: string): void {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  }
}

function updateAttribute(root: ParentNode, selector: string, attributeName: string, value: string): void {
  const element = root.querySelector(selector);
  if (element && element.getAttribute(attributeName) !== value) {
    element.setAttribute(attributeName, value);
  }
}

function updateAllMatchingAttribute(
  root: ParentNode,
  selector: string,
  attributeName: string,
  valueForCurrent: (current: string) => string | null,
): void {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    const current = element.getAttribute(attributeName) ?? '';
    const next = valueForCurrent(current);
    if (next && current !== next) {
      element.setAttribute(attributeName, next);
    }
  }
}

function replaceTextWhenOneOf(root: ParentNode, selector: string, originals: readonly string[], localized: string): void {
  const originalSet = new Set(originals.map((value) => value.trim()));
  for (const element of Array.from(root.querySelectorAll(selector))) {
    if (originalSet.has(element.textContent?.trim() ?? '')) {
      element.textContent = localized;
    }
  }
}

function updateInputPlaceholder(root: ParentNode, selector: string, value: string): void {
  for (const element of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector))) {
    if (element.placeholder !== value) {
      element.placeholder = value;
    }
  }
}

function replaceTrailingTextNode(element: Element | undefined, value: string): void {
  if (!element) {
    return;
  }
  for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
    const node = element.childNodes[index];
    if (node.nodeType === 3) {
      if (node.textContent !== value) {
        node.textContent = value;
      }
      return;
    }
  }
  element.append(document.createTextNode(value));
}

const localizedNotesOverlayStringCache = new Map<Parameters<I18nHelpers['t']>[0], readonly string[]>();

function allLocalizedNotesOverlayStrings(
  key: Parameters<I18nHelpers['t']>[0],
  params?: TranslationParams,
): readonly string[] {
  if (params) {
    return SUPPORTED_LOCALES.map((locale) => createI18nHelpers(locale).t(key, params));
  }
  const cached = localizedNotesOverlayStringCache.get(key);
  if (cached) {
    return cached;
  }
  const values = SUPPORTED_LOCALES.map((locale) => createI18nHelpers(locale).t(key));
  localizedNotesOverlayStringCache.set(key, values);
  return values;
}

function matchesAnyLocalizedNotesOverlayString(
  current: string,
  key: Parameters<I18nHelpers['t']>[0],
): boolean {
  const clean = current.trim();
  return allLocalizedNotesOverlayStrings(key).some((value) => value.trim() === clean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchLocalizedNotesOverlayParam(
  current: string,
  key: Parameters<I18nHelpers['t']>[0],
  paramName: string,
): string | null {
  const sentinel = '\uE000REDEVEN_I18N_PARAM\uE000';
  const clean = current.trim();
  for (const template of allLocalizedNotesOverlayStrings(key, { [paramName]: sentinel })) {
    const [prefix, suffix] = template.split(sentinel);
    if (prefix === undefined || suffix === undefined) {
      continue;
    }
    const match = clean.match(new RegExp(`^${escapeRegex(prefix)}(.+)${escapeRegex(suffix)}$`, 'u'));
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function localizeSharedNotesOverlayChrome(root: Element, copy: SharedNotesOverlayChromeCopy): void {
  if (root.getAttribute('aria-label') !== copy.ariaLabel) {
    root.setAttribute('aria-label', copy.ariaLabel);
  }
  updateElementText(root, '.notes-overlay__header-title', copy.title);
  updateElementText(root, '.notes-overlay__rail-heading', copy.topics);
  updateElementText(root, '.notes-page__eyebrow', copy.activeTopic);
  const stats = Array.from(root.querySelectorAll('.notes-overlay__header-stat'));
  const [topicsStat, liveNotesStat, trashStat] = stats;
  replaceTrailingTextNode(topicsStat, ` ${copy.topics}`);
  replaceTrailingTextNode(liveNotesStat, ` ${copy.liveNote}${copy.liveNotesSuffix}`);
  replaceTrailingTextNode(trashStat, ` ${copy.trash}`);
  for (const meta of Array.from(root.querySelectorAll('.notes-topic-row__meta, .notes-overlay__board-meta'))) {
    replaceTrailingTextNode(meta, ` ${copy.liveNote}${copy.liveNotesSuffix}`);
  }
  updateAttribute(root, '.notes-topic-composer__button', 'aria-label', copy.addTopic);
  updateInputPlaceholder(root, '.notes-topic-composer input', copy.addTopic);
  updateAttribute(root, '.notes-topic-row__editor button[type="submit"]', 'aria-label', copy.saveTopicName);
  updateAttribute(root, '.notes-topic-row__editor button[type="button"]', 'aria-label', copy.cancelTopicEdit);
  updateInputPlaceholder(root, '.notes-topic-row__editor input', copy.topicNamePlaceholder);
  updateAllMatchingAttribute(root, '.notes-topic-row__edit', 'aria-label', (current) => {
    const editName = matchLocalizedNotesOverlayParam(current, 'notesOverlay.editTopic', 'name');
    if (editName) {
      return copy.editTopic(editName);
    }
    const deleteName = matchLocalizedNotesOverlayParam(current, 'notesOverlay.deleteTopic', 'name');
    if (deleteName) {
      return copy.deleteTopic(deleteName);
    }
    return null;
  });
  updateAllMatchingAttribute(root, '.notes-canvas', 'aria-label', (current) => {
    const topic = matchLocalizedNotesOverlayParam(current, 'notesOverlay.canvasForTopic', 'topic');
    return topic ? copy.canvasForTopic(topic) : null;
  });
  updateAllMatchingAttribute(root, '.notes-overlay__hud-button', 'aria-label', (current) => {
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.openOverviewMap')) {
      return copy.openOverviewMap;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.zoomOut')) {
      return copy.zoomOut;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.zoomIn')) {
      return copy.zoomIn;
    }
    return null;
  });
  updateAllMatchingAttribute(root, '.notes-mobile-dock__action', 'aria-label', (current) => {
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.createNoteAtCanvasCenter')) {
      return copy.createNoteAtCanvasCenter;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.pasteNoteAtCanvasCenter')) {
      return copy.pasteNoteAtCanvasCenter;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.openOverviewMap')) {
      return copy.openOverviewMap;
    }
    return null;
  });
  replaceTextWhenOneOf(root, '.notes-mobile-dock__action span', allLocalizedNotesOverlayStrings('notesOverlay.newNote'), copy.newNote);
  replaceTextWhenOneOf(root, '.notes-mobile-dock__action span', allLocalizedNotesOverlayStrings('notesOverlay.pasteNote'), copy.pasteNote);
  replaceTextWhenOneOf(root, '.notes-mobile-dock__action span', allLocalizedNotesOverlayStrings('notesOverlay.map'), copy.map);
  updateAllMatchingAttribute(root, '.notes-note__drag, .notes-note__icon-button', 'aria-label', (current) => {
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.dragNote')) {
      return copy.dragNote;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.editNote')) {
      return copy.editNote;
    }
    if (matchesAnyLocalizedNotesOverlayString(current, 'notesOverlay.moveNoteToTrash')) {
      return copy.moveNoteToTrash;
    }
    return null;
  });
  replaceTextWhenOneOf(root, '.notes-note__body-copy', allLocalizedNotesOverlayStrings('notesOverlay.emptyNote'), copy.emptyNote);
  updateAllElementText(root, '.notes-note__copied-copy', copy.copied);
  const closeButton = root.querySelector('.notes-overlay__close');
  if (closeButton && closeButton.getAttribute('aria-label') !== copy.closeAriaLabel) {
    closeButton.setAttribute('aria-label', copy.closeAriaLabel);
  }
  const trashToggle = root.querySelector('.notes-trash__toggle');
  if (trashToggle) {
    const rawCount = trashToggle.getAttribute('aria-label')?.match(/\d+/u)?.[0] ?? '';
    const nextLabel = rawCount ? copy.openTrashDockWithCount(rawCount) : copy.openTrashDock;
    if (trashToggle.getAttribute('aria-label') !== nextLabel) {
      trashToggle.setAttribute('aria-label', nextLabel);
    }
  }
  localizeSharedNotesOverlayPortals(copy);
  localizeSharedNotesNotifications(copy);
}

function localizeSharedNotesOverlayPortals(copy: SharedNotesOverlayChromeCopy): void {
  const scope = document.body;
  updateElementText(scope, '.notes-trash__panel-title', copy.trashDock);
  updateAttribute(scope, '.notes-trash__panel-close', 'aria-label', copy.closeTrashDock);
  for (const count of Array.from(scope.querySelectorAll('.notes-trash__panel-count'))) {
    replaceTrailingTextNode(count, ` ${copy.trashItemsSuffix}`);
  }
  updateElementText(scope, '.notes-trash__panel-body', copy.trashDescription);
  updateElementText(scope, '.notes-trash__empty strong', copy.trashEmptyTitle);
  updateElementText(scope, '.notes-trash__empty span', copy.trashEmptyDescription);
  for (const meta of Array.from(scope.querySelectorAll('.notes-trash-section__meta'))) {
    replaceTrailingTextNode(meta, ` ${copy.deletedNote}${copy.deletedNotesSuffix}`);
  }
  updateAllElementText(scope, '.notes-trash-section__clear', copy.clearTopicTrash);
  updateAllElementText(scope, '.notes-trash-note__actions button:not(.is-danger)', copy.restore);
  updateAllElementText(scope, '.notes-trash-note__actions button.is-danger', copy.deleteNow);

  replaceTextWhenOneOf(scope, '.notes-editor__label', allLocalizedNotesOverlayStrings('notesOverlay.editorEditNote'), copy.editorEditNote);
  replaceTextWhenOneOf(scope, '.notes-editor__label', allLocalizedNotesOverlayStrings('notesOverlay.editorColor'), copy.editorColor);
  replaceTextWhenOneOf(scope, '.notes-editor__label', allLocalizedNotesOverlayStrings('notesOverlay.editorHeadline'), copy.editorHeadline);
  replaceTextWhenOneOf(scope, '.notes-editor__label', allLocalizedNotesOverlayStrings('notesOverlay.editorText'), copy.editorText);
  replaceTextWhenOneOf(scope, '.notes-editor__label', allLocalizedNotesOverlayStrings('notesOverlay.manualPaste'), copy.manualPaste);
  replaceTextWhenOneOf(scope, '.notes-flyout__title', allLocalizedNotesOverlayStrings('notesOverlay.editorRefineNote'), copy.editorRefineNote);
  replaceTextWhenOneOf(scope, '.notes-flyout__title', allLocalizedNotesOverlayStrings('notesOverlay.editorComposeNote'), copy.editorComposeNote);
  replaceTextWhenOneOf(scope, '.notes-flyout__title', allLocalizedNotesOverlayStrings('notesOverlay.manualPasteTitle'), copy.manualPasteTitle);
  updateAttribute(scope, '.notes-flyout--editor .notes-flyout__close', 'aria-label', copy.editorClose);
  updateAttribute(scope, '.notes-flyout--paste .notes-flyout__close', 'aria-label', copy.closePastePanel);
  updateInputPlaceholder(scope, '.notes-editor__field--headline input', copy.editorHeadlinePlaceholder);
  replaceTextWhenOneOf(scope, '.notes-editor__field--headline p', allLocalizedNotesOverlayStrings('notesOverlay.editorHeadlineHelper'), copy.editorHeadlineHelper);
  updateInputPlaceholder(scope, '.notes-editor__field textarea', copy.editorBodyPlaceholder);
  updateInputPlaceholder(scope, '.notes-flyout--paste textarea', copy.pastePanelPlaceholder);
  replaceTextWhenOneOf(scope, '.notes-flyout__footer button', allLocalizedNotesOverlayStrings('notesOverlay.editorCancel'), copy.editorCancel);
  replaceTextWhenOneOf(scope, '.notes-flyout__footer button', allLocalizedNotesOverlayStrings('notesOverlay.editorSave'), copy.editorSave);
  replaceTextWhenOneOf(scope, '.notes-flyout__footer button', allLocalizedNotesOverlayStrings('notesOverlay.createNote'), copy.createNote);

  replaceTextWhenOneOf(scope, '.notes-context-menu__label', ['Paste here', ...allLocalizedNotesOverlayStrings('notesOverlay.pasteNote')], copy.pasteNote);
  replaceTextWhenOneOf(scope, '.notes-context-menu__label', ['New note', ...allLocalizedNotesOverlayStrings('notesOverlay.createNote')], copy.createNote);
}

function localizeSharedNotesNotifications(copy: SharedNotesOverlayChromeCopy): void {
  const exactText = new Map<string, string>([
    ...allLocalizedNotesOverlayStrings('notesOverlay.createFailed').map((value) => [value, copy.createFailed] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.pastedTitle').map((value) => [value, copy.pastedTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.pastedMessage').map((value) => [value, copy.pastedMessage] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.pasteFailed').map((value) => [value, copy.pasteFailed] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.clipboardEmptyTitle').map((value) => [value, copy.clipboardEmptyTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.clipboardEmptyMessage').map((value) => [value, copy.clipboardEmptyMessage] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.clipboardBlockedTitle').map((value) => [value, copy.clipboardBlockedTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.clipboardBlockedMessage').map((value) => [value, copy.clipboardBlockedMessage] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.nothingToCopyTitle').map((value) => [value, copy.nothingToCopyTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.copiedTitle').map((value) => [value, copy.copiedTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.copyFailedTitle').map((value) => [value, copy.copyFailedTitle] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.copyFailedMessage').map((value) => [value, copy.copyFailedMessage] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.deleteFailed').map((value) => [value, copy.deleteFailed] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.restoreFailed').map((value) => [value, copy.restoreFailed] as const),
    ...allLocalizedNotesOverlayStrings('notesOverlay.moveFailed').map((value) => [value, copy.moveFailed] as const),
  ]);
  for (const element of Array.from(document.body.querySelectorAll('[role="status"] p, [role="alert"] p'))) {
    const current = element.textContent?.trim() ?? '';
    const noteBodyLabel = matchLocalizedNotesOverlayParam(current, 'notesOverlay.nothingToCopyMessage', 'label');
    const copiedLabel = matchLocalizedNotesOverlayParam(current, 'notesOverlay.copiedMessage', 'label');
    const next = noteBodyLabel
      ? copy.nothingToCopyMessage(noteBodyLabel)
      : copiedLabel
        ? copy.copiedMessage(copiedLabel)
        : exactText.get(current);
    if (next && element.textContent !== next) {
      element.textContent = next;
    }
  }
}
