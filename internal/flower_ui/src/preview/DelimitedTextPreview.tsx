import type { RegisterPreviewSearch } from './previewSearch';
import type { JSX } from 'solid-js';
import type { TaskFilesCopy } from '../taskFilesCopy';
import { SpreadsheetPreview } from './SpreadsheetPreview';

export function delimitedFormat(name: string): 'csv' | 'tsv' | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension === 'csv' || extension === 'tsv' ? extension : undefined;
}

export function DelimitedTextPreview(props: {
  active?: boolean; registerSearch?: RegisterPreviewSearch;
  bytes: Uint8Array<ArrayBuffer>; format: 'csv' | 'tsv'; copy: TaskFilesCopy;
  source: JSX.Element; editing?: boolean; truncated?: boolean; allowLocalWheel?: boolean;
}) {
  return <SpreadsheetPreview {...props} />;
}
