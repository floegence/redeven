package flowerhostrpc

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

const TypeIDTargetToolExecute uint32 = 7001

type TargetToolCall struct {
	ToolCallID           string          `json:"tool_call_id"`
	TargetID             string          `json:"target_id"`
	ToolName             string          `json:"tool_name"`
	Arguments            json.RawMessage `json:"arguments"`
	RequiredCapabilities []string        `json:"required_capabilities"`
	ApprovalRef          string          `json:"approval_ref,omitempty"`
}

type TargetToolResult struct {
	ToolCallID string           `json:"tool_call_id"`
	TargetID   string           `json:"target_id"`
	ToolName   string           `json:"tool_name"`
	Result     any              `json:"result,omitempty"`
	Error      *TargetToolError `json:"error,omitempty"`
}

type TargetToolError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Service struct {
	log          *slog.Logger
	stateDir     string
	agentHomeDir string
	workingDir   string
	scope        *filesystemscope.Registry
	shell        string
	aiConfig     *config.AIConfig
	timeout      time.Duration
}

type Options struct {
	Logger          *slog.Logger
	StateDir        string
	AgentHomeDir    string
	WorkingDir      string
	FilesystemScope *filesystemscope.Registry
	Shell           string
	AIConfig        *config.AIConfig
	Timeout         time.Duration
}

func NewService(opts Options) *Service {
	return &Service{
		log:          opts.Logger,
		stateDir:     strings.TrimSpace(opts.StateDir),
		agentHomeDir: strings.TrimSpace(opts.AgentHomeDir),
		workingDir:   strings.TrimSpace(opts.WorkingDir),
		scope:        opts.FilesystemScope,
		shell:        strings.TrimSpace(opts.Shell),
		aiConfig:     opts.AIConfig,
		timeout:      opts.Timeout,
	}
}

func (s *Service) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	if s == nil || r == nil {
		return
	}
	accessgate.RegisterTyped[TargetToolCall, TargetToolResult](r, TypeIDTargetToolExecute, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *TargetToolCall) (*TargetToolResult, error) {
		return s.ExecuteTargetTool(ctx, meta, req)
	})
}

func (s *Service) ExecuteTargetTool(ctx context.Context, meta *session.Meta, req *TargetToolCall) (*TargetToolResult, error) {
	if s == nil {
		return nil, errors.New("Flower Host RPC service is not initialized")
	}
	if req == nil {
		return nil, errors.New("missing target tool call")
	}
	toolName := strings.TrimSpace(req.ToolName)
	toolCallID := strings.TrimSpace(req.ToolCallID)
	targetID := strings.TrimSpace(req.TargetID)
	if toolCallID == "" || toolName == "" || targetID == "" {
		return nil, errors.New("target tool call requires tool_call_id, target_id, and tool_name")
	}
	if err := requireTargetBinding(meta, targetID); err != nil {
		return &TargetToolResult{
			ToolCallID: toolCallID,
			TargetID:   targetID,
			ToolName:   toolName,
			Error:      &TargetToolError{Code: "target_mismatch", Message: err.Error()},
		}, nil
	}
	requiredCapabilities, ok := requiredTargetToolCapabilities(toolName)
	if !ok {
		return &TargetToolResult{
			ToolCallID: toolCallID,
			TargetID:   targetID,
			ToolName:   toolName,
			Error:      &TargetToolError{Code: "tool_not_allowed", Message: "Tool is not available through Flower target RPC."},
		}, nil
	}
	if err := requireTargetToolPermissions(meta, requiredCapabilities); err != nil {
		return &TargetToolResult{
			ToolCallID: toolCallID,
			TargetID:   targetID,
			ToolName:   toolName,
			Error:      &TargetToolError{Code: "permission_denied", Message: err.Error()},
		}, nil
	}
	out, err := ai.ExecuteLocalTool(ctx, ai.LocalToolExecutionOptions{
		Logger:          s.log,
		StateDir:        s.stateDir,
		AgentHomeDir:    s.agentHomeDir,
		WorkingDir:      s.workingDir,
		FilesystemScope: s.scope,
		Shell:           s.shell,
		AIConfig:        s.aiConfig,
		SessionMeta:     meta,
		ToolCallID:      toolCallID,
		ToolName:        toolName,
		Arguments:       req.Arguments,
		Timeout:         s.timeout,
	})
	if err != nil {
		return &TargetToolResult{
			ToolCallID: toolCallID,
			TargetID:   targetID,
			ToolName:   toolName,
			Error:      &TargetToolError{Code: "tool_execution_failed", Message: err.Error()},
		}, nil
	}
	return &TargetToolResult{
		ToolCallID: toolCallID,
		TargetID:   targetID,
		ToolName:   toolName,
		Result:     out.Result,
	}, nil
}

func requiredTargetToolCapabilities(toolName string) ([]string, bool) {
	switch strings.TrimSpace(toolName) {
	case "file.read":
		return []string{"read"}, true
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}, true
	case "terminal.exec":
		return []string{"execute"}, true
	default:
		return nil, false
	}
}

func requireTargetToolPermissions(meta *session.Meta, capabilities []string) error {
	if meta == nil {
		return errors.New("missing session permissions")
	}
	for _, capability := range capabilities {
		switch strings.TrimSpace(strings.ToLower(capability)) {
		case "":
		case "read":
			if !meta.CanRead {
				return errors.New("read permission denied")
			}
		case "write":
			if !meta.CanWrite {
				return errors.New("write permission denied")
			}
		case "execute":
			if !meta.CanExecute {
				return errors.New("execute permission denied")
			}
		default:
			return errors.New("unsupported target tool capability")
		}
	}
	return nil
}

func requireTargetBinding(meta *session.Meta, targetID string) error {
	if meta == nil {
		return errors.New("missing session permissions")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("missing target environment binding")
	}
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return errors.New("missing target_id")
	}
	if targetID == endpointID || strings.HasSuffix(targetID, ":env:"+endpointID) {
		return nil
	}
	return errors.New("target_id does not match this runtime session")
}
