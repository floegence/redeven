export type DesktopRuntimeControlEndpoint = Readonly<{
  protocol_version: string;
  base_url: string;
  token: string;
  desktop_owner_id: string;
  expires_at_unix_ms?: number;
}>;
