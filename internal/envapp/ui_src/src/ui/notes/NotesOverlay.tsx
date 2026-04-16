import {
  NotesOverlay as SharedNotesOverlay,
  type NotesOverlayProps as SharedNotesOverlayProps,
} from '@floegence/floe-webapp-core/notes';
import { createEffect, createMemo, onCleanup } from 'solid-js';
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
