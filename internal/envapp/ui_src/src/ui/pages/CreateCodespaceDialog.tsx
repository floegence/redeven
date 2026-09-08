import { Show, createEffect, createSignal } from 'solid-js';
import { Button, DirectoryInput, Input, type PickerPanelProps } from '@floegence/floe-webapp-core/ui';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Dialog } from '../primitives/EnvAppModal';
import { useI18n } from '../i18n';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export function CreateCodespaceDialog(props: {
  open: boolean;
  loading: boolean;
  pickerProps: PickerPanelProps;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string, name: string, description: string) => void;
}) {
  const [selectedPath, setSelectedPath] = createSignal("");
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [pathValid, setPathValid] = createSignal(false);
  let nameEdited = false;
  let descriptionEdited = false;
  const outlineControlClass = redevenSurfaceRoleClass("control");
  const i18n = useI18n();

  createEffect(() => {
    if (props.open) return;
    setSelectedPath("");
    setName("");
    setDescription("");
    setPathValid(false);
    nameEdited = false;
    descriptionEdited = false;
  });
  const handleOpenChange = (open: boolean) => {
    if (props.loading) return;
    props.onOpenChange(open);
  };

  const handlePathChange = (path: string) => {
    setSelectedPath(path);
    // Successful navigation supplies defaults until each field is edited.
    const segments = path.split("/").filter(Boolean);
    const defaultName = segments[segments.length - 1] || props.pickerProps.copy?.root || "/";
    if (!nameEdited) setName(defaultName);
    if (!descriptionEdited) setDescription(i18n.t("codespaces.dialog.autoDescription", { path }));
  };

  const handleCreate = () => {
    if (props.loading || !pathValid() || !selectedPath()) return;
    props.onCreate(selectedPath(), name().trim(), description().trim());
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={i18n.t("codespaces.dialog.createTitle")}
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading} class={outlineControlClass}>
            {i18n.t("codespaces.actions.cancel")}
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={props.loading || !pathValid() || !selectedPath()}>
            <Show when={props.loading}>
              <SnakeLoader size="sm" />
            </Show>
            {i18n.t("codespaces.actions.create")}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.directory")}</label>
          <DirectoryInput
            value={selectedPath()}
            onChange={handlePathChange}
            {...props.pickerProps}
            open={props.open}
            disabled={props.loading}
            onValidityChange={setPathValid}
            placeholder={i18n.t("codespaces.dialog.directoryPlaceholder")}
            size="sm"
          />
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.name")}</label>
          <Input
            value={name()}
            disabled={props.loading}
            onInput={(e) => { nameEdited = true; setName(e.currentTarget.value); }}
            placeholder={i18n.t("codespaces.dialog.namePlaceholder")}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t("codespaces.dialog.nameHelp")}</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.description")}</label>
          <Input
            value={description()}
            disabled={props.loading}
            onInput={(e) => { descriptionEdited = true; setDescription(e.currentTarget.value); }}
            placeholder={i18n.t("codespaces.dialog.descriptionPlaceholder")}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t("codespaces.dialog.descriptionHelp")}</p>
        </div>
      </div>
    </Dialog>
  );
}
