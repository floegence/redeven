import type { AccessResumeRequest, AccessResumeResponse, AccessStatusResponse } from '../sdk/access';
import type { wire_access_resume_req, wire_access_resume_resp, wire_access_status_resp } from '../wire/access';

export function fromWireAccessStatusResponse(resp: wire_access_status_resp): AccessStatusResponse {
  return {
    passwordRequired: !!resp?.password_required,
    unlocked: !!resp?.unlocked,
    floeApp: resp?.floe_app ? String(resp.floe_app) : undefined,
    codeSpaceId: resp?.code_space_id ? String(resp.code_space_id) : undefined,
    sessionKind: resp?.session_kind ? String(resp.session_kind) : undefined,
  };
}

export function toWireAccessResumeRequest(req: AccessResumeRequest): wire_access_resume_req {
  return {
    token: String(req?.token ?? '').trim(),
  };
}

export function fromWireAccessResumeResponse(resp: wire_access_resume_resp): AccessResumeResponse {
  return {
    unlocked: !!resp?.unlocked,
  };
}
