export type ActiveSession = {
  channelId: string;

  userPublicID: string;
  userEmail: string;

  floeApp: string;
  codeSpaceID?: string;
  sessionKind?: string;
  tunnelUrl: string;

  createdAtUnixMs: number;
  connectedAtUnixMs: number;

  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
};

export type SessionsListActiveResponse = {
  sessions: ActiveSession[];
};
