package accessgate

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type RPCAccessPolicy int

const (
	RPCAccessProtected RPCAccessPolicy = iota
	RPCAccessPublic
)

func RequireRPC(gate *Gate, meta *session.Meta, policy RPCAccessPolicy) error {
	if gate == nil || !gate.Enabled() || policy == RPCAccessPublic {
		return nil
	}
	if meta == nil || !gate.IsChannelUnlocked(strings.TrimSpace(meta.ChannelID)) {
		return &sessionrpc.Error{Code: 423, Message: "access password required"}
	}
	return nil
}

func RegisterTyped[TReq any, TResp any](r *sessionrpc.Router, typeID uint32, gate *Gate, meta *session.Meta, policy RPCAccessPolicy, h func(ctx context.Context, req *TReq) (*TResp, error)) {
	if r == nil {
		return
	}
	r.Register(typeID, func(ctx context.Context, payload json.RawMessage) (json.RawMessage, *sessionrpc.Error) {
		var req TReq
		if len(payload) != 0 {
			if err := json.Unmarshal(payload, &req); err != nil {
				return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
			}
		}
		if err := RequireRPC(gate, meta, policy); err != nil {
			return nil, err.(*sessionrpc.Error)
		}
		resp, err := h(ctx, &req)
		if err != nil {
			var applicationErr *sessionrpc.Error
			if errors.As(err, &applicationErr) {
				return nil, applicationErr
			}
			return nil, &sessionrpc.Error{Code: 500, Message: err.Error()}
		}
		var zeroResp TResp
		if resp == nil {
			resp = &zeroResp
		}
		b, err := json.Marshal(resp)
		if err != nil {
			return nil, &sessionrpc.Error{Code: 500, Message: err.Error()}
		}
		return b, nil
	})
}
