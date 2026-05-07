import { For, Show, type JSX } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import type { FilePreviewDescriptor, PreviewMode } from '../utils/filePreview';
import { DocxPreviewPane } from '../widgets/DocxPreviewPane';
import { PdfPreviewPane } from '../widgets/PdfPreviewPane';
import { TextFilePreviewPane } from '../widgets/TextFilePreviewPane';

export type RedevenFilePreviewRendererId =
  | 'text'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'binary'
  | 'unsupported';

export type RedevenFilePreviewRenderProps = Readonly<{
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  text?: string;
  draftText?: string;
  editing?: boolean;
  saveError?: string | null;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
}>;

export type RedevenFilePreviewRenderer = Readonly<{
  id: RedevenFilePreviewRendererId;
  modes: readonly PreviewMode[];
  render: (props: RedevenFilePreviewRenderProps) => JSX.Element;
}>;

function renderTextPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return (
    <TextFilePreviewPane
      path={props.item?.path ?? 'preview.txt'}
      descriptor={props.descriptor}
      text={props.text ?? ''}
      draftText={props.draftText ?? props.text ?? ''}
      truncated={props.truncated}
      editing={props.editing}
      saveError={props.saveError}
      onDraftChange={props.onDraftChange}
      onSelectionChange={props.onSelectionChange}
    />
  );
}

function renderImagePreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return (
    <div class="flex h-full items-center justify-center p-3">
      <img
        src={props.objectUrl}
        alt={props.item?.name ?? 'Preview'}
        class="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

function renderSpreadsheetPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return (
    <div class="p-3">
      <Show when={props.xlsxSheetName}>
        <div class="mb-2 text-[11px] text-muted-foreground">Sheet: {props.xlsxSheetName}</div>
      </Show>

      <div class="overflow-auto rounded-md border border-border">
        <table class="w-full text-xs">
          <tbody>
            <For each={props.xlsxRows ?? []}>
              {(row) => (
                <tr class="border-b border-border last:border-b-0">
                  <For each={row}>
                    {(cell) => (
                      <td class="border-r border-border px-2 py-1 align-top whitespace-pre-wrap break-words last:border-r-0">
                        {cell}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderUnavailablePreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  const binary = () => props.descriptor.mode === 'binary';
  return (
    <div class="p-4 text-sm text-muted-foreground">
      <div class="mb-1 font-medium text-foreground">
        {binary() ? 'Binary file' : 'Preview not available'}
      </div>
      <div class="text-xs">{props.message || 'Preview is not available.'}</div>
    </div>
  );
}

export const REDEVEN_FILE_PREVIEW_RENDERERS: readonly RedevenFilePreviewRenderer[] = [
  {
    id: 'text',
    modes: ['text'],
    render: renderTextPreview,
  },
  {
    id: 'image',
    modes: ['image'],
    render: renderImagePreview,
  },
  {
    id: 'pdf',
    modes: ['pdf'],
    render: (props) => <PdfPreviewPane bytes={props.bytes} />,
  },
  {
    id: 'docx',
    modes: ['docx'],
    render: (props) => <DocxPreviewPane bytes={props.bytes} />,
  },
  {
    id: 'xlsx',
    modes: ['xlsx'],
    render: renderSpreadsheetPreview,
  },
  {
    id: 'binary',
    modes: ['binary'],
    render: renderUnavailablePreview,
  },
  {
    id: 'unsupported',
    modes: ['unsupported'],
    render: renderUnavailablePreview,
  },
] as const;

export function resolveRedevenFilePreviewRenderer(descriptor: FilePreviewDescriptor): RedevenFilePreviewRenderer {
  return REDEVEN_FILE_PREVIEW_RENDERERS.find((renderer) => renderer.modes.includes(descriptor.mode))
    ?? REDEVEN_FILE_PREVIEW_RENDERERS[REDEVEN_FILE_PREVIEW_RENDERERS.length - 1];
}

export function renderRedevenFilePreviewBody(props: RedevenFilePreviewRenderProps): JSX.Element {
  return resolveRedevenFilePreviewRenderer(props.descriptor).render(props);
}
