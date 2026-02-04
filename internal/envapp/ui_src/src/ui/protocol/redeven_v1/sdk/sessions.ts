export type ActiveSession = {
  channelId: string;

  userPublicID: string;
  userEmail: string;

  floeApp: string;
  codeSpaceID?: string;
  tunnelUrl: string;

  createdAtUnixMs: number;
  connectedAtUnixMs: number;

  canReadFiles: boolean;
  canWriteFiles: boolean;
  canExecute: boolean;
};

export type SessionsListActiveResponse = {
  sessions: ActiveSession[];
};
