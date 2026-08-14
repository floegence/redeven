export function createFlowerClientRequestID(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure Flower request identity generation is unavailable.');
  }
  return `client_${crypto.randomUUID()}`;
}
