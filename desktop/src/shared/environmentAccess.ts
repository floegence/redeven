export type EnvironmentAccessRoute = Readonly<{
  id: string;
  environment_id: string;
  kind: 'direct' | 'gateway_proxy' | 'direct_url';
  label: string;
  gateway_id?: string;
  gateway_label?: string;
  is_open: boolean;
}>;
