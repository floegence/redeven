export const DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER = 'X-Redeven-Desktop-Bridge-Token';

export function normalizeDesktopPrivateBridgeToken(value: unknown): string {
  const token = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    return '';
  }
  const decoded = Buffer.from(token, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === token ? token : '';
}
