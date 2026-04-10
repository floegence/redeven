import { useNotification } from '@floegence/floe-webapp-core';
import {
  NotesOverlay as SharedNotesOverlay,
  type NotesOverlayProps as SharedNotesOverlayProps,
} from '@floegence/floe-webapp-core/notes';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { writeTextToClipboard } from '../utils/clipboard';
import { useRedevenNotesController } from './createRedevenNotesController';
import {
  normalizeNoteCopyText,
  numberNotesInTopic,
  resolveNoteDigitSequence,
  type NumberedNote,
} from './notesNumbering';
import { createNotesOverlayViewportController } from './notesOverlayViewport';

export interface NotesOverlayProps {
  open: boolean;
  onClose: () => void;
  viewportHost?: HTMLElement | null;
  /** Shell-owned toggle shortcut that must remain available while floating Notes is focused. */
  toggleKeybind?: string;
}

const NOTES_FLOATING_OVERLAY_SELECTOR = '.notes-overlay[data-notes-interaction-mode="floating"]';
const NOTES_FLOATING_NOTE_SELECTOR = '[data-floe-notes-note-id]';
const NOTES_SHORTCUT_BLOCKER_SELECTOR =
  '.notes-flyout--editor, .notes-flyout--paste, .notes-topic-row__editor, .notes-context-menu';
const NOTES_TYPING_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
const NOTE_SHORTCUT_PENDING_TIMEOUT_MS = 650;
const NOTE_SHORTCUT_COPIED_TIMEOUT_MS = 1100;

function resolveFloatingOverlayRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const overlays = document.querySelectorAll<HTMLElement>(NOTES_FLOATING_OVERLAY_SELECTOR);
  return overlays.length > 0 ? overlays.item(overlays.length - 1) : null;
}

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return Boolean(asElement(target)?.closest(NOTES_TYPING_TARGET_SELECTOR));
}

function hasShortcutBlocker(root: ParentNode | null): boolean {
  return Boolean(root?.querySelector(NOTES_SHORTCUT_BLOCKER_SELECTOR));
}

function isModifierOnlyKey(event: KeyboardEvent): boolean {
  return event.key === 'Shift' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Control';
}

function resolveDigitKey(event: KeyboardEvent): string | null {
  return /^\d$/.test(event.key) ? event.key : null;
}

export function NotesOverlay(props: NotesOverlayProps) {
  const notify = useNotification();
  const controller = useRedevenNotesController(() => props.open);
  const viewportController = createNotesOverlayViewportController();
  const allowGlobalHotkeys = createMemo<readonly string[] | undefined>(() => {
    const keybind = props.toggleKeybind?.trim();
    return keybind ? [keybind] : undefined;
  });
  const numberedNotes = createMemo(() =>
    numberNotesInTopic(controller.snapshot(), controller.activeTopicID()),
  );
  const noteNumbersByID = createMemo(
    () => new Map(numberedNotes().map((entry) => [entry.note.note_id, entry.label])),
  );
  const [keyboardPrimed, setKeyboardPrimed] = createSignal(false);
  const [pendingDigits, setPendingDigits] = createSignal('');
  const [copiedNoteID, setCopiedNoteID] = createSignal<string | null>(null);
  let copiedTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let pendingTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  function clearCopiedFlash(): void {
    if (copiedTimer !== undefined) {
      globalThis.clearTimeout(copiedTimer);
      copiedTimer = undefined;
    }
    setCopiedNoteID(null);
  }

  function flashCopiedNote(noteID: string): void {
    if (copiedTimer !== undefined) {
      globalThis.clearTimeout(copiedTimer);
    }

    setCopiedNoteID(noteID);
    copiedTimer = globalThis.setTimeout(() => {
      copiedTimer = undefined;
      setCopiedNoteID((current) => (current === noteID ? null : current));
    }, NOTE_SHORTCUT_COPIED_TIMEOUT_MS);
  }

  function clearPendingShortcutSequence(): void {
    if (pendingTimer !== undefined) {
      globalThis.clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    setPendingDigits('');
  }

  async function copyNoteEntry(entry: NumberedNote): Promise<void> {
    clearPendingShortcutSequence();

    const text = normalizeNoteCopyText(entry.note.body);
    if (!text) {
      notify.info('Nothing to copy', `Note #${entry.label} is empty.`);
      return;
    }

    try {
      await writeTextToClipboard(text);
      flashCopiedNote(entry.note.note_id);
      notify.success('Copied', `Note #${entry.label} copied to clipboard.`);
    } catch (error) {
      notify.error('Copy failed', error instanceof Error ? error.message : String(error));
    }
  }

  function schedulePendingShortcutSequence(sequence: string): void {
    if (pendingTimer !== undefined) {
      globalThis.clearTimeout(pendingTimer);
    }

    setPendingDigits(sequence);
    pendingTimer = globalThis.setTimeout(() => {
      pendingTimer = undefined;
      if (pendingDigits() !== sequence) return;

      setPendingDigits('');
      const resolution = resolveNoteDigitSequence(sequence, numberedNotes());
      if (resolution.kind === 'ready') {
        void copyNoteEntry(resolution.match);
        return;
      }
      if (resolution.kind === 'pending' && resolution.exactMatch) {
        void copyNoteEntry(resolution.exactMatch);
      }
    }, NOTE_SHORTCUT_PENDING_TIMEOUT_MS);
  }

  function handleShortcutResolution(sequence: string): boolean {
    const resolution = resolveNoteDigitSequence(sequence, numberedNotes());
    if (resolution.kind === 'invalid') {
      return false;
    }
    if (resolution.kind === 'ready') {
      clearPendingShortcutSequence();
      void copyNoteEntry(resolution.match);
      return true;
    }

    schedulePendingShortcutSequence(sequence);
    return true;
  }

  function handleDigitShortcut(digit: string): void {
    const currentSequence = pendingDigits();
    const nextSequence = `${currentSequence}${digit}`;
    if (handleShortcutResolution(currentSequence ? nextSequence : digit)) {
      return;
    }

    if (!currentSequence || digit === '0') {
      clearPendingShortcutSequence();
      return;
    }

    if (!handleShortcutResolution(digit)) {
      clearPendingShortcutSequence();
    }
  }

  function syncDecoratedNotes(): void {
    const root = resolveFloatingOverlayRoot();
    if (!root) return;

    const labelsByID = noteNumbersByID();
    const copied = copiedNoteID();
    const pending = pendingDigits();

    for (const noteElement of root.querySelectorAll<HTMLElement>(NOTES_FLOATING_NOTE_SELECTOR)) {
      const noteID = String(noteElement.dataset.floeNotesNoteId ?? '').trim();
      const label = labelsByID.get(noteID);
      if (label) {
        noteElement.dataset.redevenNoteIndex = label;
      } else {
        delete noteElement.dataset.redevenNoteIndex;
      }

      noteElement.classList.toggle('is-redeven-copied', copied === noteID);
      noteElement.classList.toggle('is-redeven-shortcut-pending', pending.length > 0 && label === pending);
    }
  }

  createEffect(() => {
    viewportController.setViewportHostElement(props.viewportHost ?? null);
  });

  createEffect(() => {
    viewportController.setActive(props.open);
  });

  createEffect(() => {
    if (props.open) return;
    clearPendingShortcutSequence();
    clearCopiedFlash();
    setKeyboardPrimed(false);
  });

  createEffect(() => {
    const pending = pendingDigits();
    if (!pending) return;
    if (resolveNoteDigitSequence(pending, numberedNotes()).kind === 'invalid') {
      clearPendingShortcutSequence();
    }
  });

  createEffect(() => {
    const copied = copiedNoteID();
    if (!copied) return;
    if (!controller.snapshot().items.some((item) => item.note_id === copied)) {
      clearCopiedFlash();
    }
  });

  createEffect(() => {
    if (!props.open) return;

    noteNumbersByID();
    pendingDigits();
    copiedNoteID();

    const sync = () => {
      syncDecoratedNotes();
    };

    sync();
    const timer = globalThis.setTimeout(sync, 0);
    const frame =
      typeof window !== 'undefined' ? window.requestAnimationFrame(sync) : null;

    onCleanup(() => {
      globalThis.clearTimeout(timer);
      if (frame !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frame);
      }
    });
  });

  createEffect(() => {
    if (!props.open || typeof document === 'undefined') return;

    const handlePointerDown = (event: Event) => {
      const root = resolveFloatingOverlayRoot();
      const insideOverlay = Boolean(root && event.target instanceof Node && root.contains(event.target));
      setKeyboardPrimed(insideOverlay);
      if (!insideOverlay) {
        clearPendingShortcutSequence();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const root = resolveFloatingOverlayRoot();
      const insideOverlay = Boolean(root && event.target instanceof Node && root.contains(event.target));
      setKeyboardPrimed(insideOverlay);
      if (!insideOverlay) {
        clearPendingShortcutSequence();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const digit = resolveDigitKey(event);
      if (!digit) {
        if (!isModifierOnlyKey(event)) {
          clearPendingShortcutSequence();
        }
        return;
      }

      const root = resolveFloatingOverlayRoot();
      const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
      const activeInsideOverlay =
        activeElement instanceof Element && Boolean(root?.contains(activeElement));
      const allowPrimedBodyTarget =
        keyboardPrimed() &&
        (!activeElement || activeElement === document.body || activeElement === document.documentElement);

      const shouldHandle =
        Boolean(root) &&
        !event.defaultPrevented &&
        !event.repeat &&
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTypingTarget(event.target) &&
        !isTypingTarget(activeElement) &&
        !hasShortcutBlocker(root) &&
        (activeInsideOverlay || allowPrimedBodyTarget);

      if (!shouldHandle) {
        clearPendingShortcutSequence();
        return;
      }

      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      } else {
        event.stopPropagation();
      }
      handleDigitShortcut(digit);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('keydown', handleKeyDown, true);

    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    });
  });

  onCleanup(() => {
    clearPendingShortcutSequence();
    clearCopiedFlash();
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
