package accessgate

import (
	"context"
	"encoding/json"
	"strings"

	rpcwirev1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/rpc/v1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/session"
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
		return &rpc.Error{Code: 423, Message: "access password required"}
	}
	return nil
}

func RegisterTyped[TReq any, TResp any](r *rpc.Router, typeID uint32, gate *Gate, meta *session.Meta, policy RPCAccessPolicy, h func(ctx context.Context, req *TReq) (*TResp, error)) {
	if r == nil {
		return
	}
	r.Register(typeID, func(ctx context.Context, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError) {
		var req TReq
		if len(payload) != 0 {
			if err := json.Unmarshal(payload, &req); err != nil {
				return nil, rpc.ToWireError(&rpc.Error{Code: 400, Message: "invalid payload"})
			}
		}
		if err := RequireRPC(gate, meta, policy); err != nil {
			return nil, rpc.ToWireError(err)
		}
		resp, err := h(ctx, &req)
		if err != nil {
			return nil, rpc.ToWireError(err)
		}
		var zeroResp TResp
		if resp == nil {
			resp = &zeroResp
		}
		b, err := json.Marshal(resp)
		if err != nil {
			return nil, rpc.ToWireError(err)
		}
		return b, nil
	})
}
