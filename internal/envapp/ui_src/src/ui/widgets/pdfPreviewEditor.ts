/** Product persistence boundary. Rendering and PDF serialization belong upstream. */
export interface PdfPreviewEditor {
  sourceBytes: Uint8Array<ArrayBuffer>;
  save: () => Promise<Uint8Array<ArrayBuffer>>;
}

export interface PdfPreviewEditorBinding {
  markDirty: () => void;
  dispose: () => void;
}

export type BindPdfPreviewEditor = (editor: PdfPreviewEditor) => PdfPreviewEditorBinding;
