import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { writeTextToClipboard } from './clipboard';

type CopiedFileBrowserValuesResult = {
  count: number;
  firstValue: string;
};

function collectCopyableFileBrowserValues(
  items: FileItem[],
  pickValue: (item: FileItem) => string,
): string[] {
  return items
    .map((item) => pickValue(item).trim())
    .filter((value) => value.length > 0);
}

async function copyFileBrowserItemValues(
  items: FileItem[],
  pickValue: (item: FileItem) => string,
  missingValueMessage: string,
): Promise<CopiedFileBrowserValuesResult> {
  const values = collectCopyableFileBrowserValues(items, pickValue);

  if (values.length <= 0) {
    throw new Error(missingValueMessage);
  }

  await writeTextToClipboard(values.join('\n'));

  return {
    count: values.length,
    firstValue: values[0]!,
  };
}

function describeCopiedFileBrowserValues(result: CopiedFileBrowserValuesResult, pluralLabel: string): string {
  if (result.count === 1) {
    return `"${result.firstValue}" copied to clipboard.`;
  }
  return `${result.count} ${pluralLabel} copied to clipboard.`;
}

export type CopiedFileBrowserNamesResult = {
  count: number;
  firstName: string;
};

export async function copyFileBrowserItemNames(items: FileItem[]): Promise<CopiedFileBrowserNamesResult> {
  const result = await copyFileBrowserItemValues(
    items,
    (item) => String(item.name ?? ''),
    'No file or folder name available to copy.',
  );

  return {
    count: result.count,
    firstName: result.firstValue,
  };
}

export type CopiedFileBrowserPathsResult = {
  count: number;
  firstPath: string;
};

export async function copyFileBrowserItemPaths(items: FileItem[]): Promise<CopiedFileBrowserPathsResult> {
  const result = await copyFileBrowserItemValues(
    items,
    (item) => String(item.path ?? ''),
    'No absolute file or folder path available to copy.',
  );

  return {
    count: result.count,
    firstPath: result.firstValue,
  };
}

export function describeCopiedFileBrowserItemNames(result: CopiedFileBrowserNamesResult): string {
  return describeCopiedFileBrowserValues(
    {
      count: result.count,
      firstValue: result.firstName,
    },
    'names',
  );
}

export function describeCopiedFileBrowserItemPaths(result: CopiedFileBrowserPathsResult): string {
  return describeCopiedFileBrowserValues(
    {
      count: result.count,
      firstValue: result.firstPath,
    },
    'paths',
  );
}
