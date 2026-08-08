package rpcutil

import (
	"context"
)

type Caller interface {
	Call(ctx context.Context, typeID uint32, request, response any) error
}

// CallJSON performs an RPC request with JSON encoding using the stable rpc.Client surface.
func CallJSON[TReq any, TResp any](ctx context.Context, caller Caller, typeID uint32, req *TReq) (*TResp, error) {
	var zeroReq TReq
	if req == nil {
		req = &zeroReq
	}

	var resp TResp
	if err := caller.Call(ctx, typeID, req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
