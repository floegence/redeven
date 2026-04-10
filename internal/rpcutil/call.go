package rpcutil

import (
	"context"
	"encoding/json"

	rpcwirev1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/rpc/v1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
)

type Caller interface {
	Call(ctx context.Context, typeID uint32, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError, error)
}

// CallJSON performs an RPC request with JSON encoding using the stable rpc.Client surface.
func CallJSON[TReq any, TResp any](ctx context.Context, caller Caller, typeID uint32, req *TReq) (*TResp, error) {
	var zeroReq TReq
	if req == nil {
		req = &zeroReq
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	respPayload, rpcErr, err := caller.Call(ctx, typeID, payload)
	if err != nil {
		return nil, err
	}
	if rpcErr != nil {
		return nil, rpc.NewCallError(typeID, rpcErr)
	}

	var resp TResp
	if len(respPayload) != 0 {
		if err := json.Unmarshal(respPayload, &resp); err != nil {
			return nil, err
		}
	}
	return &resp, nil
}
