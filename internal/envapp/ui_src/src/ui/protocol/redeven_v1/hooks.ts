import { useRpc } from '@floegence/floe-webapp-protocol';
import type { RedevenV1Rpc } from './contract';

export function useRedevenRpc() {
  return useRpc<RedevenV1Rpc>();
}
