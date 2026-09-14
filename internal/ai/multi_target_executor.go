package ai

import (
	"context"
	"errors"
	"strings"
)

// MultiTargetExecutor keeps one runtime boundary while routing concrete target
// sessions to their owning adapter. Logical target selection remains in the
// registry; this type never lets an executor guess another target.
type MultiTargetExecutor struct {
	executors map[string]TargetToolExecutor
}

func NewMultiTargetExecutor(executors map[string]TargetToolExecutor) *MultiTargetExecutor {
	return &MultiTargetExecutor{executors: executors}
}

func (e *MultiTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	if e == nil {
		return TargetToolResult{}, errors.New("target executor is unavailable")
	}
	executor := e.executors[strings.TrimSpace(call.TargetID)]
	if executor == nil {
		return TargetToolResult{}, errors.New("target executor is not registered")
	}
	return executor.ExecuteTargetTool(ctx, call)
}

func (e *MultiTargetExecutor) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	for _, executor := range e.executors {
		if resolver, ok := executor.(TargetToolAttachmentResolver); ok {
			if body, err := resolver.ResolveTargetToolAttachment(ctx, ref); err == nil {
				return body, nil
			}
		}
	}
	return nil, errors.New("target attachment is unavailable")
}

func (e *MultiTargetExecutor) Close() error {
	for _, executor := range e.executors {
		if closer, ok := executor.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
	}
	return nil
}
