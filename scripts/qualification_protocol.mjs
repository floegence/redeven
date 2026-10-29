// Network control endpoints expose counts, never arbitrary evidence payloads.
// Reject coercible strings/objects, negative values and unsafe integer ranges.
export function qualificationCounter(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid qualification counter');
  }
  return Number(value);
}

export function qualificationResources(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid qualification resources');
  const result = { heap_alloc: qualificationCounter(value.heap_alloc), heap_inuse: qualificationCounter(value.heap_inuse), sys: qualificationCounter(value.sys), goroutines: qualificationCounter(value.goroutines) };
  for (const name of ['fixture', 'connector']) {
    if (value[name + '_rss_error'] !== undefined) throw new Error('Qualification process memory unavailable');
    if (value[name + '_pid'] !== undefined) {
      result[name + '_pid'] = qualificationCounter(value[name + '_pid']);
      result[name + '_rss_bytes'] = qualificationCounter(value[name + '_rss_bytes']);
    }
  }
  return result;
}
