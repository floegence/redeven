package flowerhost

import (
	"context"
	"errors"
	"strings"
	"time"

	fsclient "github.com/floegence/flowersec/flowersec-go/client"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/flowerhostrpc"
	"github.com/floegence/redeven/internal/rpcutil"
)

type TargetExecutor struct {
	catalog   *TargetCatalog
	connector *TargetConnector
	timeout   time.Duration
}

type TargetExecutorOptions struct {
	Catalog   *TargetCatalog
	Connector *TargetConnector
	Timeout   time.Duration
}

func NewTargetExecutor(opts TargetExecutorOptions) *TargetExecutor {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	return &TargetExecutor{
		catalog:   opts.Catalog,
		connector: opts.Connector,
		timeout:   timeout,
	}
}

func (e *TargetExecutor) ExecuteTargetTool(ctx context.Context, call ai.TargetToolCall) (ai.TargetToolResult, error) {
	target, err := e.resolveTarget(ctx, call.TargetID, call.RequiredCapabilities)
	if err != nil {
		return ai.TargetToolResult{}, err
	}
	runCtx := ctx
	if runCtx == nil {
		runCtx = context.Background()
	}
	var cancel context.CancelFunc
	runCtx, cancel = context.WithTimeout(runCtx, e.timeout)
	defer cancel()
	grant, err := e.connector.OpenTargetGrant(runCtx, target, call.RequiredCapabilities)
	if err != nil {
		return ai.TargetToolResult{}, targetToolExecutionError{err: err}
	}
	if !sessionGrantsCapabilities(grant, call.RequiredCapabilities) {
		return ai.TargetToolResult{}, targetToolExecutionError{err: targetConnectError{code: "target_unauthorized", message: "Target session does not grant the required tool capability."}}
	}
	client, err := fsclient.Connect(runCtx, grant.GrantClient, fsclient.WithOrigin(strings.TrimSpace(grant.ProviderOrigin)))
	if err != nil {
		return ai.TargetToolResult{}, targetToolExecutionError{err: targetConnectError{code: "target_unreachable", message: err.Error()}}
	}
	defer client.Close()
	resp, err := rpcutil.CallJSON[flowerhostrpc.TargetToolCall, flowerhostrpc.TargetToolResult](runCtx, client.RPC(), flowerhostrpc.TypeIDTargetToolExecute, &flowerhostrpc.TargetToolCall{
		ToolCallID:           strings.TrimSpace(call.ToolCallID),
		TargetID:             strings.TrimSpace(call.TargetID),
		ToolName:             strings.TrimSpace(call.ToolName),
		Arguments:            call.Arguments,
		RequiredCapabilities: append([]string(nil), call.RequiredCapabilities...),
	})
	if err != nil {
		return ai.TargetToolResult{}, targetToolExecutionError{err: err}
	}
	if resp == nil {
		return ai.TargetToolResult{}, targetToolExecutionError{err: errors.New("target returned empty tool result")}
	}
	if resp.Error != nil {
		message := strings.TrimSpace(resp.Error.Message)
		if message == "" {
			message = strings.TrimSpace(resp.Error.Code)
		}
		if message == "" {
			message = "target tool execution failed"
		}
		return ai.TargetToolResult{}, targetToolExecutionError{err: errors.New(message)}
	}
	if err := validateTargetToolResponse(call, *resp); err != nil {
		return ai.TargetToolResult{}, targetToolExecutionError{err: err}
	}
	return ai.TargetToolResult{
		TargetID: strings.TrimSpace(resp.TargetID),
		Result:   resp.Result,
	}, nil
}

func validateTargetToolResponse(call ai.TargetToolCall, resp flowerhostrpc.TargetToolResult) error {
	if strings.TrimSpace(resp.ToolCallID) != strings.TrimSpace(call.ToolCallID) ||
		strings.TrimSpace(resp.TargetID) != strings.TrimSpace(call.TargetID) ||
		strings.TrimSpace(resp.ToolName) != strings.TrimSpace(call.ToolName) {
		return targetConnectError{code: "target_protocol_mismatch", message: "Target tool response does not match the request."}
	}
	return nil
}

type targetToolExecutionError struct {
	err error
}

func (e targetToolExecutionError) Error() string {
	if e.err == nil {
		return "target tool execution failed"
	}
	return e.err.Error()
}

func (e targetToolExecutionError) Unwrap() error {
	return e.err
}

func (e targetToolExecutionError) InvalidArgumentsCode() string {
	var connectErr targetConnectError
	if errors.As(e.err, &connectErr) && connectErr.Code() != "" {
		return connectErr.Code()
	}
	return "target_tool_execution_failed"
}

func (e targetToolExecutionError) InvalidArgumentsMeta() map[string]any {
	return map[string]any{
		"scope": "target_runtime",
	}
}

func (e *TargetExecutor) resolveTarget(ctx context.Context, targetID string, requiredCapabilities []string) (FlowerTargetRef, error) {
	if e == nil || e.catalog == nil || e.connector == nil {
		return FlowerTargetRef{}, errors.New("target executor is not initialized")
	}
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return FlowerTargetRef{}, errors.New("missing target_id")
	}
	targets, err := e.catalog.ListTargets(ctx)
	if err != nil {
		return FlowerTargetRef{}, err
	}
	for _, target := range targets {
		if strings.TrimSpace(target.TargetID) != targetID {
			continue
		}
		if strings.TrimSpace(target.ProviderOrigin) == "" || strings.TrimSpace(target.EnvPublicID) == "" {
			return FlowerTargetRef{}, targetConnectError{code: "target_unsupported", message: "Target is missing provider origin or environment identity."}
		}
		if !targetAdvertisesCapabilities(target, requiredCapabilities) {
			return FlowerTargetRef{}, targetConnectError{code: "target_unsupported", message: "Target does not advertise the required tool capability."}
		}
		return target, nil
	}
	return FlowerTargetRef{}, targetConnectError{code: "target_unreachable", message: "Target is not available to this Flower Host."}
}

func targetAdvertisesCapabilities(target FlowerTargetRef, required []string) bool {
	for _, capability := range required {
		switch strings.TrimSpace(strings.ToLower(capability)) {
		case "", "read":
			if !targetHasAnyCapability(target, TargetCapabilityFiles) {
				return false
			}
		case "write":
			if !targetHasAnyCapability(target, TargetCapabilityFiles) {
				return false
			}
		case "execute":
			if !targetHasAnyCapability(target, TargetCapabilityTerminal) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func targetHasAnyCapability(target FlowerTargetRef, capabilities ...string) bool {
	for _, have := range target.Capabilities {
		have = strings.TrimSpace(have)
		for _, want := range capabilities {
			if have == want {
				return true
			}
		}
	}
	return false
}

func sessionGrantsCapabilities(session TargetSessionGrant, required []string) bool {
	for _, capability := range required {
		switch strings.TrimSpace(strings.ToLower(capability)) {
		case "", "read":
			if !session.Capabilities.CanRead {
				return false
			}
		case "write":
			if !session.Capabilities.CanWrite {
				return false
			}
		case "execute":
			if !session.Capabilities.CanExecute {
				return false
			}
		default:
			return false
		}
	}
	return true
}
