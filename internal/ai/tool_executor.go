package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

type LocalToolExecutionOptions struct {
	Logger          *slog.Logger
	StateDir        string
	AgentHomeDir    string
	WorkingDir      string
	FilesystemScope *filesystemscope.Registry
	Shell           string
	AIConfig        *config.AIConfig
	SessionMeta     *session.Meta
	ToolCallID      string
	ToolName        string
	Arguments       json.RawMessage
	Timeout         time.Duration
}

type LocalToolExecutionResult struct {
	ToolCallID string `json:"tool_call_id"`
	ToolName   string `json:"tool_name"`
	Result     any    `json:"result,omitempty"`
}

func ExecuteLocalTool(ctx context.Context, opts LocalToolExecutionOptions) (LocalToolExecutionResult, error) {
	toolName := strings.TrimSpace(opts.ToolName)
	if toolName == "" {
		return LocalToolExecutionResult{}, errors.New("missing tool name")
	}
	meta := opts.SessionMeta
	if meta == nil {
		return LocalToolExecutionResult{}, errors.New("missing session meta")
	}
	args, err := decodeLocalToolArgs(opts.Arguments)
	if err != nil {
		return LocalToolExecutionResult{}, err
	}
	args = StripTargetToolArgs(args)
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	r := newRun(runOptions{
		Log:             logger,
		StateDir:        strings.TrimSpace(opts.StateDir),
		AgentHomeDir:    strings.TrimSpace(opts.AgentHomeDir),
		WorkingDir:      strings.TrimSpace(opts.WorkingDir),
		FilesystemScope: opts.FilesystemScope,
		Shell:           strings.TrimSpace(opts.Shell),
		AIConfig:        opts.AIConfig,
		SessionMeta:     meta,
		ToolTargetPolicy: ToolTargetPolicy{
			Mode: ToolTargetModeLocalRuntime,
		},
	})
	result, err := r.execTool(runCtx, meta, strings.TrimSpace(opts.ToolCallID), toolName, args)
	if err != nil {
		return LocalToolExecutionResult{}, err
	}
	return LocalToolExecutionResult{
		ToolCallID: strings.TrimSpace(opts.ToolCallID),
		ToolName:   toolName,
		Result:     result,
	}, nil
}

func decodeLocalToolArgs(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, errors.New("invalid tool arguments")
	}
	if args == nil {
		return map[string]any{}, nil
	}
	return args, nil
}
