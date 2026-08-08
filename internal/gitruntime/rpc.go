package gitruntime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	ErrorResponseBudget uint32 = 41305
	ErrorResourceLimit  uint32 = 41306
	ErrorRequestBudget  uint32 = 41307
)

type RequestSpec[T any] struct {
	Validate func(*T) error
}

type ResponseSpec[T any] struct {
	RetainedBytes func(*T) (int64, error)
}

type RPCSpec[TReq any, TResp any] struct {
	Request  RequestSpec[TReq]
	Response ResponseSpec[TResp]
}

func DefaultRPCSpec[TReq any, TResp any]() RPCSpec[TReq, TResp] {
	return RPCSpec[TReq, TResp]{
		Response: ResponseSpec[TResp]{
			RetainedBytes: func(resp *TResp) (int64, error) {
				return retainedBytes(resp, maxRetainedResponseBytes)
			},
		},
	}
}

// RegisterTyped applies the closed Git-domain request and response budgets.
// The decode reservation remains held until the handler and response guard
// finish, so the decoded DTO cannot outlive its admission.
func RegisterTyped[TReq any, TResp any](
	router *sessionrpc.Router,
	typeID uint32,
	runtime *Runtime,
	spec RPCSpec[TReq, TResp],
	gate *accessgate.Gate,
	meta *session.Meta,
	policy accessgate.RPCAccessPolicy,
	handler func(context.Context, *TReq) (*TResp, error),
) {
	if router == nil {
		return
	}
	router.Register(typeID, func(ctx context.Context, payload json.RawMessage) (json.RawMessage, *sessionrpc.Error) {
		if runtime == nil || spec.Response.RetainedBytes == nil || handler == nil {
			return responseBudgetWireError()
		}
		decodeAdmission, err := runtime.AcquireRequestDecode(ctx)
		if err != nil {
			return requestBudgetWireError()
		}
		defer decodeAdmission.Release()
		if err := validateRawJSON(payload); err != nil {
			return requestBudgetWireError()
		}

		var req TReq
		if len(payload) != 0 {
			if err := decodeStrict(payload, &req); err != nil {
				return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
			}
		}
		if _, err := retainedBytes(&req, maxRetainedRequestBytes); err != nil {
			return requestBudgetWireError()
		}
		if spec.Request.Validate != nil {
			if err := spec.Request.Validate(&req); err != nil {
				return requestBudgetWireError()
			}
		}
		if err := accessgate.RequireRPC(gate, meta, policy); err != nil {
			return guardErrorEnvelope(typeID, err)
		}

		responseAdmission, err := runtime.AcquireResponseBuild(ctx)
		if err != nil {
			return responseBudgetWireError()
		}
		defer responseAdmission.Release()
		resp, err := handler(ctx, &req)
		if err != nil {
			return guardErrorEnvelope(typeID, err)
		}
		var zero TResp
		if resp == nil {
			resp = &zero
		}
		retained, err := spec.Response.RetainedBytes(resp)
		if err != nil || retained < 0 || retained > maxRetainedResponseBytes {
			return responseBudgetWireError()
		}
		encoded, err := MarshalJSONBounded(resp, MaxResponsePayload)
		if err != nil || len(encoded) > MaxResponsePayload || !syntheticEnvelopeFits(typeID, encoded, nil) {
			return responseBudgetWireError()
		}
		return encoded, nil
	})
}

func guardErrorEnvelope(typeID uint32, err error) (json.RawMessage, *sessionrpc.Error) {
	wireErr := errorToRPC(err)
	if wireErr == nil || len(wireErr.Message) > MaxSyntheticEnvelope-256 || !syntheticEnvelopeFits(typeID, nil, wireErr) {
		return responseBudgetWireError()
	}
	return nil, wireErr
}

func syntheticEnvelopeFits(_ uint32, payload json.RawMessage, rpcErr *sessionrpc.Error) bool {
	encoded, err := MarshalJSONBounded(struct {
		Payload json.RawMessage   `json:"payload,omitempty"`
		Error   *sessionrpc.Error `json:"error,omitempty"`
	}{Payload: payload, Error: rpcErr}, MaxSyntheticEnvelope)
	return err == nil && len(encoded) <= MaxSyntheticEnvelope
}

func requestBudgetWireError() (json.RawMessage, *sessionrpc.Error) {
	return nil, &sessionrpc.Error{Code: ErrorRequestBudget, Message: "git request exceeds resource budget"}
}

func responseBudgetWireError() (json.RawMessage, *sessionrpc.Error) {
	return nil, &sessionrpc.Error{Code: ErrorResponseBudget, Message: "git response exceeds resource budget"}
}

func errorToRPC(err error) *sessionrpc.Error {
	if err == nil {
		return nil
	}
	var rpcErr *sessionrpc.Error
	if errors.As(err, &rpcErr) {
		return rpcErr
	}
	return &sessionrpc.Error{Code: 500, Message: err.Error()}
}
