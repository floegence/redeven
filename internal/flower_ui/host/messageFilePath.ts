/** Bounded, authenticated previews; HTML is returned as inert text by the Runtime. */
export function messageFilePath(path: string): string {
  return `/_redeven_proxy/api/fs/file?${new URLSearchParams({ path, preview: '1' })}`;
}
