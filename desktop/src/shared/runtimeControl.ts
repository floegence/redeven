export type DesktopRuntimeControlEndpoint = Readonly<{
  protocol_version: string;
  // IMPORTANT: This is the runtime-control service root, not just an origin.
  // Bridge-backed runtimes may expose runtime-control under a path prefix, so
  // Desktop callers must resolve API routes relative to this root.
  base_url: string;
  token: string;
  desktop_owner_id: string;
  expires_at_unix_ms?: number;
}>;
