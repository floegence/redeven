export type AccessStatusResponse = {
  passwordRequired: boolean;
  unlocked: boolean;
  floeApp?: string;
  codeSpaceId?: string;
  sessionKind?: string;
};

export type AccessResumeRequest = {
  token: string;
};

export type AccessResumeResponse = {
  unlocked: boolean;
};
