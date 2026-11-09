import { children, type JSX } from 'solid-js';
import { createRetainedContent } from '@floegence/floe-webapp-core';
import { DialogPlacementProvider } from '@floegence/floe-webapp-core/ui';
import { FlowerContextDialog } from '../../flower_ui/src/FlowerContextDialog';
import './settings-dialog.css';

type SettingsDialogProps = {
  globalZIndex?: number; open: boolean; present: boolean; title: string; closeLabel: string;
  header?: JSX.Element;
  closeOnBackdropClick?: boolean;
  onClose: () => void; onPresenceChange: (present: boolean) => void; children: JSX.Element;
};

export function SettingsDialog(props: SettingsDialogProps) {
  return <DialogPlacementProvider mode="global" globalZIndex={props.globalZIndex}>
    <RetainedSettingsDialog {...props} />
  </DialogPlacementProvider>;
}

function RetainedSettingsDialog(props: SettingsDialogProps) {
  // IMPORTANT: Create the retained owner inside the placement provider. DOM
  // placement cannot transfer Solid context; nested dialogs need this same
  // global modal stack even while their original controls are retained.
  // IMPORTANT: Retain one stable DOM root. Conditional top-level siblings are
  // resolved at placement time; later errors/categories must update inside it.
  const Content = createRetainedContent(() => <div class="redeven-unified-settings-dialog-root">{props.children}</div>);
  // IMPORTANT: Header controls share the retained page owner. Floe's published
  // custom header slot keeps the accessible title and owns modal behavior.
  // IMPORTANT: Resolve the slot once. Reading a JSX getter for both presence
  // and content creates two control owners and duplicates controlled popups.
  const header = children(() => props.header);
  const Header = header() === undefined ? undefined : createRetainedContent(() => <div class="redeven-unified-settings-dialog-header">{header()}</div>);
  return <FlowerContextDialog globalZIndex={props.globalZIndex} open={props.open} onOpenChange={open => { if (!open) props.onClose(); }} onPresenceChange={props.onPresenceChange}
        title={props.title} closeLabel={props.closeLabel} header={Header ? <Header /> : undefined} closeOnBackdropClick={props.closeOnBackdropClick ?? false}
        class="redeven-unified-settings-dialog" contentClass="redeven-unified-settings-dialog-content">
        <Content />
      </FlowerContextDialog>;
}
