import { secureRandomUUID } from '@floegence/floe-webapp-core';
export function createFlowerClientRequestID(): string {
  return `client_${secureRandomUUID()}`;
}
