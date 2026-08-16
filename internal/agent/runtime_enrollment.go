package agent

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	gatewaysupervisor "github.com/floegence/redeven/internal/runtimegateway/supervisor"
)

func (a *Agent) handleRuntimeEnrollmentProof(ctx context.Context, payload json.RawMessage) (any, *flowersec.RPCError) {
	if a == nil {
		return nil, &flowersec.RPCError{Code: 503, Message: "Runtime enrollment proof is unavailable"}
	}
	var request gatewaysupervisor.EnrollmentProofRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return nil, &flowersec.RPCError{Code: 400, Message: "Runtime enrollment proof request is invalid"}
	}
	config := a.remoteConfigSnapshot()
	if config == nil || request.ProtocolVersion != gatewaysupervisor.EnrollmentProtocolVersion ||
		strings.TrimSpace(request.EnvironmentPublicID) != strings.TrimSpace(config.EnvironmentID) ||
		request.ControlBindingGeneration != config.BindingGeneration {
		return nil, &flowersec.RPCError{Code: 409, Message: "Runtime enrollment control binding changed"}
	}
	stateDir := filepath.Clean(strings.TrimSpace(a.stateDir))
	if stateDir == "" || stateDir == "." {
		return nil, &flowersec.RPCError{Code: 503, Message: "Runtime enrollment proof socket is unavailable"}
	}
	runtimeRoot := filepath.Dir(stateDir)
	response, err := gatewaysupervisor.RequestEnrollmentProof(ctx, gatewaysupervisor.EnrollmentProofSocketPath(runtimeRoot), request)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, &flowersec.RPCError{Code: 504, Message: "Runtime enrollment proof timed out"}
		}
		return nil, &flowersec.RPCError{Code: 409, Message: "Runtime enrollment proof was rejected by the local supervisor"}
	}
	return response, nil
}
