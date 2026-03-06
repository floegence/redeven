export type wire_access_status_req = Record<string, never>;

export type wire_access_status_resp = {
  password_required: boolean;
  unlocked: boolean;
  floe_app?: string;
  code_space_id?: string;
  session_kind?: string;
};

export type wire_access_resume_req = {
  token: string;
};

export type wire_access_resume_resp = {
  unlocked: boolean;
};
