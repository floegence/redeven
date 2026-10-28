export function messageAttachmentPath(source: string): string {
  const parsed = new URL(source, 'http://flower.local');
  if (source.startsWith('/_redeven_proxy/api/ai/threads/') && parsed.origin === 'http://flower.local' && !parsed.search && !parsed.hash
    && /^\/_redeven_proxy\/api\/ai\/threads\/[A-Za-z0-9_-]+\/tool-media\/locator\/[a-f0-9]{64}$/u.test(parsed.pathname)) return parsed.pathname;
  const keys = [...parsed.searchParams.keys()];
  const scopeKeys = ['turn_id', 'queue_id'].filter((key) => parsed.searchParams.has(key));
  if (!source.startsWith('/_redeven_proxy/api/ai/uploads/')
    || parsed.origin !== 'http://flower.local' || parsed.hash
    || !/^\/_redeven_proxy\/api\/ai\/uploads\/upl_[A-Za-z0-9_-]+$/u.test(parsed.pathname)
    || scopeKeys.length !== 1
    || !keys.every((key) => ['thread_id', scopeKeys[0], 'preview'].includes(key))
    || !['thread_id', scopeKeys[0]].every((key) => {
      const values = parsed.searchParams.getAll(key!);
      return values.length === 1 && Boolean(values[0]!.trim()) && !/[\r\n\0]/u.test(values[0]!);
    })
    || parsed.searchParams.getAll('preview').length > 1
    || (parsed.searchParams.has('preview') && parsed.searchParams.get('preview') !== '1')) {
    throw new Error('Invalid Flower attachment preview URL.');
  }
  parsed.searchParams.set('preview', '1');
  return `${parsed.pathname}${parsed.search}`;
}
