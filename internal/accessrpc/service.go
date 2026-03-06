package accessrpc

import (
	"context"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	TypeIDAccessStatus uint32 = 4501
	TypeIDAccessResume uint32 = 4502
)

type StatusResponse struct {
	PasswordRequired bool   `json:"password_required"`
	Unlocked         bool   `json:"unlocked"`
	FloeApp          string `json:"floe_app,omitempty"`
	CodeSpaceID      string `json:"code_space_id,omitempty"`
	SessionKind      string `json:"session_kind,omitempty"`
}

type ResumeRequest struct {
	Token string `json:"token"`
}

type ResumeResponse struct {
	Unlocked bool `json:"unlocked"`
}

type Service struct {
	gate *accessgate.Gate
}

func New(gate *accessgate.Gate) *Service {
	return &Service{gate: gate}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	if s == nil || r == nil {
		return
	}
	accessgate.RegisterTyped[struct{}, StatusResponse](r, TypeIDAccessStatus, s.gate, meta, accessgate.RPCAccessPublic, func(_ctx context.Context, _ *struct{}) (*StatusResponse, error) {
		status := accessgate.Status{}
		if s.gate != nil && meta != nil {
			status = s.gate.Status(strings.TrimSpace(meta.ChannelID))
		}
		return &StatusResponse{
			PasswordRequired: status.PasswordRequired,
			Unlocked:         status.Unlocked,
			FloeApp:          status.FloeApp,
			CodeSpaceID:      status.CodeSpaceID,
			SessionKind:      status.SessionKind,
		}, nil
	})
	accessgate.RegisterTyped[ResumeRequest, ResumeResponse](r, TypeIDAccessResume, s.gate, meta, accessgate.RPCAccessPublic, func(_ctx context.Context, req *ResumeRequest) (*ResumeResponse, error) {
		if s.gate == nil || !s.gate.Enabled() {
			return &ResumeResponse{Unlocked: true}, nil
		}
		if meta == nil {
			return nil, &rpc.Error{Code: 500, Message: "missing session metadata"}
		}
		if err := s.gate.ResumeChannel(strings.TrimSpace(meta.ChannelID), req.Token); err != nil {
			return nil, &rpc.Error{Code: 401, Message: err.Error()}
		}
		return &ResumeResponse{Unlocked: true}, nil
	})
}
