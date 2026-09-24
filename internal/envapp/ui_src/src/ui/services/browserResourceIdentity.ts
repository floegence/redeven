/** FloeBrowser supplies opaque references, never a source URL to fetch. */
export function browserResourceIdentity(value: string, base: string): { target: string; id: string } {
  const url = new URL(value, base), document = new URL(base);
  const target = url.searchParams.get('browser_target'), id = url.searchParams.get('browser_resource');
  if (url.origin !== document.origin || url.pathname !== document.pathname || url.username || url.password || url.hash
    || url.searchParams.size !== 2 || !target || !id) throw new Error('Invalid browser resource');
  return { target, id };
}
