import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import { FlowerTaskFilePreview } from '../../../internal/flower_ui/src/FlowerTaskFilePreview';
import { FlowerAttachmentPreviewWindow } from '../../../internal/flower_ui/src/attachments/FlowerAttachmentPreviewWindow';
import { taskFilesEnUS } from '../../../internal/flower_ui/src/taskFilesCopy';
import '../../src/welcome/index.css';

type Preview = { name: string; mime: string; bytes: number[]; attachment?: boolean };
declare global { interface Window { officePreview: { open: (input: Preview) => void; close: () => void } } }
const [preview, setPreview] = createSignal<Preview>();
window.officePreview = { open: setPreview, close: () => setPreview(undefined) };
const source = (value: Preview) => {
  return { id: value.name, name: value.name, mimeType: value.mime,
    load: async () => new Blob([new Uint8Array(value.bytes)], { type: value.mime }) };
};
render(() => <>
  <FlowerAttachmentPreviewWindow source={preview()?.attachment ? source(preview()!) : null} copy={taskFilesEnUS}
    loadingLabel={taskFilesEnUS.loading} unavailableLabel={taskFilesEnUS.unsupported} onClose={window.officePreview.close} />
  <Show when={preview() && !preview()!.attachment ? preview() : undefined} keyed>{value =>
    <FlowerTaskFilePreview source={source(value)} copy={taskFilesEnUS} downloading={false} onClose={window.officePreview.close} />
  }</Show>
</>, document.getElementById('root')!);
