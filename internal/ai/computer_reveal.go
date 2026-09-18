package ai

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/session"
)

type computerTargetRevealer interface {
	revealComputerTarget(context.Context, string) error
}

// Reveal is an authenticated user action on the already bound browser page.
// It never changes selection, grants, private control, or canonical execution.
func (s *Service) RevealComputerTarget(ctx context.Context, meta *session.Meta, threadID, targetID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return errors.New("computer runtime unavailable")
	}
	control := host.controlForTarget(targetID)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	selected, err := s.snapshotThreadStore().GetComputerTarget(ctx, threadID)
	if err != nil || selected == "" || selected != targetID {
		return errors.New("browser selection changed")
	}
	control.mu.Lock()
	occupied := control.threadID != "" && control.threadID != threadID
	control.mu.Unlock()
	if occupied {
		return &targetToolPolicyError{code: "target_in_use"}
	}
	target, err := host.ResolveTarget(ctx, targetID)
	if err != nil || target.Kind != "browser.connected" || !targetAllowedByPolicy(s.ToolTargetPolicy(), targetID) {
		return errors.New("connected browser unavailable")
	}
	host.mu.RLock()
	executor, ok := host.executors[targetID].(computerTargetRevealer)
	closed := host.closed
	host.mu.RUnlock()
	if !ok || closed {
		return errors.New("browser reveal unavailable")
	}
	return executor.revealComputerTarget(ctx, targetID)
}

func (e *extensionTargetExecutor) revealComputerTarget(ctx context.Context, _ string) error {
	_, err := e.client.call(ctx, "reveal", map[string]any{"tab_id": e.tabID})
	return err
}

func (e *PlaywrightTargetExecutor) revealComputerTarget(ctx context.Context, targetID string) error {
	if e.CDPURL == "" {
		return errors.New("connected browser unavailable")
	}
	_, err := e.executeTargetTool(ctx, TargetToolCall{TargetID: targetID, ToolName: "computer.reveal"}, false)
	return err
}
